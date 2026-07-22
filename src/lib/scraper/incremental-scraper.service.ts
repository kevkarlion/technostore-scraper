/**
 * Incremental Scraper Service — Axios + Cheerio.
 *
 * Provides the pre-check + full-scrape pipeline used by the scheduler
 * and the HTTP API. No browser, no Playwright — pure HTTP + HTML parsing.
 *
 * Flow:
 *   1. preCheckCategories(): GET first page of each category, compute hash,
 *      compare with scraper_state.
 *   2. runIncrementalScraper(): pre-check → scrape all categories via
 *      runScraper() → return results.
 */

import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { jotakpCategories, getScraperConfig } from './config';
import { runScraper } from './scraper.service';
import { createHttpClient, safeGet, getRequestDelay, delay } from './http-client';
import type { AxiosInstance } from 'axios';

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
 * Fetch all product IDs from a category (all pages) for pre-check.
 * This detects products that are NEW (not in previous scrape) or DISABLED (no longer present).
 */
async function getCategoryPreview(
  client: AxiosInstance,
  idsubrubro1: number,
  baseUrl: string,
): Promise<{ contentHash: string; productCount: number; productIds: string[]; firstPriceUsd: number | null } | null> {
  try {
    const productIds: string[] = [];
    const seenIds = new Set<string>();
    const maxPages = 20;
    const pageDelayMs = 100; // Lightweight delay between pages
    let firstPriceUsd: number | null = null;

    // Iterate through all pages to collect ALL product IDs
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = `${baseUrl}/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=${pageNum}&conIva=1`;
      const html = await safeGet(client, url, 3, pageDelayMs);
      const $ = cheerio.load(html);

      // Extract product IDs from this page
      const linksOnPage = $('a[href*="articulo.aspx?id="]').length;
      if (linksOnPage === 0) {
        // No more products on this page - we've reached the end
        break;
      }

      // Extract first price only from page 1
      if (pageNum === 1) {
        const firstLink = $('a[href*="articulo.aspx?id="]').first();
        const firstText = firstLink.text().trim();
        const priceMatch = firstText.match(/U\$D\s+([\d.,]+)/);
        if (priceMatch) {
          firstPriceUsd = parseFloat(priceMatch[1].replace(',', '.'));
        }
      }

      $('a[href*="articulo.aspx?id="]').each((_: any, el: any) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/id=(\d+)/);
        if (match && !seenIds.has(match[1])) {
          seenIds.add(match[1]);
          productIds.push(match[1]);
        }
      });

      console.log(`[Pre-check] Page ${pageNum}: ${linksOnPage} products, total so far: ${productIds.length}`);
    }

    // Hash of sorted IDs for change detection (stable across page order variations)
    const sortedIds = [...productIds].sort();
    const contentHash = crypto.createHash('md5').update(sortedIds.join(',')).digest('hex');

    console.log(`[Pre-check] Category ${idsubrubro1}: ${productIds.length} total products`);

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
          
          // Compare product IDs to detect new/disabled products
          // Use sorted arrays for stable comparison
          const existingIds = existing?.productIds ? [...existing.productIds].sort() : [];
          const newIds = [...preview.productIds].sort();
          const hasChanged = !existing || JSON.stringify(existingIds) !== JSON.stringify(newIds);

          // Determine what changed (new vs discontinued)
          const existingSet = new Set(existing?.productIds || []);
          const newSet = new Set(preview.productIds);
          const newProducts: string[] = [];
          const discontinuedProducts: string[] = [];

          for (const id of preview.productIds) {
            if (!existingSet.has(id)) newProducts.push(id);
          }
          for (const id of existing?.productIds || []) {
            if (!newSet.has(id)) discontinuedProducts.push(id);
          }

          // Log changes detected
          if (hasChanged) {
            console.log(
              `[Pre-check] ${cat.id}: CHANGED | ` +
              `new=${newProducts.length}, discontinued=${discontinuedProducts.length}, ` +
              `total=${preview.productCount} products`
            );
            if (newProducts.length > 0) {
              console.log(`[Pre-check]   NEW products: ${newProducts.slice(0, 5).join(', ')}${newProducts.length > 5 ? '...' : ''}`);
            }
            if (discontinuedProducts.length > 0) {
              console.log(`[Pre-check]   DISCONTINUED: ${discontinuedProducts.slice(0, 5).join(', ')}${discontinuedProducts.length > 5 ? '...' : ''}`);
            }
          }

          // Update scraper_state with all product IDs (now we track ALL, not just page 1)
          await db.collection('scraper_state').updateOne(
            { categoryId: cat.id },
            {
              $set: {
                categoryId: cat.id,
                idsubrubro1: cat.idsubrubro1,
                contentHash: preview.contentHash,
                productCount: preview.productCount,
                productIds: preview.productIds, // Store ALL product IDs from all pages
                firstPriceUsd: preview.firstPriceUsd,
                capturedAt: new Date(),
              },
            },
            { upsert: true },
          );

          const state = await db.collection('scraper_state').findOne({ categoryId: cat.id });
          const storedCount = state?.productIds?.length || 0;
          if (!hasChanged) {
            console.log(
              `[Pre-check] ${cat.id}: unchanged | ` +
              `total=${preview.productCount} products`
            );
          }

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
// RUN INCREMENTAL SCRAPER
// ============================================================================

/**
 * Run the full incremental scraper:
 *   1. Pre-check categories to detect changes.
 *   2. Scrape only changed categories (pre-check product IDs used for discontinued).
 *   3. Return aggregated results.
 *
 * Session optimization: creates ONE authenticated HTTP session shared across all
 * categories, instead of logging in 127 times.
 * 
 * @param forceFullScrape - If true, skip pre-check and scrape all categories.
 * @param categoryId - Optional parent category ID to scrape (e.g., 'conectividad'). 
 *                     If provided, only subcategories of this parent are processed.
 */
export async function runIncrementalScraper(forceFullScrape: boolean = false, categoryId?: string, skipExistingCheck: boolean = false): Promise<{
  success: boolean;
  preCheck: { total: number; changed: string[]; unchanged: string[]; errors: string[] };
  scrapeResult?: { created: number; updated: number; createdIds: string[]; updatedIds: string[]; errors: string[]; durationMs: number; discontinued: number };
  timestamp: Date;
}> {
  console.log('[Incremental] Starting incremental scraper...');

  const config = getScraperConfig();
  
  // Filter categories: if categoryId is provided, only use matching subcategories
  // Supports both parent IDs (e.g., 'conectividad' → all its subcategories)
  // and direct subcategory IDs (e.g., 'routers' → just that one)
  let categories = jotakpCategories.filter((c) => c.idsubrubro1 > 0);
  if (categoryId) {
    const asParent = categories.filter((c) => c.parentId === categoryId);
    if (asParent.length > 0) {
      categories = asParent;
      console.log(`[Incremental] Filtering to parent "${categoryId}" — ${categories.length} subcategories`);
    } else {
      // categoryId is itself a subcategory
      categories = categories.filter((c) => c.id === categoryId);
      console.log(`[Incremental] Filtering to subcategory "${categoryId}" — ${categories.length} categories`);
    }
  }

  // Create ONE shared HTTP client for the entire run
  const sharedHttp = createHttpClient(config);

  // Login ONCE — this populates the cookie jar on sharedHttp
  const { ScraperService } = await import('./scraper.service');
  const bootScraper = new ScraperService(config, {}, sharedHttp);
  await bootScraper.login();
  console.log('[Incremental] Shared session established for all categories');

  // Global timeout: abort if entire run takes > 30 minutes
  const GLOBAL_TIMEOUT_MS = 30 * 60 * 1000;
  const globalTimeout = setTimeout(() => {
    console.error('[Incremental] GLOBAL TIMEOUT: scraper exceeded 30 minutes, aborting');
    process.exit(1);
  }, GLOBAL_TIMEOUT_MS);

  // Step 1: Pre-check
  let preCheckResult: { changed: string[]; unchanged: string[]; errors: string[] };
  if (forceFullScrape) {
    console.log('[Incremental] Force full scrape — skipping pre-check');
    preCheckResult = { changed: categories.map((c) => c.id), unchanged: [], errors: [] };
  } else {
    // Pass category IDs to preCheckCategories for filtering
    preCheckResult = await preCheckCategories(categories.map((c) => c.id));
  }

  const toScrape = [...preCheckResult.changed, ...preCheckResult.errors];

  // Collect existing product IDs per category from pre-check — Playwright will skip these
  // UNLESS skipExistingCheck is true (forces Playwright to re-enrich ALL products)
  const db = await getDb();
  const existingProductIdsByCategory = new Map<string, string[]>();
  if (!skipExistingCheck) {
    for (const categoryId of preCheckResult.changed) {
      const state = await db.collection('scraper_state').findOne({ categoryId });
      if (state?.productIds?.length > 0) {
        existingProductIdsByCategory.set(categoryId, state.productIds);
        console.log(
          `[Incremental] ${categoryId}: ${state.productIds.length} known products from previous scrape — Playwright will skip these`
        );
      }
    }
  } else {
    console.log('[Incremental] skipExistingCheck=true — Playwright will re-enrich ALL products');
  }

  console.log(
    `[Incremental] Pre-check: ${preCheckResult.changed.length} changed, ${preCheckResult.unchanged.length} unchanged, ${preCheckResult.errors.length} errors — scraping ${toScrape.length} categories`
  );

  const scrapeResults = { created: 0, updated: 0, createdIds: [] as string[], updatedIds: [] as string[], errors: [] as string[], durationMs: 0, discontinued: 0 };
  const startTime = Date.now();
  const MAX_PARALLEL = 4;

  // Step 2a: Mark discontinued + update timestamp for UNCHANGED categories
  // Uses the product IDs captured during the last successful full scrape (already in scraper_state).
  let totalDiscontinued = 0;
  for (const categoryId of preCheckResult.unchanged) {
    try {
      const state = await db.collection('scraper_state').findOne({ categoryId });
      if (state?.productIds?.length > 0) {
        const discontinuedCount = await markDiscontinuedFromIds(categoryId, state.productIds);
        totalDiscontinued += discontinuedCount;
        if (discontinuedCount > 0) {
          console.log(`[Discontinued] ${categoryId}: marked ${discontinuedCount} products as discontinued (from ${state.productIds.length} known IDs)`);
        } else {
          console.log(`[Discontinued] ${categoryId}: no changes (all ${state.productIds.length} products still active)`);
        }
      }
      await db.collection('scraper_state').updateOne(
        { categoryId },
        { $set: { lastScrapeAt: new Date() } },
      );
    } catch (e: any) {
      console.error(`[Discontinued] ${categoryId}: ERROR — ${e.message}`);
    }
  }
  scrapeResults.discontinued = totalDiscontinued;

  // Step 2b: Scrape only CHANGED + ERROR categories, sharing the authenticated session
  const CATEGORY_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes per category

  for (let i = 0; i < toScrape.length; i += MAX_PARALLEL) {
    const batch = toScrape.slice(i, i + MAX_PARALLEL);
    console.log(`[Incremental] Scraping batch ${Math.floor(i / MAX_PARALLEL) + 1}: ${batch.join(', ')}`);

    const batchResults = await Promise.all(
      batch.map(async (categoryId) => {
        try {
          // Pass existing product IDs so Playwright only enriches NEW products
          const existingProductIds = existingProductIdsByCategory.get(categoryId) || [];
          const scraperPromise = runScraper(
            { categoryId, source: 'incremental', skipLogin: true, existingProductIds },
            sharedHttp,
          );
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Category ${categoryId} timed out after 3 minutes`)), CATEGORY_TIMEOUT_MS)
          );

          const result = await Promise.race([scraperPromise, timeoutPromise]);

          // scraper_state.productIds is now updated by scraper.service.ts itself
          // (runs for ALL sources, not just incremental)

          return result;
        } catch (e: any) {
          console.error(`[Incremental] Error scraping ${categoryId}:`, e.message);
          return { created: 0, updated: 0, createdIds: [], updatedIds: [], errors: [`Error scraping ${categoryId}: ${e.message}`], success: false };
        }
      }),
    );

    for (const r of batchResults) {
      scrapeResults.created += r.created || 0;
      scrapeResults.updated += r.updated || 0;
      if (r.createdIds) scrapeResults.createdIds.push(...r.createdIds);
      if (r.updatedIds) scrapeResults.updatedIds.push(...r.updatedIds);
      if (r.errors) {
        scrapeResults.errors.push(...r.errors);
      }
    }
  }

  scrapeResults.durationMs = Date.now() - startTime;
  clearTimeout(globalTimeout);
  console.log(
    `[Incremental] Done in ${(scrapeResults.durationMs / 1000).toFixed(1)}s: ` +
    `${scrapeResults.created} created, ${scrapeResults.updated} updated, ` +
    `${scrapeResults.discontinued} discontinued | ` +
    `scraped ${toScrape.length}/${categories.length} categories`
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

/**
 * Mark products as discontinued if they're NOT in the given active IDs list.
 * Uses the same logic as productRepository.markDiscontinued but directly.
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
