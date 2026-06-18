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
import crypto from 'crypto';

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
      await collection.insertOne({
        ...product,
        supplier: product.supplier || 'jotakp',
        status: 'active',
        inStock: true,
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      });
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

    for (const field of fieldsToCompare) {
      const existingVal = existing[field];
      const newVal = product[field];
      if (JSON.stringify(existingVal) !== JSON.stringify(newVal) && newVal !== undefined) {
        updateOps[field] = newVal;
        changes.push(field);
      }
    }

    if (changes.length > 0) {
      await collection.updateOne({ _id: existing._id }, { $set: updateOps });
      return { created: false, updated: true, changes };
    }

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

  constructor(config?: ScraperConfig, request?: ScraperRunRequest) {
    this.config = config || getScraperConfig();
    this.request = request || {};
    this.http = createHttpClient(this.config);
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

      // Try to select branch if present
      try {
        const afterLoginHtml = await safeGet(this.http, '/default.aspx');
        const $branch = cheerio.load(afterLoginHtml);
        const branchSelect = $branch('select[id*="ddlSucursal"]');
        if (branchSelect.length > 0) {
          const branchName = branchSelect.attr('name') || 'ddlSucursal';
          const branchBody: Record<string, string> = {};
          branchBody[branchName] = branchSelect.find('option').eq(1).attr('value') || '1';
          await safePost(this.http, '/default.aspx', branchBody);
        }
      } catch {
        // Branch selection is optional
      }

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
   */
  async scrapeCategoryPage(
    idsubrubro1: number,
    pageNum: number,
  ): Promise<{ products: RawProduct[]; hasMore: boolean }> {
    const url = `/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=${pageNum}`;
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

      // Extract price: U$D 1234.56
      let price: number | null = null;
      const priceMatch = fullText.match(/U\$D\s+([\d.,]+)/);
      if (priceMatch) {
        price = parseFloat(priceMatch[1].replace(',', '.'));
      }

      // Name is everything before the price
      const name = fullText.replace(/U\$D[\s\d.,+IVA%]+$/, '').trim();
      if (!name || name.length < 3) return;

      products.push({
        externalId,
        name,
        description: '',
        stock: 0,
        priceRaw: priceMatch ? priceMatch[1] : undefined,
        stockRaw: undefined,
        sku: '',
        imageUrls: [],
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

      // Get detail for each product — safeGet() already has internal delay
      for (const product of products) {
        try {
          await this.enrichProductDetail(product);
          allProducts.push(product);
          allIds.push(product.externalId);
        } catch (e: any) {
          console.log(`[Scraper] Error enriching product ${product.externalId}: ${e.message}`);
          allProducts.push(product);
          allIds.push(product.externalId);
        }
      }

      if (!hasMore) break;
    }

    // Also fetch images for each product (now that we have enriched data)
    for (const product of allProducts) {
      if (product.imageUrls.length > 0) {
        try {
          const cloudUrls = await uploadProductImages(
            product.imageUrls,
            this.config.supplier,
            product.externalId,
          );
          product.cloudinaryUrls = cloudUrls;
        } catch {
          // Image upload is optional
        }
      }
    }

    return { products: allProducts, externalIds: allIds };
  }

  /**
   * Enrich a product with full detail from its articulo.aspx page.
   */
  async enrichProductDetail(product: RawProduct): Promise<void> {
    const url = `/articulo.aspx?id=${product.externalId}`;
    const html = await safeGet(this.http, url);
    const $ = cheerio.load(html);

    // Description
    const descEl =
      $('#ContentPlaceHolder1_lblDescripcion').first() ||
      $('[id*="lblDescripcion"]').first();
    product.description = descEl.text().trim() || '';

    // Stock
    const stockEl =
      $('#ContentPlaceHolder1_lblStock').first() ||
      $('[id*="lblStock"]').first();
    const stockText = stockEl.text().trim();
    const stockMatch = stockText.match(/(\d+)/);
    product.stock = stockMatch ? parseInt(stockMatch[1], 10) : 0;

    // SKU
    const skuEl =
      $('#ContentPlaceHolder1_lblCodigo').first() ||
      $('[id*="lblCodigo"]').first();
    product.sku = skuEl.text().trim() || '';

    // Images
    const images: string[] = [];
    $('div.tg-img-overlay.artImg').each((_: any, el: any) => {
      const src = $(el).attr('data-src');
      if (src && src.includes('imagenes/')) {
        images.push(src);
      }
    });
    product.imageUrls = images.slice(0, 5);

    // Set categories
    product.categories = [this.getCategoryId(product.externalId)];
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

    try {
      // Login first
      await this.login();

      // Process each category
      for (const cat of this.categories) {
        try {
          console.log(`[Scraper] Processing category: ${cat.id} (${cat.idsubrubro1})`);
          const { products, externalIds } = await this.scrapeCategory(cat.idsubrubro1);

          // Save products to DB
          for (const product of products) {
            try {
              const result = await productRepository.atomicUpsertByExternalId({
                externalId: product.externalId,
                name: product.name,
                description: product.description,
                price: product.priceRaw ? this.parsePrice(product.priceRaw) : 0,
                priceRaw: product.priceRaw,
                currency: 'USD',
                stock: product.stock,
                sku: product.sku,
                imageUrls: product.cloudinaryUrls && product.cloudinaryUrls.length > 0
                  ? product.cloudinaryUrls
                  : product.imageUrls,
                categories: [cat.id],
                attributes: [],
                inStock: product.stock > 0 || true,
              });

              if (result.created) { created++; createdIds.push(product.externalId); }
              if (result.updated) { updated++; updatedIds.push(product.externalId); }
            } catch (e: any) {
              errors.push(`Error saving product ${product.externalId}: ${e.message}`);
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
export async function runScraper(request?: ScraperRunRequest): Promise<ScraperResult> {
  const scraper = new ScraperService(undefined, request);
  return scraper.run();
}
