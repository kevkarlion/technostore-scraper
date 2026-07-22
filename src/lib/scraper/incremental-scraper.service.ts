/**
 * Incremental Scraper Service — Two-phase pipeline.
 *
 * Phase 1 (Axios/HTTP-only):
 *   - preCheckCategories(): hash page 1 of each category, compare with scraper_state.
 *   - scrapeCategory(): listing pages → product IDs, names, listing images.
 *   - Compare with DB → identify NEW products.
 *   - If no new products → DONE (no browser needed, 99% of runs).
 *
 * Phase 2 (Playwright — only if new products exist):
 *   - Launch ONE browser instance.
 *   - Enrich each new product from detail page (price, description, SKU, stock, images).
 *   - Upsert to DB.
 *   - Close browser.
 */

import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { jotakpCategories, getScraperConfig } from './config';
import { ScraperService, productRepository } from './scraper.service';
import { PlaywrightEnricher } from './playwright-enricher';
import { createHttpClient, safeGet, getRequestDelay, delay } from './http-client';
import type { AxiosInstance } from 'axios';
import type { RawProduct } from './types';

// ============================================================================
// PERSISTENT STORE (same singleton pattern as scraper.service)
// ============================================================================

let dbInstance: any = null;
let mongoClient: any = null;

async function getDb(): Promise<any> {
  if ((global as any).db) {
    return (global as any).db;
  }
  if (!dbInstance) {
    const { MongoClient } = await import('mongodb');
    const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
    const DB_NAME = process.env.DB_NAME || process.env.MONGODB_DB_NAME || 'ecommerce';
    if (!MONGO_URI) throw new Error('MONGO_URI is required');

    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    dbInstance = mongoClient.db(DB_NAME);
  }
  return dbInstance;
}

// ============================================================================
// PRE-CHECK CATEGORIES
// ============================================================================

/**
 * Fetch one page preview for a category, extracting hash + product count.
 */
async function getCategoryPreview(
  client: AxiosInstance,
  idsubrubro1: number,
  baseUrl: string,
): Promise<{ contentHash: string; productCount: number; productIds: string[]; firstPriceUsd: number | null } | null> {
  try {
    const url = `${baseUrl}/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=1&conIva=1`;
    const html = await safeGet(client, url, 3, 100); // 100ms delay for lightweight pre-check
    const $ = cheerio.load(html);
    const contentHash = crypto.createHash('md5').update(html).digest('hex');

    const productIds: string[] = [];
    $('a[href*="articulo.aspx?id="]').each((_: any, el: any) => {
      const href = $(el).attr('href') || '';
      const match = href.match(/id=(\d+)/);
      if (match && !productIds.includes(match[1])) {
        productIds.push(match[1]);
      }
    });

    // First price for quick comparison
    let firstPriceUsd: number | null = null;
    const firstLink = $('a[href*="articulo.aspx?id="]').first();
    const firstText = firstLink.text().trim();
    const priceMatch = firstText.match(/U\$D\s+([\d.,]+)/);
    if (priceMatch) {
      firstPriceUsd = parseFloat(priceMatch[1].replace(',', '.'));
    }

    return { contentHash, productCount: productIds.length, productIds, firstPriceUsd };
  } catch (e: any) {
    console.error('[Pre-check] Error:', e.message);
    return null;
  }
}

/**
 * Pre-check all categories in parallel batches.
 * Returns which categories have changed since last scrape.
 * 
 * @param categoryFilter - Optional array of category IDs to check. If provided, only these categories are checked.
 */
export async function preCheckCategories(categoryFilter?: string[]): Promise<{
  changed: string[];
  unchanged: string[];
  errors: string[];
}> {
  const result = { changed: [] as string[], unchanged: [] as string[], errors: [] as string[] };
  const config = getScraperConfig();
  const client = createHttpClient(config);
  
  // Filter categories: only subcategories (idsubrubro1 > 0), optionally filtered by parent
  let categories = jotakpCategories.filter((c) => c.idsubrubro1 > 0);
  if (categoryFilter && categoryFilter.length > 0) {
    // Find all subcategories whose parent is in the filter, or that are directly in the filter
    const filterSet = new Set(categoryFilter);
    categories = categories.filter((c) => filterSet.has(c.id) || filterSet.has(c.parentId || ''));
  }

  console.log(`[Incremental] Pre-checking ${categories.length} categories...`);

  const MAX_PARALLEL = 4;

  for (let i = 0; i < categories.length; i += MAX_PARALLEL) {
    const batch = categories.slice(i, i + MAX_PARALLEL);
    console.log(`[Incremental] Batch ${Math.floor(i / MAX_PARALLEL) + 1}: ${batch.map((c) => c.name || c.id).join(', ')}`);

    const batchResults = await Promise.all(
      batch.map(async (cat) => {
        try {
          const preview = await getCategoryPreview(client, cat.idsubrubro1, config.baseUrl);
          if (!preview) return { categoryId: cat.id, status: 'error' as const };

          const db = await getDb();
          const existing = await db.collection('scraper_state').findOne({ categoryId: cat.id });
          const hasChanged = !existing || existing.contentHash !== preview.contentHash;

          // Only update hash/count/price — productIds are maintained by full scrape
          await db.collection('scraper_state').updateOne(
            { categoryId: cat.id },
            {
              $set: {
                categoryId: cat.id,
                idsubrubro1: cat.idsubrubro1,
                contentHash: preview.contentHash,
                productCount: preview.productCount,
                firstPriceUsd: preview.firstPriceUsd,
                capturedAt: new Date(),
              },
              // Initialize productIds only on first insert
              $setOnInsert: {
                productIds: preview.productIds,
              },
            },
            { upsert: true },
          );

          const state = await db.collection('scraper_state').findOne({ categoryId: cat.id });
          const storedCount = state?.productIds?.length || 0;
          console.log(
            `[Pre-check] ${cat.id}: ${hasChanged ? 'CHANGED' : 'unchanged'} ` +
            `| page1=${preview.productCount} products | stored=${storedCount} total IDs`
          );

          return { categoryId: cat.id, status: hasChanged ? ('changed' as const) : ('unchanged' as const) };
        } catch (e: any) {
          console.error(`[Pre-check] ${cat.id}: ERROR — ${e.message}`);
          return { categoryId: cat.id, status: 'error' as const };
        }
      }),
    );

    for (const r of batchResults) {
      if (r.status === 'changed') result.changed.push(r.categoryId);
      else if (r.status === 'unchanged') result.unchanged.push(r.categoryId);
      else result.errors.push(r.categoryId);
    }
  }

  console.log(
    `[Incremental] Pre-check complete: ${result.changed.length} changed, ${result.unchanged.length} unchanged, ${result.errors.length} errors`
  );
  return result;
}

// ============================================================================
// RUN INCREMENTAL SCRAPER — Two-phase pipeline
// ============================================================================

interface NewProduct {
  externalId: string;
  name: string;
  imageUrls: string[];
  categoryId: string;
  idsubrubro1: number;
}

/**
 * Run the incremental scraper in two phases:
 *
 * Phase 1 (Axios/HTTP-only, no browser):
 *   - Pre-check categories to detect changes.
 *   - Scrape listing pages → product IDs, names, listing images.
 *   - Compare with DB → identify NEW products.
 *   - If no new products → DONE (99% of runs).
 *
 * Phase 2 (Playwright, only if new products exist):
 *   - Launch ONE browser instance.
 *   - Enrich each new product from detail page.
 *   - Upsert to DB.
 *   - Close browser.
 *
 * @param forceFullScrape - If true, skip pre-check and scrape all categories.
 * @param categoryId - Optional parent/subcategory ID to filter.
 * @param skipExistingCheck - If true, re-enrich ALL products (not just new ones).
 */
export async function runIncrementalScraper(forceFullScrape: boolean = false, categoryId?: string, skipExistingCheck: boolean = false): Promise<{
  success: boolean;
  preCheck: { total: number; changed: string[]; unchanged: string[]; errors: string[] };
  scrapeResult?: { created: number; updated: number; createdIds: string[]; updatedIds: string[]; errors: string[]; durationMs: number; discontinued: number };
  timestamp: Date;
}> {
  console.log('[Incremental] Starting incremental scraper (two-phase)...');
  const startTime = Date.now();

  const config = getScraperConfig();

  // Filter categories
  let categories = jotakpCategories.filter((c) => c.idsubrubro1 > 0);
  if (categoryId) {
    const asParent = categories.filter((c) => c.parentId === categoryId);
    if (asParent.length > 0) {
      categories = asParent;
      console.log(`[Incremental] Filtering to parent "${categoryId}" — ${categories.length} subcategories`);
    } else {
      categories = categories.filter((c) => c.id === categoryId);
      console.log(`[Incremental] Filtering to subcategory "${categoryId}" — ${categories.length} categories`);
    }
  }

  // Create ONE shared HTTP client + login ONCE
  const sharedHttp = createHttpClient(config);
  const bootScraper = new ScraperService(config, {}, sharedHttp);
  await bootScraper.login();
  console.log('[Incremental] Shared HTTP session established');

  // Global timeout: 30 minutes
  const GLOBAL_TIMEOUT_MS = 30 * 60 * 1000;
  const globalTimeout = setTimeout(() => {
    console.error('[Incremental] GLOBAL TIMEOUT: scraper exceeded 30 minutes, aborting');
    process.exit(1);
  }, GLOBAL_TIMEOUT_MS);

  // ============================================================================
  // STEP 1: Pre-check
  // ============================================================================
  let preCheckResult: { changed: string[]; unchanged: string[]; errors: string[] };
  if (forceFullScrape) {
    console.log('[Incremental] Force full scrape — skipping pre-check');
    preCheckResult = { changed: categories.map((c) => c.id), unchanged: [], errors: [] };
  } else {
    preCheckResult = await preCheckCategories(categories.map((c) => c.id));
  }

  const toScrape = [...preCheckResult.changed, ...preCheckResult.errors];

  // Collect existing product IDs per category
  const db = await getDb();
  const existingProductIdsByCategory = new Map<string, string[]>();
  if (!skipExistingCheck) {
    for (const catId of preCheckResult.changed) {
      const state = await db.collection('scraper_state').findOne({ categoryId: catId });
      if (state?.productIds?.length > 0) {
        existingProductIdsByCategory.set(catId, state.productIds);
        console.log(`[Incremental] ${catId}: ${state.productIds.length} known products`);
      }
    }
  } else {
    console.log('[Incremental] skipExistingCheck=true — will re-enrich ALL products');
  }

  console.log(
    `[Incremental] Pre-check: ${preCheckResult.changed.length} changed, ` +
    `${preCheckResult.unchanged.length} unchanged, ${preCheckResult.errors.length} errors`
  );

  // ============================================================================
  // STEP 2: Mark discontinued for UNCHANGED categories (HTTP-only, no browser)
  // ============================================================================
  let totalDiscontinued = 0;
  for (const catId of preCheckResult.unchanged) {
    try {
      const state = await db.collection('scraper_state').findOne({ categoryId: catId });
      if (state?.productIds?.length > 0) {
        const discontinuedCount = await markDiscontinuedFromIds(catId, state.productIds);
        totalDiscontinued += discontinuedCount;
        if (discontinuedCount > 0) {
          console.log(`[Discontinued] ${catId}: marked ${discontinuedCount} products`);
        }
      }
      await db.collection('scraper_state').updateOne(
        { categoryId: catId },
        { $set: { lastScrapeAt: new Date() } },
      );
    } catch (e: any) {
      console.error(`[Discontinued] ${catId}: ERROR — ${e.message}`);
    }
  }

  // ============================================================================
  // PHASE 1: HTTP-only discovery — listing pages → new product IDs
  // ============================================================================
  console.log(`\n[Phase 1] HTTP-only discovery for ${toScrape.length} categories...`);

  const newProducts: NewProduct[] = [];
  const categoryExternalIds: Record<string, string[]> = {};
  const scrapeErrors: string[] = [];

  for (const catId of toScrape) {
    const cat = jotakpCategories.find((c) => c.id === catId);
    if (!cat) continue;

    try {
      const scraper = new ScraperService(config, { categoryId: catId, skipLogin: true }, sharedHttp);
      const { products, externalIds } = await scraper.scrapeCategory(cat.idsubrubro1);
      categoryExternalIds[catId] = externalIds;

      // Identify new products (not in previous scraper_state)
      const existingIds = new Set(existingProductIdsByCategory.get(catId) || []);
      const newOnes = products.filter((p) => !existingIds.has(p.externalId));

      for (const p of newOnes) {
        newProducts.push({
          externalId: p.externalId,
          name: p.name,
          imageUrls: p.imageUrls,
          categoryId: catId,
          idsubrubro1: cat.idsubrubro1,
        });
      }

      console.log(
        `[Phase 1] ${catId}: ${products.length} products found, ` +
        `${newOnes.length} new, ${existingIds.size} existing`
      );
    } catch (e: any) {
      console.error(`[Phase 1] ${catId}: ERROR — ${e.message}`);
      scrapeErrors.push(`Error scanning ${catId}: ${e.message}`);
    }
  }

  console.log(
    `[Phase 1] Complete: ${newProducts.length} new products across ${toScrape.length} categories` +
    (newProducts.length > 0 ? ' → Playwright needed' : ' → DONE (no browser)')
  );

  // ============================================================================
  // PHASE 2: Playwright enrichment — only if new products exist
  // ============================================================================
  const scrapeResults = {
    created: 0, updated: 0,
    createdIds: [] as string[], updatedIds: [] as string[],
    errors: scrapeErrors, durationMs: 0, discontinued: totalDiscontinued,
  };

  if (newProducts.length > 0) {
    console.log(`\n[Phase 2] Playwright enrichment for ${newProducts.length} new products...`);

    // Group new products by category for listing price extraction
    const productsByCategory = new Map<string, NewProduct[]>();
    for (const p of newProducts) {
      const existing = productsByCategory.get(p.categoryId) || [];
      existing.push(p);
      productsByCategory.set(p.categoryId, existing);
    }

    let enricher: PlaywrightEnricher | null = null;
    try {
      enricher = new PlaywrightEnricher();
      await enricher.launch();
      await enricher.initSession(config.baseUrl, {
        email: config.email,
        password: config.password,
      });
      console.log('[Phase 2] Playwright launched and session initialized');

      const ENRICHMENT_CONCURRENCY = 2;

      for (const [catId, catProducts] of productsByCategory) {
        const cat = jotakpCategories.find((c) => c.id === catId);
        if (!cat) continue;

        // Step 1: Extract listing prices via Playwright (with conIva=1)
        // Prices are JS-rendered — only available through Playwright
        const listingPrices = new Map<string, string>();
        try {
          const maxPages = 20;
          for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
            const pagePrices = await enricher!.extractListingPrices(cat.idsubrubro1, pageNum);
            if (pagePrices.size === 0) break;
            for (const [id, price] of pagePrices) {
              listingPrices.set(id, price);
            }
          }
          console.log(`[Phase 2] ${catId}: ${listingPrices.size} listing prices extracted`);
        } catch (e: any) {
          console.error(`[Phase 2] ${catId}: failed to extract listing prices — ${e.message}`);
        }

        // Step 2: Enrich new products — detail page for desc/SKU/stock/images,
        // listing price for costPrice (reliable source from rendered listing)
        for (let i = 0; i < catProducts.length; i += ENRICHMENT_CONCURRENCY) {
          const batch = catProducts.slice(i, i + ENRICHMENT_CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map(async (product) => {
              const enriched = await enricher!.enrichProduct(product.externalId, config.baseUrl);

              // Build upsert payload
              const upsertPayload: any = {
                externalId: product.externalId,
                name: product.name,
                categories: [product.categoryId],
              };

              // Price from listing page (reliable, with conIva=1) — NOT from detail page
              const listingPrice = listingPrices.get(product.externalId);
              if (listingPrice) {
                let cleaned = listingPrice.replace(/[$€£¥₹]/g, '').replace(/\s/g, '').trim();
                const lastDot = cleaned.lastIndexOf('.');
                const lastComma = cleaned.lastIndexOf(',');
                if (lastComma > lastDot) {
                  cleaned = cleaned.replace(/\./g, '').replace(',', '.');
                } else {
                  cleaned = cleaned.replace(/,/g, '');
                }
                const price = parseFloat(cleaned);
                if (!isNaN(price) && price > 0) {
                  upsertPayload.costPrice = price;
                  upsertPayload.currency = 'USD';
                }
              }

              // Other fields from detail page
              if (enriched.description) upsertPayload.description = enriched.description;
              if (enriched.sku) upsertPayload.sku = enriched.sku;
              if (enriched.stock !== undefined) upsertPayload.stock = enriched.stock;

              // Images: prefer detail page images, fall back to listing images
              const images = enriched.imageUrls?.length > 0 ? enriched.imageUrls : product.imageUrls;
              if (images?.length > 0) upsertPayload.imageUrls = images;

              // Upsert
              const result = await productRepository.atomicUpsertByExternalId(upsertPayload);

              if (result.created) {
                return { ...result, externalId: product.externalId, action: 'created' as const };
              } else if (result.updated) {
                return { ...result, externalId: product.externalId, action: 'updated' as const };
              }
              return { ...result, externalId: product.externalId, action: 'unchanged' as const };
            })
          );

          for (const r of results) {
            if (r.status === 'fulfilled') {
              if (r.value.action === 'created') {
                scrapeResults.created++;
                scrapeResults.createdIds.push(r.value.externalId);
              } else if (r.value.action === 'updated') {
                scrapeResults.updated++;
                scrapeResults.updatedIds.push(r.value.externalId);
              }
            } else {
              const msg = (r as PromiseRejectedResult).reason?.message || String(r);
              console.error(`[Phase 2] Enrichment failed: ${msg}`);
              scrapeResults.errors.push(msg);
            }
          }

          console.log(
            `[Phase 2] ${catId} batch ${Math.floor(i / ENRICHMENT_CONCURRENCY) + 1}: ` +
            `${results.filter((r) => r.status === 'fulfilled').length}/${batch.length} enriched`
          );
        }
      }
    } catch (e: any) {
      console.error(`[Phase 2] Playwright error: ${e.message}`);
      scrapeResults.errors.push(`Playwright error: ${e.message}`);
    } finally {
      await enricher?.close();
      console.log('[Phase 2] Playwright closed');
    }
  }

  // ============================================================================
  // STEP 3: Update scraper_state for CHANGED categories
  // ============================================================================
  for (const catId of toScrape) {
    const externalIds = categoryExternalIds[catId];
    if (!externalIds) continue;
    try {
      await db.collection('scraper_state').updateOne(
        { categoryId: catId },
        { $set: { productIds: externalIds, lastScrapeAt: new Date() } },
        { upsert: true },
      );
    } catch (e: any) {
      console.error(`[Incremental] ${catId}: failed to update scraper_state — ${e.message}`);
    }
  }

  // ============================================================================
  // Done
  // ============================================================================
  scrapeResults.durationMs = Date.now() - startTime;
  clearTimeout(globalTimeout);

  console.log(
    `\n[Incremental] Done in ${(scrapeResults.durationMs / 1000).toFixed(1)}s: ` +
    `${scrapeResults.created} created, ${scrapeResults.updated} updated, ` +
    `${scrapeResults.discontinued} discontinued | ` +
    `new products enriched: ${newProducts.length > 0 ? 'yes' : 'none (fast path)'}`
  );

  return {
    success: true,
    preCheck: {
      total: categories.length,
      changed: preCheckResult.changed,
      unchanged: preCheckResult.unchanged,
      errors: preCheckResult.errors,
    },
    scrapeResult: scrapeResults,
    timestamp: new Date(),
  };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Mark products as discontinued if they're NOT in the given active IDs list.
 */
async function markDiscontinuedFromIds(categoryId: string, activeExternalIds: string[]): Promise<number> {
  const db = await getDb();
  const collection = db.collection('products');
  const result = await collection.updateMany(
    {
      categories: categoryId,
      supplier: 'jotakp',
      externalId: { $nin: activeExternalIds },
      status: { $ne: 'discontinued' },
    },
    { $set: { status: 'discontinued', discontinuedAt: new Date(), updatedAt: new Date() } },
  );
  return result.modifiedCount;
}
