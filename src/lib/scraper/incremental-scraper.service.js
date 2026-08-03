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
 *
 * Resource cleanup:
 *   All resources (Playwright browser, MongoDB connections) are cleaned up
 *   in a finally block to prevent leaks on errors or timeouts.
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
const playwright_singleton_1 = require("./playwright-singleton");
const image_downloader_1 = require("./image-downloader");
const data_transformer_1 = require("./data-transformer");
// ============================================================================
// DATABASE — reuse server.ts singleton via (global as any).db
// ============================================================================
/**
 * Get the shared MongoDB database instance from server.ts.
 * NEVER creates its own MongoClient — avoids connection duplication.
 * server.ts must be running (it sets (global as any).db on boot).
 */
async function getDb() {
    if (global.db) {
        return global.db;
    }
    // Fallback: if called outside server.ts context (e.g. standalone script),
    // create a one-shot connection. This path should NOT be hit in production.
    console.warn('[Incremental] global.db not found — creating temporary connection');
    const { MongoClient } = await Promise.resolve().then(() => __importStar(require('mongodb')));
    const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
    const DB_NAME = process.env.DB_NAME || process.env.MONGODB_DB_NAME || 'ecommerce';
    if (!MONGO_URI)
        throw new Error('MONGO_URI is required');
    const client = new MongoClient(MONGO_URI, {
        maxPoolSize: 5,
        minPoolSize: 0,
        maxIdleTimeMS: 10000,
    });
    await client.connect();
    const db = client.db(DB_NAME);
    // Store globally so subsequent calls reuse it
    global.db = db;
    return db;
}
// ============================================================================
// PRE-CHECK CATEGORIES
// ============================================================================
/**
 * Fetch all product IDs from a category (all pages) for pre-check.
 * This detects products that are NEW (not in previous scrape) or DISABLED (no longer present).
 */
async function getCategoryPreview(client, idsubrubro1, baseUrl) {
    try {
        const productIds = [];
        const seenIds = new Set();
        const maxPages = 20;
        const pageDelayMs = 100; // Lightweight delay between pages
        let firstPriceUsd = null;
        // Iterate through all pages to collect ALL product IDs
        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
            const url = `${baseUrl}/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=${pageNum}&conIva=1`;
            const html = await (0, http_client_1.safeGet)(client, url, 3, pageDelayMs);
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
            $('a[href*="articulo.aspx?id="]').each((_, el) => {
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
        const contentHash = crypto_1.default.createHash('md5').update(sortedIds.join(',')).digest('hex');
        console.log(`[Pre-check] Category ${idsubrubro1}: ${productIds.length} total products`);
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
    try {
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
                    // Compare product IDs to detect new/disabled products
                    // Use sorted arrays for stable comparison
                    const existingIds = existing?.productIds ? [...existing.productIds].sort() : [];
                    const newIds = [...preview.productIds].sort();
                    const hasChanged = !existing || JSON.stringify(existingIds) !== JSON.stringify(newIds);
                    // Determine what changed (new vs discontinued)
                    const existingSet = new Set(existing?.productIds || []);
                    const newSet = new Set(preview.productIds);
                    const newProducts = [];
                    const discontinuedProducts = [];
                    for (const id of preview.productIds) {
                        if (!existingSet.has(id))
                            newProducts.push(id);
                    }
                    for (const id of existing?.productIds || []) {
                        if (!newSet.has(id))
                            discontinuedProducts.push(id);
                    }
                    // Log changes detected
                    if (hasChanged) {
                        console.log(`[Pre-check] ${cat.id}: CHANGED | ` +
                            `new=${newProducts.length}, discontinued=${discontinuedProducts.length}, ` +
                            `total=${preview.productCount} products`);
                        if (newProducts.length > 0) {
                            console.log(`[Pre-check]   NEW products: ${newProducts.slice(0, 5).join(', ')}${newProducts.length > 5 ? '...' : ''}`);
                        }
                        if (discontinuedProducts.length > 0) {
                            console.log(`[Pre-check]   DISCONTINUED: ${discontinuedProducts.slice(0, 5).join(', ')}${discontinuedProducts.length > 5 ? '...' : ''}`);
                        }
                    }
                    // NOTE: Do NOT update scraper_state here.
                    // It will be updated AFTER runScraper() saves products to the DB,
                    // so scraper_state always reflects what's actually in the DB,
                    // not what the website has.
                    const state = await db.collection('scraper_state').findOne({ categoryId: cat.id });
                    const storedCount = state?.productIds?.length || 0;
                    if (!hasChanged) {
                        console.log(`[Pre-check] ${cat.id}: unchanged | ` +
                            `total=${preview.productCount} products`);
                    }
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
    }
    finally {
        // HTTP client doesn't have explicit close, but we clear references
        console.log('[Pre-check] Pre-check complete');
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
 *   2. Scrape only changed categories (pre-check product IDs used for discontinued).
 *   3. Return aggregated results.
 *
 * Session optimization: creates ONE authenticated HTTP session shared across all
 * categories, instead of logging in 127 times.
 *
 * Resource cleanup: ALL resources (Playwright browser, MongoDB connections) are
 * guaranteed to be cleaned up in the finally block, even on errors or timeouts.
 *
 * @param forceFullScrape - If true, skip pre-check and scrape all categories.
 * @param categoryId - Optional parent category ID to scrape (e.g., 'conectividad').
 *                     If provided, only subcategories of this parent are processed.
 */
async function runIncrementalScraper(forceFullScrape = false, categoryId, skipExistingCheck = false) {
    console.log('[Incremental] Starting incremental scraper...');
    const config = (0, config_1.getScraperConfig)();
    // Filter categories: if categoryId is provided, only use matching subcategories
    // Supports both parent IDs (e.g., 'conectividad' → all its subcategories)
    // and direct subcategory IDs (e.g., 'routers' → just that one)
    let categories = config_1.jotakpCategories.filter((c) => c.idsubrubro1 > 0);
    if (categoryId) {
        const asParent = categories.filter((c) => c.parentId === categoryId);
        if (asParent.length > 0) {
            categories = asParent;
            console.log(`[Incremental] Filtering to parent "${categoryId}" — ${categories.length} subcategories`);
        }
        else {
            // categoryId is itself a subcategory
            categories = categories.filter((c) => c.id === categoryId);
            console.log(`[Incremental] Filtering to subcategory "${categoryId}" — ${categories.length} categories`);
        }
    }
    // Create ONE shared HTTP client for the entire run
    const sharedHttp = (0, http_client_1.createHttpClient)(config);
    // Track resources for cleanup
    const categoryTimeouts = [];
    try {
        // Login ONCE — this populates the cookie jar on sharedHttp
        const { ScraperService } = await Promise.resolve().then(() => __importStar(require('./scraper.service')));
        const bootScraper = new ScraperService(config, {}, sharedHttp);
        await bootScraper.login();
        console.log('[Incremental] Shared session established for all categories');
        // No global timeout — let it run as long as needed.
        // scraper_state is updated after each category, so a crash mid-way
        // resumes naturally on the next run (pre-check re-detects unprocessed categories).
        // CRITICAL: Capture existing product IDs BEFORE pre-check runs.
        // Pre-check updates scraper_state with current IDs from the website.
        // If we read AFTER pre-check, new products would already be in the state
        // and the scraper would skip them (thinking they're "existing").
        const db = await getDb();
        // CRITICAL: Get existing product IDs from the ACTUAL DB, not from scraper_state.
        // scraper_state tracks what was on the website last time, not what's in our DB.
        // Using scraper_state would skip products that appear on the website but were never saved.
        const existingProductIdsByCategory = new Map();
        if (!skipExistingCheck) {
            for (const cat of categories) {
                const existingProducts = await db.collection('products')
                    // Exclude discontinued: they must be re-scraped so a product that
                    // returns to the site gets reactivated by the upsert (status → active).
                    .find({ categories: cat.id, supplier: 'jotakp', status: { $ne: 'discontinued' } }, { projection: { externalId: 1 } })
                    .toArray();
                const ids = existingProducts.map((p) => p.externalId).filter(Boolean);
                if (ids.length > 0) {
                    existingProductIdsByCategory.set(cat.id, ids);
                }
            }
            console.log(`[Incremental] Found existing products in DB for ${existingProductIdsByCategory.size} categories`);
        }
        // Step 1: Pre-check (this updates scraper_state with current IDs)
        let preCheckResult;
        if (forceFullScrape) {
            console.log('[Incremental] Force full scrape — skipping pre-check');
            preCheckResult = { changed: categories.map((c) => c.id), unchanged: [], errors: [] };
        }
        else {
            // Pass category IDs to preCheckCategories for filtering
            preCheckResult = await preCheckCategories(categories.map((c) => c.id));
        }
        const toScrape = [...preCheckResult.changed, ...preCheckResult.errors];
        // existingProductIdsByCategory already populated from DB above.
        // For CHANGED categories, log how many products exist in DB (Playwright will skip these).
        if (!skipExistingCheck) {
            for (const catId of preCheckResult.changed) {
                const existingIds = existingProductIdsByCategory.get(catId);
                if (existingIds && existingIds.length > 0) {
                    console.log(`[Incremental] ${catId}: ${existingIds.length} products already in DB — Playwright will skip these`);
                }
                else {
                    console.log(`[Incremental] ${catId}: 0 products in DB — ALL products are new`);
                }
            }
        }
        else {
            console.log('[Incremental] skipExistingCheck=true — Playwright will re-enrich ALL products');
        }
        console.log(`[Incremental] Pre-check: ${preCheckResult.changed.length} changed, ${preCheckResult.unchanged.length} unchanged, ${preCheckResult.errors.length} errors — scraping ${toScrape.length} categories`);
        const scrapeResults = { created: 0, updated: 0, createdIds: [], updatedIds: [], errors: [], durationMs: 0, discontinued: 0 };
        const startTime = Date.now();
        const RESTART_PLAYWRIGHT_EVERY = 20; // Restart browser every N categories to prevent memory buildup
        // Step 2a: Mark discontinued + update timestamp for UNCHANGED categories
        // Uses the product IDs captured during the last successful full scrape (already in scraper_state).
        let totalDiscontinued = 0;
        for (const catId of preCheckResult.unchanged) {
            try {
                // Use DB as source of truth, not scraper_state
                const dbProducts = await db.collection('products')
                    .find({ categories: catId, supplier: 'jotakp', status: { $ne: 'discontinued' } }, { projection: { externalId: 1 } })
                    .toArray();
                const activeIds = dbProducts.map((p) => p.externalId).filter(Boolean);
                if (activeIds.length > 0) {
                    const discontinuedCount = await markDiscontinuedFromIds(catId, activeIds);
                    totalDiscontinued += discontinuedCount;
                    if (discontinuedCount > 0) {
                        console.log(`[Discontinued] ${catId}: marked ${discontinuedCount} products as discontinued (from ${activeIds.length} active IDs)`);
                    }
                    else {
                        console.log(`[Discontinued] ${catId}: no changes (all ${activeIds.length} products still active)`);
                    }
                }
                // Update scraper_state with actual DB state
                await db.collection('scraper_state').updateOne({ categoryId: catId }, {
                    $set: {
                        categoryId: catId,
                        productIds: activeIds,
                        productCount: activeIds.length,
                        lastScrapeAt: new Date(),
                    },
                }, { upsert: true });
            }
            catch (e) {
                console.error(`[Discontinued] ${catId}: ERROR — ${e.message}`);
            }
        }
        scrapeResults.discontinued = totalDiscontinued;
        // Step 2b: Scrape changed + error categories SEQUENTIALLY (less memory pressure)
        const CATEGORY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per category
        const allProducts = []; // dry-run accumulator
        const allCategoryIds = new Set(); // track which categories were processed
        for (let i = 0; i < toScrape.length; i++) {
            const catId = toScrape[i];
            console.log(`[Incremental] Scraping ${i + 1}/${toScrape.length}: ${catId}`);
            try {
                const existingProductIds = existingProductIdsByCategory.get(catId) || [];
                const scraperPromise = (0, scraper_service_1.runScraper)({ categoryId: catId, source: 'incremental', skipLogin: true, existingProductIds, dryRun: true, keepBrowserOpen: true }, sharedHttp);
                let timeoutId;
                const timeoutPromise = new Promise((_, reject) => {
                    timeoutId = setTimeout(() => reject(new Error(`Category ${catId} timed out after 5 minutes`)), CATEGORY_TIMEOUT_MS);
                    categoryTimeouts.push(timeoutId);
                });
                const result = await Promise.race([scraperPromise, timeoutPromise]);
                clearTimeout(timeoutId);
                scrapeResults.created += result.created || 0;
                scrapeResults.updated += result.updated || 0;
                if (result.createdIds)
                    scrapeResults.createdIds.push(...result.createdIds);
                if (result.updatedIds)
                    scrapeResults.updatedIds.push(...result.updatedIds);
                if (result.errors)
                    scrapeResults.errors.push(...result.errors);
                // Accumulate products from dry-run mode
                if (result.products && result.products.length > 0) {
                    allProducts.push(...result.products);
                    allCategoryIds.add(catId);
                }
                console.log(`[Incremental] ${catId}: ${result.products?.length || 0} products accumulated`);
            }
            catch (e) {
                console.error(`[Incremental] Error scraping ${catId}:`, e.message);
                scrapeResults.errors.push(`Error scraping ${catId}: ${e.message}`);
            }
            // Restart Playwright every N categories to prevent memory buildup
            if ((i + 1) % RESTART_PLAYWRIGHT_EVERY === 0 && i + 1 < toScrape.length) {
                try {
                    console.log(`[Incremental] Restarting Playwright after ${i + 1} categories...`);
                    await playwright_singleton_1.playwrightSingleton.close();
                }
                catch (e) {
                    console.error(`[Incremental] Error restarting Playwright: ${e.message}`);
                }
            }
        }
        // ============================================================================
        // BATCH SAVE: validate all products, then save + update scraper_state atomically
        // ============================================================================
        console.log(`\n[Incremental] Batch save: ${allProducts.length} total products accumulated from ${allCategoryIds.size} categories`);
        const saveErrors = [];
        const savedIds = [];
        let savedCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        if (allProducts.length === 0) {
            const msg = allCategoryIds.size > 0
                ? 'Categories were processed but no products had valid price data'
                : 'No categories had changes to save';
            saveErrors.push(msg);
            console.warn(`[Incremental] ${msg}`);
        }
        for (const product of allProducts) {
            // Validate required fields
            if (!product.externalId) {
                saveErrors.push('Product missing externalId — skipping');
                skippedCount++;
                continue;
            }
            if (!product.priceRaw) {
                saveErrors.push(`[VALIDATION] ${product.externalId}: no priceRaw — skipping`);
                skippedCount++;
                continue;
            }
            try {
                const costPrice = (0, data_transformer_1.parsePrice)(product.priceRaw);
                if (costPrice <= 0) {
                    saveErrors.push(`[VALIDATION] ${product.externalId}: invalid price (${product.priceRaw}) — skipping`);
                    skippedCount++;
                    continue;
                }
                const upsertPayload = {
                    externalId: product.externalId,
                    name: product.name,
                    categories: product.categories,
                    costPrice,
                    currency: 'USD',
                };
                if (product.stock > 0)
                    upsertPayload.stock = product.stock;
                if (product.sku)
                    upsertPayload.sku = product.sku;
                if (product.description)
                    upsertPayload.description = product.description;
                if (product.imageUrls?.length > 0)
                    upsertPayload.imageUrls = product.imageUrls;
                const result = await scraper_service_1.productRepository.atomicUpsertByExternalId(upsertPayload);
                if (result.created || result.updated) {
                    savedCount++;
                    if (result.created)
                        scrapeResults.createdIds.push(product.externalId);
                    if (result.updated) {
                        updatedCount++;
                        scrapeResults.updatedIds.push(product.externalId);
                    }
                    savedIds.push(product.externalId);
                }
            }
            catch (e) {
                saveErrors.push(`Error saving product ${product.externalId}: ${e.message}`);
            }
        }
        // Upload images to Cloudinary for newly created products
        for (const product of allProducts) {
            if (!product.imageUrls?.length)
                continue;
            if (!scrapeResults.createdIds.includes(product.externalId))
                continue;
            try {
                const cloudUrls = await (0, image_downloader_1.uploadProductImages)(product.imageUrls, 'jotakp', product.externalId);
                product.cloudinaryUrls = cloudUrls;
                await db.collection('products').updateOne({ externalId: product.externalId, supplier: 'jotakp' }, { $set: { imageUrls: cloudUrls, updatedAt: new Date() } });
            }
            catch {
                // Image upload is optional
            }
        }
        // Mark discontinued for changed categories (dryRun skips this in runScraper)
        const allExternalIdsByCategory = new Map();
        for (const product of allProducts) {
            for (const catId of product.categories) {
                if (!allExternalIdsByCategory.has(catId))
                    allExternalIdsByCategory.set(catId, []);
                allExternalIdsByCategory.get(catId).push(product.externalId);
            }
        }
        for (const [catId, scrapedIds] of allExternalIdsByCategory) {
            try {
                // Combine scraped IDs with existing DB IDs for this category
                const existingIds = existingProductIdsByCategory.get(catId) || [];
                const allActiveIds = [...new Set([...existingIds, ...scrapedIds])];
                const discontinued = await scraper_service_1.productRepository.markDiscontinued(catId, allActiveIds);
                if (discontinued > 0) {
                    console.log(`[Discontinued] ${catId}: ${discontinued} products marked`);
                    totalDiscontinued += discontinued;
                }
            }
            catch (e) {
                console.error(`[Discontinued] ${catId}: ERROR — ${e.message}`);
            }
        }
        scrapeResults.discontinued = totalDiscontinued;
        // Update scraper_state for ALL accumulated categories
        for (const catId of allCategoryIds) {
            try {
                const dbProducts = await db.collection('products')
                    // Track only ACTIVE products: scraper_state is the pre-check baseline,
                    // so discontinued products must not mask a product that returned to the site.
                    .find({ categories: catId, supplier: 'jotakp', status: { $ne: 'discontinued' } }, { projection: { externalId: 1 } })
                    .toArray();
                const dbIds = dbProducts.map((p) => p.externalId).filter(Boolean);
                await db.collection('scraper_state').updateOne({ categoryId: catId }, {
                    $set: {
                        categoryId: catId,
                        productIds: dbIds,
                        productCount: dbIds.length,
                        lastScrapeAt: new Date(),
                    },
                }, { upsert: true });
                console.log(`[ScraperState] ${catId}: updated with ${dbIds.length} products from DB`);
            }
            catch (e) {
                console.error(`[ScraperState] ${catId}: failed to update — ${e.message}`);
            }
        }
        // Also update scraper_state for unchanged categories (mark discontinued)
        // This already happens in Step 2a above, so no need to repeat.
        // Log validation errors
        if (saveErrors.length > 0) {
            console.warn(`[Incremental] ${saveErrors.length} validation/save issues:`);
            for (const err of saveErrors) {
                console.warn(`  ${err}`);
                scrapeResults.errors.push(err);
            }
        }
        scrapeResults.created = savedCount;
        console.log(`[Incremental] Batch save complete: ${savedCount} saved, ${skippedCount} skipped ` +
            `(${saveErrors.length - skippedCount} errors)`);
        scrapeResults.durationMs = Date.now() - startTime;
        console.log(`[Incremental] Done in ${(scrapeResults.durationMs / 1000).toFixed(1)}s: ` +
            `${scrapeResults.created} created, ${scrapeResults.updated} updated, ` +
            `${scrapeResults.discontinued} discontinued | ` +
            `scraped ${Math.min(toScrape.length, scrapeResults.created + scrapeResults.updated + scrapeResults.errors.length)}/${categories.length} categories`);
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
    catch (error) {
        console.error('[Incremental] Fatal error:', error.message);
        throw error; // Re-throw so caller knows it failed
    }
    finally {
        // ============================================================================
        // CLEANUP — guaranteed to run, even on errors or timeouts
        // ============================================================================
        console.log('[Incremental] Cleaning up resources...');
        // 1. Clear category timeouts
        for (const t of categoryTimeouts) {
            clearTimeout(t);
        }
        categoryTimeouts.length = 0;
        // 2. Close Playwright browser (if it was launched by this run)
        try {
            await playwright_singleton_1.playwrightSingleton.close();
            console.log('[Incremental] Playwright browser closed');
        }
        catch (e) {
            console.error('[Incremental] Error closing Playwright:', e.message);
        }
        // MongoDB is NOT closed here — server.ts manages the connection lifecycle.
        // Reusing (global as any).db means zero duplication.
        console.log('[Incremental] Cleanup complete');
    }
}
/**
 * Mark products as discontinued if they're NOT in the given active IDs list.
 * Uses the same logic as productRepository.markDiscontinued but directly.
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
