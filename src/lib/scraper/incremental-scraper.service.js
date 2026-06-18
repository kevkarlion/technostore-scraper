"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.preCheckCategories = preCheckCategories;
exports.runIncrementalScraper = runIncrementalScraper;
const cheerio = __importStar(require("cheerio"));
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("./config");
const scraper_service_1 = require("./scraper.service");
const http_client_1 = require("./http-client");
// ============================================================================
// PERSISTENT STORE (same singleton pattern as scraper.service)
// ============================================================================
let dbInstance = null;
let mongoClient = null;
async function getDb() {
    if (global.db) {
        return global.db;
    }
    if (!dbInstance) {
        const { MongoClient } = await Promise.resolve().then(() => __importStar(require('mongodb')));
        const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
        const DB_NAME = process.env.DB_NAME || process.env.MONGODB_DB_NAME || 'ecommerce';
        if (!MONGO_URI)
            throw new Error('MONGO_URI is required');
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
async function getCategoryPreview(client, idsubrubro1, baseUrl) {
    try {
        const url = `${baseUrl}/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=1`;
        const html = await (0, http_client_1.safeGet)(client, url);
        const $ = cheerio.load(html);
        const contentHash = crypto_1.default.createHash('md5').update(html).digest('hex');
        const productIds = [];
        $('a[href*="articulo.aspx?id="]').each((_, el) => {
            const href = $(el).attr('href') || '';
            const match = href.match(/id=(\d+)/);
            if (match && !productIds.includes(match[1])) {
                productIds.push(match[1]);
            }
        });
        // First price for quick comparison
        let firstPriceUsd = null;
        const firstLink = $('a[href*="articulo.aspx?id="]').first();
        const firstText = firstLink.text().trim();
        const priceMatch = firstText.match(/U\$D\s+([\d.,]+)/);
        if (priceMatch) {
            firstPriceUsd = parseFloat(priceMatch[1].replace(',', '.'));
        }
        return { contentHash, productCount: productIds.length, productIds, firstPriceUsd };
    }
    catch (e) {
        console.error('[Pre-check] Error:', e.message);
        return null;
    }
}
/**
 * Pre-check all categories in parallel batches.
 * Returns which categories have changed since last scrape.
 */
async function preCheckCategories() {
    const result = { changed: [], unchanged: [], errors: [] };
    const config = (0, config_1.getScraperConfig)();
    const client = (0, http_client_1.createHttpClient)(config);
    const categories = config_1.jotakpCategories.filter((c) => c.idsubrubro1 > 0);
    console.log(`[Incremental] Pre-checking ${categories.length} categories...`);
    const MAX_PARALLEL = 4;
    for (let i = 0; i < categories.length; i += MAX_PARALLEL) {
        const batch = categories.slice(i, i + MAX_PARALLEL);
        console.log(`[Incremental] Batch ${Math.floor(i / MAX_PARALLEL) + 1}: ${batch.map((c) => c.name || c.id).join(', ')}`);
        const batchResults = await Promise.all(batch.map(async (cat) => {
            try {
                const preview = await getCategoryPreview(client, cat.idsubrubro1, config.baseUrl);
                if (!preview)
                    return { categoryId: cat.id, status: 'error' };
                const db = await getDb();
                const existing = await db.collection('scraper_state').findOne({ categoryId: cat.id });
                const hasChanged = !existing || existing.contentHash !== preview.contentHash;
                await db.collection('scraper_state').updateOne({ categoryId: cat.id }, {
                    $set: {
                        categoryId: cat.id,
                        idsubrubro1: cat.idsubrubro1,
                        contentHash: preview.contentHash,
                        productCount: preview.productCount,
                        productIds: preview.productIds,
                        firstPriceUsd: preview.firstPriceUsd,
                        capturedAt: new Date(),
                    },
                }, { upsert: true });
                return { categoryId: cat.id, status: hasChanged ? 'changed' : 'unchanged' };
            }
            catch (e) {
                console.error(`[Incremental] Error pre-checking ${cat.id}:`, e.message);
                return { categoryId: cat.id, status: 'error' };
            }
        }));
        for (const r of batchResults) {
            if (r.status === 'changed')
                result.changed.push(r.categoryId);
            else if (r.status === 'unchanged')
                result.unchanged.push(r.categoryId);
            else
                result.errors.push(r.categoryId);
        }
    }
    console.log(`[Incremental] Pre-check complete: ${result.changed.length} changed, ${result.unchanged.length} unchanged, ${result.errors.length} errors`);
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
async function runIncrementalScraper(forceFullScrape = false) {
    console.log('[Incremental] Starting incremental scraper...');
    const categories = config_1.jotakpCategories.filter((c) => c.idsubrubro1 > 0);
    // Step 1: Pre-check
    let preCheckResult;
    if (forceFullScrape) {
        console.log('[Incremental] Force full scrape — skipping pre-check');
        preCheckResult = { changed: categories.map((c) => c.id), unchanged: [], errors: [] };
    }
    else {
        preCheckResult = await preCheckCategories();
    }
    console.log(`[Incremental] Pre-check: ${preCheckResult.changed.length} changed, ${preCheckResult.unchanged.length} unchanged`);
    // Step 2: Scrape ALL categories (to update stock)
    console.log('[Incremental] Scraping all categories for stock update...');
    const scrapeResults = { created: 0, updated: 0, errors: [], durationMs: 0 };
    const startTime = Date.now();
    const allCategoryIds = categories.map((c) => c.id);
    const MAX_PARALLEL = 4;
    for (let i = 0; i < allCategoryIds.length; i += MAX_PARALLEL) {
        const batch = allCategoryIds.slice(i, i + MAX_PARALLEL);
        console.log(`[Incremental] Scraping batch ${Math.floor(i / MAX_PARALLEL) + 1}: ${batch.join(', ')}`);
        const batchResults = await Promise.all(batch.map(async (categoryId) => {
            try {
                const result = await (0, scraper_service_1.runScraper)({ categoryId, source: 'incremental' });
                // Update state
                const db = await getDb();
                await db.collection('scraper_state').updateOne({ categoryId }, { $set: { lastScrapeAt: new Date() } });
                return result;
            }
            catch (e) {
                console.error(`[Incremental] Error scraping ${categoryId}:`, e.message);
                return { created: 0, updated: 0, errors: [`Error scraping ${categoryId}: ${e.message}`], success: false };
            }
        }));
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
