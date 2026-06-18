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
exports.ScraperService = void 0;
exports.runScraper = runScraper;
const cheerio = __importStar(require("cheerio"));
const config_1 = require("./config");
const image_downloader_1 = require("./image-downloader");
const types_1 = require("./types");
const http_client_1 = require("./http-client");
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
const productRepository = {
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
    async atomicUpsertByExternalId(product) {
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
    constructor(config, request) {
        this.loggedIn = false;
        this.config = config || (0, config_1.getScraperConfig)();
        this.request = request || {};
        this.http = (0, http_client_1.createHttpClient)(this.config);
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
            // Try to select branch if present
            try {
                const afterLoginHtml = await (0, http_client_1.safeGet)(this.http, '/default.aspx');
                const $branch = cheerio.load(afterLoginHtml);
                const branchSelect = $branch('select[id*="ddlSucursal"]');
                if (branchSelect.length > 0) {
                    const branchName = branchSelect.attr('name') || 'ddlSucursal';
                    const branchBody = {};
                    branchBody[branchName] = branchSelect.find('option').eq(1).attr('value') || '1';
                    await (0, http_client_1.safePost)(this.http, '/default.aspx', branchBody);
                }
            }
            catch {
                // Branch selection is optional
            }
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
     */
    async scrapeCategoryPage(idsubrubro1, pageNum) {
        const url = `/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=${pageNum}`;
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
            // Extract price: U$D 1234.56
            let price = null;
            const priceMatch = fullText.match(/U\$D\s+([\d.,]+)/);
            if (priceMatch) {
                price = parseFloat(priceMatch[1].replace(',', '.'));
            }
            // Name is everything before the price
            const name = fullText.replace(/U\$D[\s\d.,+IVA%]+$/, '').trim();
            if (!name || name.length < 3)
                return;
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
    async scrapeCategory(idsubrubro1) {
        const allProducts = [];
        const allIds = [];
        const maxPages = 20;
        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
            console.log(`[Scraper] Scraping page ${pageNum} (idsubrubro1=${idsubrubro1})`);
            const { products, hasMore } = await this.scrapeCategoryPage(idsubrubro1, pageNum);
            if (products.length === 0)
                break;
            // Get detail for each product
            for (const product of products) {
                try {
                    await (0, http_client_1.delay)((0, http_client_1.getRequestDelay)());
                    await this.enrichProductDetail(product);
                    allProducts.push(product);
                    allIds.push(product.externalId);
                }
                catch (e) {
                    console.log(`[Scraper] Error enriching product ${product.externalId}: ${e.message}`);
                    allProducts.push(product);
                    allIds.push(product.externalId);
                }
            }
            if (!hasMore)
                break;
        }
        // Also fetch images for each product (now that we have enriched data)
        for (const product of allProducts) {
            if (product.imageUrls.length > 0) {
                try {
                    const cloudUrls = await (0, image_downloader_1.uploadProductImages)(product.imageUrls, this.config.supplier, product.externalId);
                    product.cloudinaryUrls = cloudUrls;
                }
                catch {
                    // Image upload is optional
                }
            }
        }
        return { products: allProducts, externalIds: allIds };
    }
    /**
     * Enrich a product with full detail from its articulo.aspx page.
     */
    async enrichProductDetail(product) {
        const url = `/articulo.aspx?id=${product.externalId}`;
        const html = await (0, http_client_1.safeGet)(this.http, url);
        const $ = cheerio.load(html);
        // Description
        const descEl = $('#ContentPlaceHolder1_lblDescripcion').first() ||
            $('[id*="lblDescripcion"]').first();
        product.description = descEl.text().trim() || '';
        // Stock
        const stockEl = $('#ContentPlaceHolder1_lblStock').first() ||
            $('[id*="lblStock"]').first();
        const stockText = stockEl.text().trim();
        const stockMatch = stockText.match(/(\d+)/);
        product.stock = stockMatch ? parseInt(stockMatch[1], 10) : 0;
        // SKU
        const skuEl = $('#ContentPlaceHolder1_lblCodigo').first() ||
            $('[id*="lblCodigo"]').first();
        product.sku = skuEl.text().trim() || '';
        // Images
        const images = [];
        $('div.tg-img-overlay.artImg').each((_, el) => {
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
        const errors = [];
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
                            if (result.created)
                                created++;
                            if (result.updated)
                                updated++;
                        }
                        catch (e) {
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
        return {
            success: errors.length === 0 || !errors.some((e) => e.startsWith('Fatal')),
            created,
            updated,
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
async function runScraper(request) {
    const scraper = new ScraperService(undefined, request);
    return scraper.run();
}
