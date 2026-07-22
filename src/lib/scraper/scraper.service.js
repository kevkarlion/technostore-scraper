"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScraperService = exports.productRepository = void 0;
exports.runScraper = runScraper;
const cheerio = __importStar(require("cheerio"));
const config_1 = require("./config");
const image_downloader_1 = require("./image-downloader");
const types_1 = require("./types");
const http_client_1 = require("./http-client");
const playwright_enricher_1 = require("./playwright-enricher");
// ============================================================================
// SLUG GENERATION UTILITIES
// ============================================================================
/**
 * Generate a URL-friendly slug from product name.
 * Matches the implementation in TechnoStore's product-to-presentation.ts
 */
function generateProductSlug(name) {
    if (!name)
        return '';
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with dash
        .replace(/^-+|-+$/g, '') // Remove leading/trailing dashes
        .replace(/-+/g, '-'); // Replace multiple dashes with single
}
/**
 * Normalize text for search (lowercase, no accents, no special chars).
 * Used for searchName field to enable fast text search.
 */
function normalizeText(text) {
    if (!text)
        return '';
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
let dbInstance = null;
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
        const client = new MongoClient(MONGO_URI);
        await client.connect();
        dbInstance = client.db(DB_NAME);
    }
    return dbInstance;
}
// ============================================================================
// PRODUCT REPOSITORY — same as before
// ============================================================================
exports.productRepository = {
    async upsert(product) {
        const db = await getDb();
        const collection = db.collection('products');
        const existing = await collection.findOne({ externalId: product.externalId, supplier: 'jotakp' });
        if (existing) {
            const changed = {};
            for (const [key, value] of Object.entries(product)) {
                if (JSON.stringify(existing[key]) !== JSON.stringify(value)) {
                    changed[key] = value;
                }
            }
            if (Object.keys(changed).length > 0) {
                await collection.updateOne({ _id: existing._id }, { $set: { ...changed, lastSyncedAt: new Date() } });
                return { created: false, updated: true };
            }
            return { created: false, updated: false };
        }
        else {
            const slug = generateProductSlug(product.name);
            const searchName = normalizeText(product.name);
            await collection.insertOne({
                ...product,
                price: product.costPrice || 0,
                profitMargin: 0,
                slug,
                searchName,
                supplier: 'jotakp',
                status: 'active',
                inStock: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            return { created: true, updated: false };
        }
    },
    async atomicUpsertByExternalId(product) {
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
                price: product.costPrice || 0,
                profitMargin: 0,
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
        const changes = [];
        const updateOps = { lastSyncedAt: now, updatedAt: now };
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
            'costPrice',
            'currency',
            'stock',
            'sku',
            'categories',
            'imageUrls',
        ];
        // Helper: check if a value is "empty" (scraper default, not real data)
        // null and undefined are equivalent "no data" states
        const isEmpty = (val) => val === undefined || val === null || val === '' || val === 0 ||
            (Array.isArray(val) && val.length === 0);
        for (const field of fieldsToCompare) {
            const existingVal = existing[field];
            const newVal = product[field];
            // Don't overwrite valid existing data with empty/zero defaults
            if (JSON.stringify(existingVal) !== JSON.stringify(newVal)) {
                // Skip if: new value is empty (and existing is also empty or has data)
                // This prevents overwriting null/undefined with null/undefined (no-op)
                // And prevents overwriting valid data with empty defaults
                // Exception: costPrice=0 is a valid supplier value, not an empty default
                if (isEmpty(newVal) && field !== 'costPrice') {
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
    async markDiscontinued(categoryId, activeExternalIds, supplier = 'jotakp') {
        const db = await getDb();
        const collection = db.collection('products');
        const result = await collection.updateMany({
            categories: categoryId,
            supplier,
            externalId: { $nin: activeExternalIds },
            status: { $ne: 'discontinued' },
        }, { $set: { status: 'discontinued', discontinuedAt: new Date(), updatedAt: new Date() } });
        return result.modifiedCount;
    },
};
// ============================================================================
// SCRAPER SERVICE
// ============================================================================
class ScraperService {
    constructor(config, request, http) {
        this.loggedIn = false;
        this.config = config || (0, config_1.getScraperConfig)();
        this.request = request || {};
        // Allow injecting a pre-authenticated HTTP client (shared session)
        this.http = http || (0, http_client_1.createHttpClient)(this.config);
        this.categories = [];
        // Build category list from request or all
        if (request?.categoryId) {
            const cat = config_1.jotakpCategories.find((c) => c.id === request.categoryId);
            if (cat)
                this.categories = [cat];
        }
        else {
            this.categories = config_1.jotakpCategories.filter((c) => c.idsubrubro1 > 0);
        }
    }
    // ============================================================================
    // LOGIN
    // ============================================================================
    /**
     * Log in to the supplier website via POST form.
     * The cookie jar automatically preserves the ASP.NET session cookie.
     */
    async login() {
        if (this.loggedIn)
            return;
        console.log('[Scraper] Logging in...');
        // Attempt login with the configured credentials
        const loginBody = {};
        loginBody[this.extractInputName('txtUsuario')] = this.config.email;
        loginBody[this.extractInputName('txtClave')] = this.config.password;
        // We need the ASP.NET form fields — first GET the login page to extract __VIEWSTATE etc.
        try {
            const loginPageHtml = await (0, http_client_1.safeGet)(this.http, this.config.loginUrl);
            const $login = cheerio.load(loginPageHtml);
            // Grab ASP.NET hidden fields
            $login('input[type="hidden"]').each((_, el) => {
                const name = $login(el).attr('name');
                const value = $login(el).attr('value') || '';
                if (name)
                    loginBody[name] = value;
            });
            // Find the actual input names (ASP.NET may mangle them: ctl00$ContentPlaceHolder1$txtUsuario)
            const emailInputName = this.findInputName($login, 'txtUsuario');
            const passInputName = this.findInputName($login, 'txtClave');
            if (emailInputName)
                loginBody[emailInputName] = this.config.email;
            if (passInputName)
                loginBody[passInputName] = this.config.password;
            // Find the submit button name
            const btnName = this.findInputName($login, 'btnIngresar') || 'btnIngresar';
            loginBody[btnName] = 'Ingresar';
            // POST login
            const postLoginHtml = await (0, http_client_1.safePost)(this.http, this.config.loginUrl, loginBody);
            // Verify login succeeded — check we're not still on the login page
            const $verify = cheerio.load(postLoginHtml);
            if ($verify('input[name*="txtUsuario"]').length > 0) {
                // Still on login page — try simpler approach without hidden fields
                console.log('[Scraper] Simple login attempt...');
                const simpleBody = {};
                simpleBody[emailInputName || 'txtUsuario'] = this.config.email;
                simpleBody[passInputName || 'txtClave'] = this.config.password;
                simpleBody[btnName] = 'Ingresar';
                await (0, http_client_1.safePost)(this.http, this.config.loginUrl, simpleBody);
            }
            // Legacy branch selection removed — /default.aspx no longer exists
            // on the supplier's server (returns 404), and branch selection
            // was only needed for the old ASP.NET WebForms login flow.
            this.loggedIn = true;
            console.log('[Scraper] Login successful');
        }
        catch (error) {
            throw new types_1.ScraperError(`Login failed: ${error.message}`, 'AUTH_FAILED', error);
        }
    }
    /**
     * Extract the actual ASP.NET input name for a field.
     * ASP.NET often mangles IDs: ctl00$ContentPlaceHolder1$txtUsuario
     */
    findInputName($, fieldId) {
        const el = $(`input[name*="${fieldId}"]`).first();
        return el.attr('name') || null;
    }
    /**
     * Extract input name matching one of several possible IDs
     */
    extractInputName(...ids) {
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
    async scrapeCategoryPage(idsubrubro1, pageNum) {
        const url = `/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=${pageNum}&conIva=1`;
        const html = await (0, http_client_1.safeGet)(this.http, url);
        const $ = cheerio.load(html);
        const products = [];
        const productLinks = $('a[href*="articulo.aspx?id="]');
        productLinks.each((_, el) => {
            const href = $(el).attr('href') || '';
            const fullText = $(el).text().trim();
            const idMatch = href.match(/id=(\d+)/);
            if (!idMatch)
                return;
            const externalId = idMatch[1];
            // Name is everything before the price marker (or full text if no price marker)
            // Handle formats like: "Name U$D 25,61+ IVA 21%$ 37.134,50+ IVA 21%"
            const name = fullText.replace(/U\$D\s*[\d.,]+(\s*\+\s*IVA\s*[\d.]+%)*(\$\s*[\d.,.]+(\s*\+\s*IVA\s*[\d.]+%)*)*$/, '').trim();
            if (!name || name.length < 3)
                return;
            // Extract image from listing page (CSS background-image)
            const imgDiv = $(el).find('div.tg-article-img');
            const bgImage = imgDiv.attr('style') || '';
            const bgMatch = bgImage.match(/url\(([^)]+)\)/);
            const listingImages = [];
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
    async scrapeCategory(idsubrubro1) {
        const allProducts = [];
        const allIds = [];
        const maxPages = 20;
        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
            const { products, hasMore } = await this.scrapeCategoryPage(idsubrubro1, pageNum);
            console.log(`[Scraper] Page ${pageNum}: ${products.length} products extracted${hasMore ? ' (more pages)' : ' (last page)'}`);
            if (products.length === 0)
                break;
            // Collect products — detail enrichment (prices, desc, images) happens via Playwright later
            for (const product of products) {
                allProducts.push(product);
                allIds.push(product.externalId);
            }
            if (!hasMore)
                break;
        }
        return { products: allProducts, externalIds: allIds };
    }
    /**
     * Resolve category ID for a product.
     */
    getCategoryId(externalId) {
        // Map the product to its category based on the current request
        return this.request.categoryId || 'unknown';
    }
    // ============================================================================
    // MAIN RUN LOOP
    // ============================================================================
    /**
     * Run the scraper — login, then scrape all configured categories.
     */
    async run() {
        const startTime = Date.now();
        let created = 0;
        let updated = 0;
        const createdIds = [];
        const updatedIds = [];
        const errors = [];
        const categoryExternalIds = {};
        let playwrightEnricher = null;
        try {
            // Login first (skip if using a pre-authenticated shared session)
            if (!this.request.skipLogin) {
                await this.login();
            }
            // Initialize Playwright for full product enrichment (prices, desc, SKU, images)
            try {
                playwrightEnricher = new playwright_enricher_1.PlaywrightEnricher();
                await playwrightEnricher.launch();
                await playwrightEnricher.initSession(this.config.baseUrl, {
                    email: this.config.email,
                    password: this.config.password,
                });
                console.log('[Scraper] Playwright launched and session initialized');
            }
            catch (e) {
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
                    // Step 1: Extract prices from listing pages via Playwright (reliable)
                    // This is the SAME logic as playwright-listing — prices come from the
                    // rendered listing text ("U$D 76,21"), not from fragile detail page selectors.
                    const listingPrices = new Map();
                    if (playwrightEnricher && productsToEnrich.length > 0) {
                        try {
                            const maxPages = 20;
                            for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
                                const pagePrices = await playwrightEnricher.extractListingPrices(cat.idsubrubro1, pageNum);
                                if (pagePrices.size === 0)
                                    break;
                                for (const [id, price] of pagePrices) {
                                    listingPrices.set(id, price);
                                }
                            }
                            console.log(`[Playwright] ${cat.id}: ${listingPrices.size} listing prices extracted`);
                        }
                        catch (e) {
                            console.error(`[Playwright] ${cat.id}: failed to extract listing prices:`, e.message);
                        }
                    }
                    // Step 2: Enrich new products — detail page for desc/SKU/stock/images,
                    // listing price for costPrice (reliable source)
                    if (playwrightEnricher && productsToEnrich.length > 0) {
                        for (let i = 0; i < productsToEnrich.length; i += ENRICHMENT_CONCURRENCY) {
                            const batch = productsToEnrich.slice(i, i + ENRICHMENT_CONCURRENCY);
                            const results = await Promise.allSettled(batch.map(async (product) => {
                                const enriched = await playwrightEnricher.enrichProduct(product.externalId, this.config.baseUrl);
                                // Price from listing page (reliable) — NOT from detail page
                                const listingPrice = listingPrices.get(product.externalId);
                                if (listingPrice) {
                                    product.priceRaw = listingPrice;
                                }
                                // Other fields from detail page
                                if (enriched.description)
                                    product.description = enriched.description;
                                if (enriched.sku)
                                    product.sku = enriched.sku;
                                if (enriched.stock !== undefined)
                                    product.stock = enriched.stock;
                                if (enriched.imageUrls && enriched.imageUrls.length > 0)
                                    product.imageUrls = enriched.imageUrls;
                            }));
                            enrichedCount += results.filter(r => r.status === 'fulfilled').length;
                            for (const f of results.filter(r => r.status === 'rejected')) {
                                console.error(`[Playwright] enrichment failed: ${f.reason?.message || f}`);
                            }
                        }
                    }
                    if (skippedCount > 0 || enrichedCount > 0) {
                        console.log(`[Playwright] ${cat.id}: ${enrichedCount} enriched (×${ENRICHMENT_CONCURRENCY} parallel), ` +
                            `${skippedCount} existing skipped | ` +
                            `total=${products.length} products found`);
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
                            const upsertPayload = {
                                externalId: product.externalId,
                                name: product.name,
                                categories: [cat.id],
                            };
                            // Only include fields that have real data (not listing defaults)
                            // price from supplier → stored as costPrice. Backend computes sale price.
                            if (product.priceRaw) {
                                upsertPayload.costPrice = this.parsePrice(product.priceRaw);
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
                            console.log(`[Upsert] ${product.externalId}: ` +
                                `costPrice=${upsertPayload.costPrice ?? 'N/A'}, ` +
                                `images=${upsertPayload.imageUrls?.length ?? 0}` +
                                `${upsertPayload.sku ? `, sku=${upsertPayload.sku}` : ''}` +
                                `${upsertPayload.stock ? `, stock=${upsertPayload.stock}` : ''}`);
                            const result = await exports.productRepository.atomicUpsertByExternalId(upsertPayload);
                            if (result.created) {
                                created++;
                                createdIds.push(product.externalId);
                            }
                            if (result.updated) {
                                updated++;
                                updatedIds.push(product.externalId);
                            }
                        }
                        catch (e) {
                            errors.push(`Error saving product ${product.externalId}: ${e.message}`);
                        }
                    }
                    // Upload images to Cloudinary after upsert, so we know if it's a create or update.
                    // - Full scrape (source !== 'incremental'): upload for ALL products with images.
                    // - Incremental: upload ONLY for newly created products (existing products keep
                    //   their Cloudinary URLs from the first full scrape).
                    const isFullScrape = this.request.source !== 'incremental';
                    for (const product of products) {
                        if (product.imageUrls.length === 0)
                            continue;
                        if (!isFullScrape && !createdIds.includes(product.externalId))
                            continue;
                        try {
                            const cloudUrls = await (0, image_downloader_1.uploadProductImages)(product.imageUrls, this.config.supplier, product.externalId);
                            product.cloudinaryUrls = cloudUrls;
                            // Update the DB record with Cloudinary URLs
                            const db = await getDb();
                            await db.collection('products').updateOne({ externalId: product.externalId, supplier: 'jotakp' }, { $set: { imageUrls: cloudUrls, updatedAt: new Date() } });
                        }
                        catch {
                            // Image upload is optional — keep raw supplier URLs in DB
                        }
                    }
                    // Mark discontinued
                    if (externalIds.length > 0) {
                        const discontinued = await exports.productRepository.markDiscontinued(cat.id, externalIds);
                        if (discontinued > 0) {
                            console.log(`[Scraper] Marked ${discontinued} products as discontinued in ${cat.id}`);
                        }
                    }
                    // Update scraper_state.productIds so incremental skips these products next time
                    // This runs for ALL scraper sources (incremental, full, test-category, etc.)
                    try {
                        const db = await getDb();
                        await db.collection('scraper_state').updateOne({ categoryId: cat.id }, { $set: { productIds: externalIds, lastScrapeAt: new Date() } }, { upsert: true });
                    }
                    catch (e) {
                        console.error(`[Scraper] ${cat.id}: failed to update scraper_state:`, e.message);
                    }
                    // Collect all external IDs found for this category (used by incremental scraper to update state)
                    categoryExternalIds[cat.id] = externalIds;
                    console.log(`[Scraper] ${cat.id}: ${products.length} products found | ` +
                        `${created} created, ${updated} updated, ` +
                        `${externalIds.length} total IDs stored for next pre-check`);
                }
                catch (e) {
                    errors.push(`Error scraping category ${cat.id}: ${e.message}`);
                    console.error(`[Scraper] Error processing category ${cat.id}:`, e.message);
                }
            }
        }
        catch (e) {
            errors.push(`Fatal error: ${e.message}`);
            console.error('[Scraper] Fatal error:', e);
        }
        finally {
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
            categoryExternalIds,
        };
    }
    // ============================================================================
    // HELPERS
    // ============================================================================
    /**
     * Parse a price string like "1.234,56" or "1234.56" to a number.
     */
    parsePrice(priceRaw) {
        if (!priceRaw)
            return 0;
        let cleaned = priceRaw.replace(/[$€£¥₹]/g, '').replace(/\s/g, '').trim();
        const lastDot = cleaned.lastIndexOf('.');
        const lastComma = cleaned.lastIndexOf(',');
        if (lastComma > lastDot) {
            // European: 1.234,56 → 1234.56
            cleaned = cleaned.replace(/\./g, '').replace(',', '.');
        }
        else {
            // US: 1,234.56 → remove commas
            cleaned = cleaned.replace(/,/g, '');
        }
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? 0 : parsed;
    }
}
exports.ScraperService = ScraperService;
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
async function runScraper(request, http) {
    const scraper = new ScraperService(undefined, request, http);
    return scraper.run();
}
