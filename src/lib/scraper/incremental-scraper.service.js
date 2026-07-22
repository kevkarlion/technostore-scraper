"use strict";
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
const playwright_enricher_1 = require("./playwright-enricher");
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
        const url = `${baseUrl}/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=1&conIva=1`;
        const html = await (0, http_client_1.safeGet)(client, url, 3, 100); // 100ms delay for lightweight pre-check
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
 *
 * @param categoryFilter - Optional array of category IDs to check. If provided, only these categories are checked.
 */
async function preCheckCategories(categoryFilter) {
    const result = { changed: [], unchanged: [], errors: [] };
    const config = (0, config_1.getScraperConfig)();
    const client = (0, http_client_1.createHttpClient)(config);
    // Filter categories: only subcategories (idsubrubro1 > 0), optionally filtered by parent
    let categories = config_1.jotakpCategories.filter((c) => c.idsubrubro1 > 0);
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
        const batchResults = await Promise.all(batch.map(async (cat) => {
            try {
                const preview = await getCategoryPreview(client, cat.idsubrubro1, config.baseUrl);
                if (!preview)
                    return { categoryId: cat.id, status: 'error' };
                const db = await getDb();
                const existing = await db.collection('scraper_state').findOne({ categoryId: cat.id });
                const hasChanged = !existing || existing.contentHash !== preview.contentHash;
                // Only update hash/count/price — productIds are maintained by full scrape
                await db.collection('scraper_state').updateOne({ categoryId: cat.id }, {
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
                }, { upsert: true });
                const state = await db.collection('scraper_state').findOne({ categoryId: cat.id });
                const storedCount = state?.productIds?.length || 0;
                console.log(`[Pre-check] ${cat.id}: ${hasChanged ? 'CHANGED' : 'unchanged'} ` +
                    `| page1=${preview.productCount} products | stored=${storedCount} total IDs`);
                return { categoryId: cat.id, status: hasChanged ? 'changed' : 'unchanged' };
            }
            catch (e) {
                console.error(`[Pre-check] ${cat.id}: ERROR — ${e.message}`);
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
async function runIncrementalScraper(forceFullScrape = false, categoryId, skipExistingCheck = false) {
    console.log('[Incremental] Starting incremental scraper (two-phase)...');
    const startTime = Date.now();
    const config = (0, config_1.getScraperConfig)();
    // Filter categories
    let categories = config_1.jotakpCategories.filter((c) => c.idsubrubro1 > 0);
    if (categoryId) {
        const asParent = categories.filter((c) => c.parentId === categoryId);
        if (asParent.length > 0) {
            categories = asParent;
            console.log(`[Incremental] Filtering to parent "${categoryId}" — ${categories.length} subcategories`);
        }
        else {
            categories = categories.filter((c) => c.id === categoryId);
            console.log(`[Incremental] Filtering to subcategory "${categoryId}" — ${categories.length} categories`);
        }
    }
    // Create ONE shared HTTP client + login ONCE
    const sharedHttp = (0, http_client_1.createHttpClient)(config);
    const bootScraper = new scraper_service_1.ScraperService(config, {}, sharedHttp);
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
    let preCheckResult;
    if (forceFullScrape) {
        console.log('[Incremental] Force full scrape — skipping pre-check');
        preCheckResult = { changed: categories.map((c) => c.id), unchanged: [], errors: [] };
    }
    else {
        preCheckResult = await preCheckCategories(categories.map((c) => c.id));
    }
    const toScrape = [...preCheckResult.changed, ...preCheckResult.errors];
    // Collect existing product IDs per category
    const db = await getDb();
    const existingProductIdsByCategory = new Map();
    if (!skipExistingCheck) {
        for (const catId of preCheckResult.changed) {
            const state = await db.collection('scraper_state').findOne({ categoryId: catId });
            if (state?.productIds?.length > 0) {
                existingProductIdsByCategory.set(catId, state.productIds);
                console.log(`[Incremental] ${catId}: ${state.productIds.length} known products`);
            }
        }
    }
    else {
        console.log('[Incremental] skipExistingCheck=true — will re-enrich ALL products');
    }
    console.log(`[Incremental] Pre-check: ${preCheckResult.changed.length} changed, ` +
        `${preCheckResult.unchanged.length} unchanged, ${preCheckResult.errors.length} errors`);
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
            await db.collection('scraper_state').updateOne({ categoryId: catId }, { $set: { lastScrapeAt: new Date() } });
        }
        catch (e) {
            console.error(`[Discontinued] ${catId}: ERROR — ${e.message}`);
        }
    }
    // ============================================================================
    // PHASE 1: HTTP-only discovery — listing pages → new product IDs
    // ============================================================================
    console.log(`\n[Phase 1] HTTP-only discovery for ${toScrape.length} categories...`);
    const newProducts = [];
    const categoryExternalIds = {};
    const scrapeErrors = [];
    for (const catId of toScrape) {
        const cat = config_1.jotakpCategories.find((c) => c.id === catId);
        if (!cat)
            continue;
        try {
            const scraper = new scraper_service_1.ScraperService(config, { categoryId: catId, skipLogin: true }, sharedHttp);
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
            console.log(`[Phase 1] ${catId}: ${products.length} products found, ` +
                `${newOnes.length} new, ${existingIds.size} existing`);
        }
        catch (e) {
            console.error(`[Phase 1] ${catId}: ERROR — ${e.message}`);
            scrapeErrors.push(`Error scanning ${catId}: ${e.message}`);
        }
    }
    console.log(`[Phase 1] Complete: ${newProducts.length} new products across ${toScrape.length} categories` +
        (newProducts.length > 0 ? ' → Playwright needed' : ' → DONE (no browser)'));
    // ============================================================================
    // PHASE 2: Playwright enrichment — only if new products exist
    // ============================================================================
    const scrapeResults = {
        created: 0, updated: 0,
        createdIds: [], updatedIds: [],
        errors: scrapeErrors, durationMs: 0, discontinued: totalDiscontinued,
    };
    if (newProducts.length > 0) {
        console.log(`\n[Phase 2] Playwright enrichment for ${newProducts.length} new products...`);
        // Group new products by category for listing price extraction
        const productsByCategory = new Map();
        for (const p of newProducts) {
            const existing = productsByCategory.get(p.categoryId) || [];
            existing.push(p);
            productsByCategory.set(p.categoryId, existing);
        }
        let enricher = null;
        try {
            enricher = new playwright_enricher_1.PlaywrightEnricher();
            await enricher.launch();
            await enricher.initSession(config.baseUrl, {
                email: config.email,
                password: config.password,
            });
            console.log('[Phase 2] Playwright launched and session initialized');
            const ENRICHMENT_CONCURRENCY = 2;
            for (const [catId, catProducts] of productsByCategory) {
                const cat = config_1.jotakpCategories.find((c) => c.id === catId);
                if (!cat)
                    continue;
                // Step 1: Extract listing prices via Playwright (with conIva=1)
                // Prices are JS-rendered — only available through Playwright
                const listingPrices = new Map();
                try {
                    const maxPages = 20;
                    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
                        const pagePrices = await enricher.extractListingPrices(cat.idsubrubro1, pageNum);
                        if (pagePrices.size === 0)
                            break;
                        for (const [id, price] of pagePrices) {
                            listingPrices.set(id, price);
                        }
                    }
                    console.log(`[Phase 2] ${catId}: ${listingPrices.size} listing prices extracted`);
                }
                catch (e) {
                    console.error(`[Phase 2] ${catId}: failed to extract listing prices — ${e.message}`);
                }
                // Step 2: Enrich new products — detail page for desc/SKU/stock/images,
                // listing price for costPrice (reliable source from rendered listing)
                for (let i = 0; i < catProducts.length; i += ENRICHMENT_CONCURRENCY) {
                    const batch = catProducts.slice(i, i + ENRICHMENT_CONCURRENCY);
                    const results = await Promise.allSettled(batch.map(async (product) => {
                        const enriched = await enricher.enrichProduct(product.externalId, config.baseUrl);
                        // Build upsert payload
                        const upsertPayload = {
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
                            }
                            else {
                                cleaned = cleaned.replace(/,/g, '');
                            }
                            const price = parseFloat(cleaned);
                            if (!isNaN(price) && price > 0) {
                                upsertPayload.costPrice = price;
                                upsertPayload.currency = 'USD';
                            }
                        }
                        // Other fields from detail page
                        if (enriched.description)
                            upsertPayload.description = enriched.description;
                        if (enriched.sku)
                            upsertPayload.sku = enriched.sku;
                        if (enriched.stock !== undefined)
                            upsertPayload.stock = enriched.stock;
                        // Images: prefer detail page images, fall back to listing images
                        const images = enriched.imageUrls?.length > 0 ? enriched.imageUrls : product.imageUrls;
                        if (images?.length > 0)
                            upsertPayload.imageUrls = images;
                        // Upsert
                        const result = await scraper_service_1.productRepository.atomicUpsertByExternalId(upsertPayload);
                        if (result.created) {
                            return { ...result, externalId: product.externalId, action: 'created' };
                        }
                        else if (result.updated) {
                            return { ...result, externalId: product.externalId, action: 'updated' };
                        }
                        return { ...result, externalId: product.externalId, action: 'unchanged' };
                    }));
                    for (const r of results) {
                        if (r.status === 'fulfilled') {
                            if (r.value.action === 'created') {
                                scrapeResults.created++;
                                scrapeResults.createdIds.push(r.value.externalId);
                            }
                            else if (r.value.action === 'updated') {
                                scrapeResults.updated++;
                                scrapeResults.updatedIds.push(r.value.externalId);
                            }
                        }
                        else {
                            const msg = r.reason?.message || String(r);
                            console.error(`[Phase 2] Enrichment failed: ${msg}`);
                            scrapeResults.errors.push(msg);
                        }
                    }
                    console.log(`[Phase 2] ${catId} batch ${Math.floor(i / ENRICHMENT_CONCURRENCY) + 1}: ` +
                        `${results.filter((r) => r.status === 'fulfilled').length}/${batch.length} enriched`);
                }
            }
        }
        catch (e) {
            console.error(`[Phase 2] Playwright error: ${e.message}`);
            scrapeResults.errors.push(`Playwright error: ${e.message}`);
        }
        finally {
            await enricher?.close();
            console.log('[Phase 2] Playwright closed');
        }
    }
    // ============================================================================
    // STEP 3: Update scraper_state for CHANGED categories
    // ============================================================================
    for (const catId of toScrape) {
        const externalIds = categoryExternalIds[catId];
        if (!externalIds)
            continue;
        try {
            await db.collection('scraper_state').updateOne({ categoryId: catId }, { $set: { productIds: externalIds, lastScrapeAt: new Date() } }, { upsert: true });
        }
        catch (e) {
            console.error(`[Incremental] ${catId}: failed to update scraper_state — ${e.message}`);
        }
    }
    // ============================================================================
    // Done
    // ============================================================================
    scrapeResults.durationMs = Date.now() - startTime;
    clearTimeout(globalTimeout);
    console.log(`\n[Incremental] Done in ${(scrapeResults.durationMs / 1000).toFixed(1)}s: ` +
        `${scrapeResults.created} created, ${scrapeResults.updated} updated, ` +
        `${scrapeResults.discontinued} discontinued | ` +
        `new products enriched: ${newProducts.length > 0 ? 'yes' : 'none (fast path)'}`);
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
async function markDiscontinuedFromIds(categoryId, activeExternalIds) {
    const db = await getDb();
    const collection = db.collection('products');
    const result = await collection.updateMany({
        categories: categoryId,
        supplier: 'jotakp',
        externalId: { $nin: activeExternalIds },
        status: { $ne: 'discontinued' },
    }, { $set: { status: 'discontinued', discontinuedAt: new Date(), updatedAt: new Date() } });
    return result.modifiedCount;
}
