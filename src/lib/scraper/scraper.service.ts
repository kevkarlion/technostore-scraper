/**
 * Scraper Service — Axios + Cheerio implementation.
 *
 * Replaces the old Playwright/Chromium-based scraper with direct HTTP requests
 * and HTML parsing. Session is maintained via a tough-cookie jar attached to
 * the axios instance, which preserves the ASP.NET session across requests.
 *
 * Design:
 *   - No browser → no processes, no zombies, no EAGAIN, no 300MB RAM.
 *   - Login: POST to loginext.aspx with credentials.
 *   - Category scrape: GET buscar.aspx?idssubrubro1=N&pag=M → cheerio parse.
 *   - Product detail: GET articulo.aspx?id=N → cheerio parse.
 *   - Retry logic identical to before (3 attempts with delay).
 *   - productRepository (upsert) is preserved as-is.
 */

import * as cheerio from 'cheerio';
import type { AxiosInstance } from 'axios';
import { getScraperConfig, jotakpCategories } from './config';
import { transformProducts } from './data-transformer';
import { uploadProductImages } from './image-downloader';
import type {
  ScraperConfig,
  ScraperResult,
  RawProduct,
  ScraperRunRequest,
  ScraperCategory,
} from './types';
import { ScraperError } from './types';
import { createHttpClient, safeGet, safePost } from './http-client';
import { PlaywrightEnricher } from './playwright-enricher';
import crypto from 'crypto';

// ============================================================================
// SLUG GENERATION UTILITIES
// ============================================================================

/**
 * Generate a URL-friendly slug from product name.
 * Matches the implementation in TechnoStore's product-to-presentation.ts
 */
function generateProductSlug(name: string): string {
  if (!name) return '';
  
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9]+/g, '-')     // Replace non-alphanumeric with dash
    .replace(/^-+|-+$/g, '')         // Remove leading/trailing dashes
    .replace(/-+/g, '-');            // Replace multiple dashes with single
}

/**
 * Normalize text for search (lowercase, no accents, no special chars).
 * Used for searchName field to enable fast text search.
 */
function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// PERSISTENT STORE
// ============================================================================

// Shared MongoDB connection (singleton — same pattern as before).
let dbInstance: any = null;

async function getDb(): Promise<any> {
  if ((global as any).db) {
    return (global as any).db;
  }
  if (!dbInstance) {
    const { MongoClient } = await import('mongodb');
    const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
    const DB_NAME = process.env.DB_NAME || process.env.MONGODB_DB_NAME || 'ecommerce';
    if (!MONGO_URI) throw new Error('MONGO_URI is required');

    const client = new MongoClient(MONGO_URI);
    await client.connect();
    dbInstance = client.db(DB_NAME);
  }
  return dbInstance;
}

// ============================================================================
// PRODUCT REPOSITORY — same as before
// ============================================================================

const productRepository = {
  async upsert(product: any) {
    const db = await getDb();
    const collection = db.collection('products');
    const existing = await collection.findOne({ externalId: product.externalId, supplier: 'jotakp' });

    if (existing) {
      const changed: any = {};
      for (const [key, value] of Object.entries(product)) {
        if (JSON.stringify(existing[key]) !== JSON.stringify(value)) {
          changed[key] = value;
        }
      }
      if (Object.keys(changed).length > 0) {
        await collection.updateOne(
          { _id: existing._id },
          { $set: { ...changed, lastSyncedAt: new Date() } },
        );
        return { created: false, updated: true };
      }
      return { created: false, updated: false };
    } else {
      await collection.insertOne({
        ...product,
        supplier: 'jotakp',
        status: 'active',
        inStock: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return { created: true, updated: false };
    }
  },

  async atomicUpsertByExternalId(
    product: any,
  ): Promise<{ created: boolean; updated: boolean; changes: string[] }> {
    const db = await getDb();
    const collection = db.collection('products');
    const now = new Date();

    const existing = await collection.findOne({
      externalId: product.externalId,
      supplier: product.supplier || 'jotakp',
    });

    if (!existing) {
      // Generate slug and searchName for new products
      const slug = generateProductSlug(product.name);
      const searchName = normalizeText(product.name);
      
      await collection.insertOne({
        ...product,
        slug,
        searchName,
        supplier: product.supplier || 'jotakp',
        status: 'active',
        inStock: true,
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      console.log(`[Upsert] ${product.externalId}: CREATED (slug: ${slug})`);
      return { created: true, updated: false, changes: ['CREATE'] };
    }

    const changes: string[] = [];
    const updateOps: any = { lastSyncedAt: now, updatedAt: now };

    if (existing.status === 'discontinued') {
      updateOps.status = 'active';
      updateOps.discontinuedAt = null;
      changes.push('status');
    }

    if (existing.inStock === false) {
      updateOps.inStock = true;
      changes.push('inStock');
    }

    const fieldsToCompare = [
      'name',
      'description',
      'price',
      'priceRaw',
      'currency',
      'stock',
      'sku',
      'categories',
      'imageUrls',
    ];

    // Helper: check if a value is "empty" (scraper default, not real data)
    // null and undefined are equivalent "no data" states
    const isEmpty = (val: any): boolean =>
      val === undefined || val === null || val === '' || val === 0 ||
      (Array.isArray(val) && val.length === 0);

    for (const field of fieldsToCompare) {
      const existingVal = existing[field];
      const newVal = product[field];

      // Don't overwrite valid existing data with empty/zero defaults
      if (JSON.stringify(existingVal) !== JSON.stringify(newVal)) {
        // Skip if: new value is empty (and existing is also empty or has data)
        // This prevents overwriting null/undefined with null/undefined (no-op)
        // And prevents overwriting valid data with empty defaults
        if (isEmpty(newVal)) {
          continue;
        }
        updateOps[field] = newVal;
        changes.push(field);
      }
    }

    // If name changed, also regenerate slug and searchName
    if (changes.includes('name') && product.name) {
      updateOps.slug = generateProductSlug(product.name);
      updateOps.searchName = normalizeText(product.name);
      changes.push('slug', 'searchName');
    }

    if (changes.length > 0) {
      await collection.updateOne({ _id: existing._id }, { $set: updateOps });
      console.log(`[Upsert] ${product.externalId}: UPDATED — ${changes.join(', ')}`);
      return { created: false, updated: true, changes };
    }

    console.log(`[Upsert] ${product.externalId}: NO CHANGES`);
    return { created: false, updated: false, changes: [] };
  },

  async markDiscontinued(
    categoryId: string,
    activeExternalIds: string[],
    supplier: string = 'jotakp',
  ): Promise<number> {
    const db = await getDb();
    const collection = db.collection('products');
    const result = await collection.updateMany(
      {
        categories: categoryId,
        supplier,
        externalId: { $nin: activeExternalIds },
        status: { $ne: 'discontinued' },
      },
      { $set: { status: 'discontinued', discontinuedAt: new Date(), updatedAt: new Date() } },
    );
    return result.modifiedCount;
  },
};

// ============================================================================
// SCRAPER SERVICE
// ============================================================================

export class ScraperService {
  private http: AxiosInstance;
  private config: ScraperConfig;
  private request: ScraperRunRequest;
  private categories: ScraperCategory[];
  private loggedIn = false;

  constructor(config?: ScraperConfig, request?: ScraperRunRequest, http?: AxiosInstance) {
    this.config = config || getScraperConfig();
    this.request = request || {};
    // Allow injecting a pre-authenticated HTTP client (shared session)
    this.http = http || createHttpClient(this.config);
    this.categories = [];

    // Build category list from request or all
    if (request?.categoryId) {
      const cat = jotakpCategories.find((c) => c.id === request.categoryId);
      if (cat) this.categories = [cat];
    } else {
      this.categories = jotakpCategories.filter((c) => c.idsubrubro1 > 0);
    }
  }

  // ============================================================================
  // LOGIN
  // ============================================================================

  /**
   * Log in to the supplier website via POST form.
   * The cookie jar automatically preserves the ASP.NET session cookie.
   */
  async login(): Promise<void> {
    if (this.loggedIn) return;

    console.log('[Scraper] Logging in...');

    // Attempt login with the configured credentials
    const loginBody: Record<string, string> = {};
    loginBody[this.extractInputName('txtUsuario')] = this.config.email;
    loginBody[this.extractInputName('txtClave')] = this.config.password;

    // We need the ASP.NET form fields — first GET the login page to extract __VIEWSTATE etc.
    try {
      const loginPageHtml = await safeGet(this.http, this.config.loginUrl);
      const $login = cheerio.load(loginPageHtml);

      // Grab ASP.NET hidden fields
      $login('input[type="hidden"]').each((_: any, el: any) => {
        const name = $login(el).attr('name');
        const value = $login(el).attr('value') || '';
        if (name) loginBody[name] = value;
      });

      // Find the actual input names (ASP.NET may mangle them: ctl00$ContentPlaceHolder1$txtUsuario)
      const emailInputName = this.findInputName($login, 'txtUsuario');
      const passInputName = this.findInputName($login, 'txtClave');

      if (emailInputName) loginBody[emailInputName] = this.config.email;
      if (passInputName) loginBody[passInputName] = this.config.password;

      // Find the submit button name
      const btnName = this.findInputName($login, 'btnIngresar') || 'btnIngresar';
      loginBody[btnName] = 'Ingresar';

      // POST login
      const postLoginHtml = await safePost(this.http, this.config.loginUrl, loginBody);

      // Verify login succeeded — check we're not still on the login page
      const $verify = cheerio.load(postLoginHtml);
      if ($verify('input[name*="txtUsuario"]').length > 0) {
        // Still on login page — try simpler approach without hidden fields
        console.log('[Scraper] Simple login attempt...');
        const simpleBody: Record<string, string> = {};
        simpleBody[emailInputName || 'txtUsuario'] = this.config.email;
        simpleBody[passInputName || 'txtClave'] = this.config.password;
        simpleBody[btnName] = 'Ingresar';
        await safePost(this.http, this.config.loginUrl, simpleBody);
      }

      // Legacy branch selection removed — /default.aspx no longer exists
      // on the supplier's server (returns 404), and branch selection
      // was only needed for the old ASP.NET WebForms login flow.

      this.loggedIn = true;
      console.log('[Scraper] Login successful');
    } catch (error: any) {
      throw new ScraperError(
        `Login failed: ${error.message}`,
        'AUTH_FAILED',
        error,
      );
    }
  }

  /**
   * Extract the actual ASP.NET input name for a field.
   * ASP.NET often mangles IDs: ctl00$ContentPlaceHolder1$txtUsuario
   */
  private findInputName($: cheerio.CheerioAPI, fieldId: string): string | null {
    const el = $(`input[name*="${fieldId}"]`).first();
    return el.attr('name') || null;
  }

  /**
   * Extract input name matching one of several possible IDs
   */
  private extractInputName(...ids: string[]): string {
    // Simple fallback — the actual name is resolved in login()
    return ids[0] || 'txtUsuario';
  }

  // ============================================================================
  // CATEGORY SCRAPING
  // ============================================================================

  /**
   * Scrape a single page of a category listing.
   * Returns the list of raw products found on that page.
   * NOTE: Prices are NOT extracted from listing (they're JS-rendered).
   * Only product IDs, names, and listing images are captured here.
   */
  async scrapeCategoryPage(
    idsubrubro1: number,
    pageNum: number,
  ): Promise<{ products: RawProduct[]; hasMore: boolean }> {
    const url = `/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=${pageNum}&conIva=1`;
    const html = await safeGet(this.http, url);
    const $ = cheerio.load(html);

    const products: RawProduct[] = [];
    const productLinks = $('a[href*="articulo.aspx?id="]');

    productLinks.each((_: any, el: any) => {
      const href = $(el).attr('href') || '';
      const fullText = $(el).text().trim();

      const idMatch = href.match(/id=(\d+)/);
      if (!idMatch) return;
      const externalId = idMatch[1];

      // Name is everything before the price marker (or full text if no price marker)
      const name = fullText.replace(/U\$D[\s\d.,+IVA%]+$/, '').trim();
      if (!name || name.length < 3) return;

      // Extract image from listing page (CSS background-image)
      const imgDiv = $(el).find('div.tg-article-img');
      const bgImage = imgDiv.attr('style') || '';
      const bgMatch = bgImage.match(/url\(([^)]+)\)/);
      const listingImages: string[] = [];
      if (bgMatch) {
        const imgUrl = bgMatch[1].replace(/['"]/g, '').trim();
        if (imgUrl.includes('imagenes/')) {
          listingImages.push(imgUrl);
        }
      }

      // NOTE: priceRaw is NOT set here — prices come from Playwright detail page
      products.push({
        externalId,
        name,
        description: '',
        stock: 0,
        priceRaw: undefined,
        stockRaw: undefined,
        sku: '',
        imageUrls: listingImages,
        categories: [],
      });
    });

    // Check if there's a next page
    const hasMore = products.length > 0; // If we got products, try next page
    return { products, hasMore };
  }

  /**
   * Scrape a full category (all pages).
   */
  async scrapeCategory(idsubrubro1: number): Promise<{
    products: RawProduct[];
    externalIds: string[];
  }> {
    const allProducts: RawProduct[] = [];
    const allIds: string[] = [];
    const maxPages = 20;

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`[Scraper] Scraping page ${pageNum} (idsubrubro1=${idsubrubro1})`);
      const { products, hasMore } = await this.scrapeCategoryPage(idsubrubro1, pageNum);

      if (products.length === 0) break;

      // Collect products — detail enrichment (prices, desc, images) happens via Playwright later
      for (const product of products) {
        allProducts.push(product);
        allIds.push(product.externalId);
      }

      if (!hasMore) break;
    }

    return { products: allProducts, externalIds: allIds };
  }

  /**
   * Resolve category ID for a product.
   */
  private getCategoryId(externalId: string): string {
    // Map the product to its category based on the current request
    return this.request.categoryId || 'unknown';
  }

  // ============================================================================
  // MAIN RUN LOOP
  // ============================================================================

  /**
   * Run the scraper — login, then scrape all configured categories.
   */
  async run(): Promise<ScraperResult> {
    const startTime = Date.now();
    let created = 0;
    let updated = 0;
    const createdIds: string[] = [];
    const updatedIds: string[] = [];
    const errors: string[] = [];

    let playwrightEnricher: PlaywrightEnricher | null = null;

    try {
      // Login first (skip if using a pre-authenticated shared session)
      if (!this.request.skipLogin) {
        await this.login();
      }

      // Initialize Playwright for full product enrichment (prices, desc, SKU, images)
      try {
        playwrightEnricher = new PlaywrightEnricher();
        await playwrightEnricher.launch();
        await playwrightEnricher.initSession(this.config.baseUrl, {
          email: this.config.email,
          password: this.config.password,
        });
        console.log('[Scraper] Playwright launched and session initialized');
      } catch (e: any) {
        console.error('[Scraper] Failed to launch Playwright:', e.message);
        playwrightEnricher = null;
      }

      // Process each category
      for (const cat of this.categories) {
        try {
          console.log(`[Scraper] Processing category: ${cat.id} (${cat.idsubrubro1})`);
          const { products, externalIds } = await this.scrapeCategory(cat.idsubrubro1);

          // Playwright enrichment — only for NEW products (skip existing)
          // Runs in batches of ENRICHMENT_CONCURRENCY for parallel processing
          const ENRICHMENT_CONCURRENCY = 3;
          const existingIds = new Set(this.request.existingProductIds || []);
          const productsToEnrich = products.filter(p => !existingIds.has(p.externalId));
          const skippedCount = products.length - productsToEnrich.length;
          let enrichedCount = 0;

          if (playwrightEnricher && productsToEnrich.length > 0) {
            for (let i = 0; i < productsToEnrich.length; i += ENRICHMENT_CONCURRENCY) {
              const batch = productsToEnrich.slice(i, i + ENRICHMENT_CONCURRENCY);
              const results = await Promise.allSettled(
                batch.map(async (product) => {
                  const enriched = await playwrightEnricher!.enrichProduct(product.externalId, this.config.baseUrl);
                  if (enriched.priceRaw) product.priceRaw = enriched.priceRaw;
                  if (enriched.priceWithIvaRaw) product.priceWithIvaRaw = enriched.priceWithIvaRaw;
                  if (enriched.description) product.description = enriched.description;
                  if (enriched.sku) product.sku = enriched.sku;
                  if (enriched.stock !== undefined) product.stock = enriched.stock;
                  if (enriched.imageUrls && enriched.imageUrls.length > 0) product.imageUrls = enriched.imageUrls;
                })
              );
              enrichedCount += results.filter(r => r.status === 'fulfilled').length;
              for (const f of results.filter(r => r.status === 'rejected')) {
                console.error(`[Playwright] enrichment failed: ${(f as PromiseRejectedResult).reason?.message || f}`);
              }
            }
          }

          if (skippedCount > 0 || enrichedCount > 0) {
            console.log(`[Playwright] ${cat.id}: ${enrichedCount} enriched (×${ENRICHMENT_CONCURRENCY} parallel), ${skippedCount} existing skipped`);
          }

          // Save products to DB
          // NOTE: Only Playwright-enriched products have real price/stock data.
          // Listing-only products only have name + listing images.
          // For incremental scraper: skip products that already exist (they were already saved)
          const isIncremental = this.request.source === 'incremental';
          
          for (const product of products) {
            // Skip existing products in incremental mode - they were already saved
            if (isIncremental && existingIds.has(product.externalId)) {
              continue;
            }
            
            try {
              const upsertPayload: any = {
                externalId: product.externalId,
                name: product.name,
                categories: [cat.id],
              };

              // Only include fields that have real data (not listing defaults)
              // With conIva=1, priceRaw already contains the final price (USD + IVA)
              if (product.priceRaw) {
                upsertPayload.price = this.parsePrice(product.priceRaw);
                upsertPayload.priceRaw = product.priceRaw;
                upsertPayload.currency = 'USD';
              }
              if (product.stock > 0) {
                upsertPayload.stock = product.stock;
              }
              if (product.sku) {
                upsertPayload.sku = product.sku;
              }
              if (product.description) {
                upsertPayload.description = product.description;
              }
              const images = product.cloudinaryUrls?.length > 0
                ? product.cloudinaryUrls
                : product.imageUrls;
              if (images?.length > 0) {
                upsertPayload.imageUrls = images;
              }

              console.log(
                `[Upsert] ${product.externalId}: ` +
                `price=${upsertPayload.price ?? 'N/A'}, ` +
                `images=${upsertPayload.imageUrls?.length ?? 0}`,
              );

              const result = await productRepository.atomicUpsertByExternalId(upsertPayload);

              if (result.created) { created++; createdIds.push(product.externalId); }
              if (result.updated) { updated++; updatedIds.push(product.externalId); }
            } catch (e: any) {
              errors.push(`Error saving product ${product.externalId}: ${e.message}`);
            }
          }

          // Upload images to Cloudinary after upsert, so we know if it's a create or update.
          // - Full scrape (source !== 'incremental'): upload for ALL products with images.
          // - Incremental: upload ONLY for newly created products (existing products keep
          //   their Cloudinary URLs from the first full scrape).
          const isFullScrape = this.request.source !== 'incremental';
          for (const product of products) {
            if (product.imageUrls.length === 0) continue;
            if (!isFullScrape && !createdIds.includes(product.externalId)) continue;

            try {
              const cloudUrls = await uploadProductImages(
                product.imageUrls,
                this.config.supplier,
                product.externalId,
              );
              product.cloudinaryUrls = cloudUrls;

              // Update the DB record with Cloudinary URLs
              const db = await getDb();
              await db.collection('products').updateOne(
                { externalId: product.externalId, supplier: 'jotakp' },
                { $set: { imageUrls: cloudUrls, updatedAt: new Date() } },
              );
            } catch {
              // Image upload is optional — keep raw supplier URLs in DB
            }
          }

          // Mark discontinued
          if (externalIds.length > 0) {
            const discontinued = await productRepository.markDiscontinued(cat.id, externalIds);
            if (discontinued > 0) {
              console.log(`[Scraper] Marked ${discontinued} products as discontinued in ${cat.id}`);
            }
          }

          console.log(`[Scraper] Category ${cat.id}: ${products.length} products (${created} created, ${updated} updated)`);
        } catch (e: any) {
          errors.push(`Error scraping category ${cat.id}: ${e.message}`);
          console.error(`[Scraper] Error processing category ${cat.id}:`, e.message);
        }
      }
    } catch (e: any) {
      errors.push(`Fatal error: ${e.message}`);
      console.error('[Scraper] Fatal error:', e);
    } finally {
      await playwrightEnricher?.close();
    }

    return {
      success: errors.length === 0 || !errors.some((e) => e.startsWith('Fatal')),
      created,
      updated,
      createdIds,
      updatedIds,
      errors,
      durationMs: Date.now() - startTime,
      timestamp: new Date(),
    };
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Parse a price string like "1.234,56" or "1234.56" to a number.
   */
  private parsePrice(priceRaw: string): number {
    if (!priceRaw) return 0;
    let cleaned = priceRaw.replace(/[$€£¥₹]/g, '').replace(/\s/g, '').trim();

    const lastDot = cleaned.lastIndexOf('.');
    const lastComma = cleaned.lastIndexOf(',');

    if (lastComma > lastDot) {
      // European: 1.234,56 → 1234.56
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // US: 1,234.56 → remove commas
      cleaned = cleaned.replace(/,/g, '');
    }

    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Run the scraper for a given category (or all if not specified).
 *
 * Usage:
 *   runScraper({ categoryId: 'discos-ssd', source: 'incremental' })
 *   runScraper()  // all categories
 */
export async function runScraper(request?: ScraperRunRequest, http?: AxiosInstance): Promise<ScraperResult> {
  const scraper = new ScraperService(undefined, request, http);
  return scraper.run();
}
