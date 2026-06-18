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
 * Fetch one page preview for a category, extracting hash + product count.
 */
async function getCategoryPreview(
  client: AxiosInstance,
  idsubrubro1: number,
  baseUrl: string,
): Promise<{ contentHash: string; productCount: number; productIds: string[]; firstPriceUsd: number | null } | null> {
  try {
    const url = `${baseUrl}/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=1`;
    const html = await safeGet(client, url);
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
 */
export async function preCheckCategories(): Promise<{
  changed: string[];
  unchanged: string[];
  errors: string[];
}> {
  const result = { changed: [] as string[], unchanged: [] as string[], errors: [] as string[] };
  const config = getScraperConfig();
  const client = createHttpClient(config);
  const categories = jotakpCategories.filter((c) => c.idsubrubro1 > 0);

  console.log(`[Incremental] Pre-checking ${categories.length} categories...`);

  const MAX_PARALLEL = 2;

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

          await db.collection('scraper_state').updateOne(
            { categoryId: cat.id },
            {
              $set: {
                categoryId: cat.id,
                idsubrubro1: cat.idsubrubro1,
                contentHash: preview.contentHash,
                productCount: preview.productCount,
                productIds: preview.productIds,
                firstPriceUsd: preview.firstPriceUsd,
                capturedAt: new Date(),
              },
            },
            { upsert: true },
          );

          return { categoryId: cat.id, status: hasChanged ? ('changed' as const) : ('unchanged' as const) };
        } catch (e: any) {
          console.error(`[Incremental] Error pre-checking ${cat.id}:`, e.message);
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
    `[Incremental] Pre-check complete: ${result.changed.length} changed, ${result.unchanged.length} unchanged, ${result.errors.length} errors`,
  );
  return result;
}

// ============================================================================
// RUN INCREMENTAL SCRAPER
// ============================================================================

/**
 * Run the full incremental scraper:
 *   1. Pre-check categories to detect changes.
 *   2. Scrape ALL categories (for stock updates) via runScraper().
 *   3. Return aggregated results.
 */
export async function runIncrementalScraper(forceFullScrape: boolean = false): Promise<{
  success: boolean;
  preCheck: { total: number; changed: string[]; unchanged: string[]; errors: string[] };
  scrapeResult?: { created: number; updated: number; errors: string[]; durationMs: number };
  timestamp: Date;
}> {
  console.log('[Incremental] Starting incremental scraper...');

  const categories = jotakpCategories.filter((c) => c.idsubrubro1 > 0);

  // Step 1: Pre-check
  let preCheckResult: { changed: string[]; unchanged: string[]; errors: string[] };
  if (forceFullScrape) {
    console.log('[Incremental] Force full scrape — skipping pre-check');
    preCheckResult = { changed: categories.map((c) => c.id), unchanged: [], errors: [] };
  } else {
    preCheckResult = await preCheckCategories();
  }

  console.log(
    `[Incremental] Pre-check: ${preCheckResult.changed.length} changed, ${preCheckResult.unchanged.length} unchanged`,
  );

  // Step 2: Scrape ALL categories (to update stock)
  console.log('[Incremental] Scraping all categories for stock update...');
  const scrapeResults = { created: 0, updated: 0, errors: [] as string[], durationMs: 0 };
  const startTime = Date.now();

  const allCategoryIds = categories.map((c) => c.id);
  const MAX_PARALLEL = 2;

  for (let i = 0; i < allCategoryIds.length; i += MAX_PARALLEL) {
    const batch = allCategoryIds.slice(i, i + MAX_PARALLEL);
    console.log(`[Incremental] Scraping batch ${Math.floor(i / MAX_PARALLEL) + 1}: ${batch.join(', ')}`);

    const batchResults = await Promise.all(
      batch.map(async (categoryId) => {
        try {
          const result = await runScraper({ categoryId, source: 'incremental' });

          // Update state
          const db = await getDb();
          await db.collection('scraper_state').updateOne(
            { categoryId },
            { $set: { lastScrapeAt: new Date() } },
          );

          return result;
        } catch (e: any) {
          console.error(`[Incremental] Error scraping ${categoryId}:`, e.message);
          return { created: 0, updated: 0, errors: [`Error scraping ${categoryId}: ${e.message}`], success: false };
        }
      }),
    );

    for (const r of batchResults) {
      scrapeResults.created += r.created || 0;
      scrapeResults.updated += r.updated || 0;
      if (r.errors) {
        scrapeResults.errors.push(...r.errors);
      }
    }
  }

  scrapeResults.durationMs = Date.now() - startTime;
  console.log(`[Incremental] Done: ${scrapeResults.created} created, ${scrapeResults.updated} updated`);

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
