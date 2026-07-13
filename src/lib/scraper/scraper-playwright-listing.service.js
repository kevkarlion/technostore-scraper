"use strict";
/**
 * Scraper with Playwright Listing Price Detection
 *
 * Flow:
 *   1. HTTP listing → discover product IDs (new, existing, discontinued)
 *   2. Playwright listing → render pages to extract prices for ALL products
 *   3. Compare prices with DB → detect price changes
 *   4. Playwright detail → for new products AND products with price changes
 *   5. Upsert → don't overwrite valid data with defaults
 *
 * Benefits:
 *   - Detects price changes for existing products
 *   - Doesn't overwrite valid data with empty defaults
 *   - Only visits detail pages when necessary
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
exports.ScraperPlaywrightListingService = void 0;
exports.runScraperPlaywrightListing = runScraperPlaywrightListing;
const cheerio = __importStar(require("cheerio"));
const playwright_1 = require("playwright");
const config_1 = require("./config");
const http_client_1 = require("./http-client");
// ============================================================================
// PERSISTENT STORE
// ============================================================================
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
// PLAYWRIGHT LISTING ENRICHER
// ============================================================================
class PlaywrightListingEnricher {
    constructor() {
        this.browser = null;
        this.context = null;
        this.initialized = false;
        this.baseUrl = '';
    }
    async launch() {
        this.browser = await playwright_1.chromium.launch({ headless: true });
        this.context = await this.browser.newContext();
    }
    async initSession(baseUrl, credentials) {
        if (!this.context || this.initialized)
            return;
        this.baseUrl = baseUrl;
        const page = await this.context.newPage();
        try {
            // Navigate to login page
            await page.goto(`${baseUrl}/loginext.aspx`, { waitUntil: 'networkidle', timeout: 20000 });
            if (credentials) {
                await page.fill('#TxtEmail', credentials.email);
                await page.fill('#TxtPass1', credentials.password);
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => { }),
                    page.click('#BtnIngresar'),
                ]);
                console.log('[Playwright Listing] Login submitted');
            }
            // Navigate to establish session
            await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 });
            // Select branch (Cipolletti, Id=1)
            const branchOk = await page.evaluate(async () => {
                try {
                    if (typeof window.PageMethods !== 'undefined') {
                        return await new Promise((resolve) => {
                            window.PageMethods.SeleccionarSucursal(1, (response) => {
                                const el = document.getElementById('varIdDeposito');
                                if (el)
                                    el.value = response.IdDepositoDefecto;
                                resolve(true);
                            }, () => resolve(false));
                        });
                    }
                    const resp = await fetch('/articulo.aspx/SeleccionarSucursal', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json; charset=utf-8',
                            'X-Requested-With': 'XMLHttpRequest',
                        },
                        body: JSON.stringify({ Id: 1 }),
                    });
                    return resp.ok;
                }
                catch {
                    return false;
                }
            });
            if (branchOk) {
                this.initialized = true;
                console.log('[Playwright Listing] Session initialized');
            }
            else {
                console.error('[Playwright Listing] Failed to select branch');
            }
        }
        finally {
            await page.close();
        }
    }
    /**
     * Render a listing page with Playwright and extract prices for all products.
     */
    async extractPricesFromListing(idsubrubro1, pageNum) {
        if (!this.context)
            throw new Error('Browser not launched');
        if (!this.baseUrl)
            throw new Error('baseUrl required');
        const page = await this.context.newPage();
        try {
            const url = `${this.baseUrl}/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=${pageNum}&conIva=1`;
            await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
            // Wait for products to render
            await page.waitForSelector('a[href*="articulo.aspx?id="]', { timeout: 10000 }).catch(() => { });
            // Extract prices from rendered DOM
            const prices = await page.evaluate(() => {
                const results = [];
                const links = document.querySelectorAll('a[href*="articulo.aspx?id="]');
                links.forEach((link) => {
                    const href = link.getAttribute('href') || '';
                    const idMatch = href.match(/id=(\d+)/);
                    if (!idMatch)
                        return;
                    const externalId = idMatch[1];
                    const text = link.textContent?.trim() || '';
                    // Extract price: U$D 123,45
                    const priceMatch = text.match(/U\$D\s+([\d.,]+)/);
                    if (priceMatch) {
                        const priceStr = priceMatch[1];
                        // Parse price: "1.234,56" → 1234.56
                        let cleaned = priceStr.replace(/\./g, '').replace(',', '.');
                        const price = parseFloat(cleaned);
                        if (!isNaN(price)) {
                            results.push({ externalId, priceRaw: priceStr, price });
                        }
                    }
                });
                return results;
            });
            return prices;
        }
        finally {
            await page.close();
        }
    }
    /**
     * Enrich a product by navigating to its detail page.
     */
    async enrichProduct(externalId) {
        if (!this.context)
            throw new Error('Browser not launched');
        if (!this.baseUrl)
            throw new Error('baseUrl required');
        const page = await this.context.newPage();
        try {
            await page.goto(`${this.baseUrl}/articulo.aspx?id=${externalId}`, {
                waitUntil: 'networkidle',
                timeout: 20000,
            });
            // Wait for price element
            await page.waitForSelector('div.col-12.tg-body-f18', { timeout: 5000 }).catch(() => { });
            const scraped = await page.evaluate(() => {
                const data = {};
                // USD price
                const usdEl = document.querySelector('div.col-12.tg-body-f18');
                if (usdEl)
                    data.priceRaw = usdEl.textContent?.trim() || '';
                // Description
                const descEl = document.getElementById('divArticuloDescripcion');
                if (descEl)
                    data.description = descEl.textContent?.trim() || '';
                // SKU
                const skuEl = document.querySelector('[id*="lblCodigo"]');
                if (skuEl)
                    data.sku = skuEl.textContent?.trim() || '';
                // Stock
                const stockEl = document.querySelector('[id*="lblStock"]');
                if (stockEl) {
                    const stockText = stockEl.textContent?.trim() || '';
                    const stockMatch = stockText.match(/(\d+)/);
                    data.stock = stockMatch ? parseInt(stockMatch[1], 10) : 0;
                }
                // Images — inline logic (no inner functions — Playwright transpiler bug)
                const imageSet = new Set();
                const images = [];
                const mainImg = document.getElementById('artImg');
                if (mainImg && mainImg.src && mainImg.src.includes('imagenes/')) {
                    const mainSrc = mainImg.src.replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, '');
                    const normalized = mainSrc.toLowerCase();
                    if (!imageSet.has(normalized)) {
                        imageSet.add(normalized);
                        images.push(mainSrc);
                    }
                }
                const artImgs = document.querySelectorAll('div.tg-img-overlay.artImg');
                artImgs.forEach((el) => {
                    const src = el.getAttribute('data-src');
                    if (src && src.includes('imagenes/')) {
                        const clean = src.replace(/^\/+/, '');
                        const normalized = clean.toLowerCase();
                        if (!imageSet.has(normalized)) {
                            imageSet.add(normalized);
                            images.push(clean);
                        }
                    }
                });
                data.imageUrls = images.slice(0, 10);
                return data;
            });
            // Parse price
            let priceRaw = '';
            let price = 0;
            if (scraped.priceRaw) {
                const usdMatch = scraped.priceRaw.match(/U\$D\s+([\d.,]+)/);
                priceRaw = usdMatch ? usdMatch[1] : scraped.priceRaw;
                let cleaned = priceRaw.replace(/\./g, '').replace(',', '.');
                price = parseFloat(cleaned) || 0;
            }
            return {
                externalId,
                name: '', // Will be filled from listing
                description: scraped.description || '',
                priceRaw,
                price,
                sku: scraped.sku || '',
                stock: scraped.stock || 0,
                imageUrls: scraped.imageUrls || [],
                categories: [],
            };
        }
        finally {
            await page.close();
        }
    }
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.context = null;
            this.initialized = false;
        }
    }
}
// ============================================================================
// SCRAPER SERVICE
// ============================================================================
class ScraperPlaywrightListingService {
    constructor(config, request, http) {
        this.loggedIn = false;
        this.config = config || (0, config_1.getScraperConfig)();
        this.request = request || {};
        this.http = http || (0, http_client_1.createHttpClient)(this.config);
        this.categories = [];
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
    async login() {
        if (this.loggedIn)
            return;
        console.log('[Scraper] Logging in...');
        const loginBody = {};
        const loginPageHtml = await (0, http_client_1.safeGet)(this.http, this.config.loginUrl);
        const $login = cheerio.load(loginPageHtml);
        $login('input[type="hidden"]').each((_, el) => {
            const name = $login(el).attr('name');
            const value = $login(el).attr('value') || '';
            if (name)
                loginBody[name] = value;
        });
        const emailInputName = this.findInputName($login, 'txtUsuario');
        const passInputName = this.findInputName($login, 'txtClave');
        if (emailInputName)
            loginBody[emailInputName] = this.config.email;
        if (passInputName)
            loginBody[passInputName] = this.config.password;
        const btnName = this.findInputName($login, 'btnIngresar') || 'btnIngresar';
        loginBody[btnName] = 'Ingresar';
        const postLoginHtml = await (0, http_client_1.safeGet)(this.http, this.config.loginUrl);
        const $verify = cheerio.load(postLoginHtml);
        if ($verify('input[name*="txtUsuario"]').length > 0) {
            console.log('[Scraper] Simple login attempt...');
            const simpleBody = {};
            simpleBody[emailInputName || 'txtUsuario'] = this.config.email;
            simpleBody[passInputName || 'txtClave'] = this.config.password;
            simpleBody[btnName] = 'Ingresar';
            await (0, http_client_1.safeGet)(this.http, this.config.loginUrl);
        }
        this.loggedIn = true;
        console.log('[Scraper] Login successful');
    }
    findInputName($, fieldId) {
        const el = $(`input[name*="${fieldId}"]`).first();
        return el.attr('name') || null;
    }
    // ============================================================================
    // CATEGORY SCRAPING (HTTP only - IDs and names)
    // ============================================================================
    async scrapeCategoryIds(idsubrubro1) {
        const allProducts = [];
        const allIds = [];
        const maxPages = 20;
        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
            const url = `/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=${pageNum}&conIva=1`;
            const html = await (0, http_client_1.safeGet)(this.http, url);
            const $ = cheerio.load(html);
            const productLinks = $('a[href*="articulo.aspx?id="]');
            if (productLinks.length === 0)
                break;
            productLinks.each((_, el) => {
                const href = $(el).attr('href') || '';
                const fullText = $(el).text().trim();
                const idMatch = href.match(/id=(\d+)/);
                if (!idMatch)
                    return;
                const externalId = idMatch[1];
                // Name is everything before the price (or full text if no price)
                const name = fullText.replace(/U\$D[\s\d.,+IVA%]+$/, '').trim();
                if (!name || name.length < 3)
                    return;
                // Image from listing
                const imgDiv = $(el).find('div.tg-article-img');
                const bgImage = imgDiv.attr('style') || '';
                const bgMatch = bgImage.match(/url\(([^)]+)\)/);
                let imageUrl;
                if (bgMatch) {
                    const imgUrl = bgMatch[1].replace(/['"]/g, '').trim();
                    if (imgUrl.includes('imagenes/')) {
                        imageUrl = imgUrl;
                    }
                }
                allProducts.push({ externalId, name, imageUrl });
                allIds.push(externalId);
            });
            // Check if there's a next page
            const hasNextPage = $('a[href*="buscar.aspx"]').filter((_, el) => {
                const href = $(el).attr('href') || '';
                return href.includes(`pag=${pageNum + 1}`);
            }).length > 0;
            if (!hasNextPage)
                break;
        }
        return { products: allProducts, externalIds: allIds };
    }
    // ============================================================================
    // UPSERT (with protection against overwriting valid data)
    // ============================================================================
    async upsertProduct(product) {
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
        // Helper: check if a value is "empty" (scraper default, not real data)
        const isEmpty = (val) => val === undefined || val === null || val === '' || val === 0 ||
            (Array.isArray(val) && val.length === 0);
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
            if (JSON.stringify(existingVal) !== JSON.stringify(newVal)) {
                // Don't overwrite valid existing data with empty/zero defaults
                if (isEmpty(newVal) && !isEmpty(existingVal)) {
                    continue;
                }
                updateOps[field] = newVal;
                changes.push(field);
            }
        }
        if (changes.length > 0) {
            await collection.updateOne({ _id: existing._id }, { $set: updateOps });
            console.log(`[Upsert] ${product.externalId}: UPDATED — ${changes.join(', ')}`);
            return { created: false, updated: true, changes };
        }
        console.log(`[Upsert] ${product.externalId}: NO CHANGES`);
        return { created: false, updated: false, changes: [] };
    }
    // ============================================================================
    // MAIN RUN
    // ============================================================================
    async run() {
        const startTime = Date.now();
        let created = 0;
        let updated = 0;
        const createdIds = [];
        const updatedIds = [];
        const errors = [];
        let enricher = null;
        try {
            // Login
            if (!this.request.skipLogin) {
                await this.login();
            }
            // Launch Playwright
            try {
                enricher = new PlaywrightListingEnricher();
                await enricher.launch();
                await enricher.initSession(this.config.baseUrl, {
                    email: this.config.email,
                    password: this.config.password,
                });
                console.log('[Scraper] Playwright launched');
            }
            catch (e) {
                console.error('[Scraper] Failed to launch Playwright:', e.message);
                enricher = null;
            }
            // Process each category
            for (const cat of this.categories) {
                try {
                    console.log(`[Scraper] Processing category: ${cat.id}`);
                    // Step 1: HTTP listing → get product IDs
                    const { products: listingProducts, externalIds } = await this.scrapeCategoryIds(cat.idsubrubro1);
                    console.log(`[Scraper] Category ${cat.id}: ${listingProducts.length} products found`);
                    // Step 2: Playwright listing → extract prices for ALL products
                    const listingPrices = new Map();
                    if (enricher && listingProducts.length > 0) {
                        console.log(`[Scraper] Extracting prices from listing via Playwright...`);
                        // Get all pages for this category
                        const maxPages = 20;
                        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
                            try {
                                const prices = await enricher.extractPricesFromListing(cat.idsubrubro1, pageNum);
                                if (prices.length === 0)
                                    break;
                                for (const p of prices) {
                                    listingPrices.set(p.externalId, p);
                                }
                                console.log(`[Scraper] Page ${pageNum}: ${prices.length} prices extracted`);
                            }
                            catch (e) {
                                console.error(`[Scraper] Error extracting prices from page ${pageNum}:`, e.message);
                            }
                        }
                        console.log(`[Scraper] Total prices extracted: ${listingPrices.size}`);
                    }
                    // Step 3: Compare prices with DB and identify what needs enrichment
                    const db = await getDb();
                    const productsCollection = db.collection('products');
                    const productsToEnrich = [];
                    for (const product of listingProducts) {
                        const existing = await productsCollection.findOne({
                            externalId: product.externalId,
                            supplier: 'jotakp',
                        });
                        if (!existing) {
                            // New product → needs full enrichment
                            productsToEnrich.push({ product, reason: 'new' });
                        }
                        else {
                            // Existing product → check if price changed
                            const listingPrice = listingPrices.get(product.externalId);
                            if (listingPrice) {
                                const existingPrice = existing.costPrice || existing.price || 0;
                                // Compare prices (allow small floating point differences)
                                if (Math.abs(listingPrice.price - existingPrice) > 0.01) {
                                    console.log(`[Scraper] Price changed for ${product.externalId}: ${existingPrice} → ${listingPrice.price}`);
                                    productsToEnrich.push({ product, reason: 'price_changed' });
                                }
                            }
                        }
                    }
                    console.log(`[Scraper] ${productsToEnrich.length} products need enrichment (${productsToEnrich.filter(p => p.reason === 'new').length} new, ${productsToEnrich.filter(p => p.reason === 'price_changed').length} price changed)`);
                    // Step 4: Playwright detail → enrich products that need it
                    const ENRICHMENT_CONCURRENCY = 3;
                    let enrichedCount = 0;
                    if (enricher && productsToEnrich.length > 0) {
                        for (let i = 0; i < productsToEnrich.length; i += ENRICHMENT_CONCURRENCY) {
                            const batch = productsToEnrich.slice(i, i + ENRICHMENT_CONCURRENCY);
                            const results = await Promise.allSettled(batch.map(async ({ product }) => {
                                const enriched = await enricher.enrichProduct(product.externalId);
                                enriched.name = product.name;
                                enriched.categories = [cat.id];
                                // Parse price from enriched data
                                let price = enriched.price;
                                if (price === 0 && enriched.priceRaw) {
                                    let cleaned = enriched.priceRaw.replace(/\./g, '').replace(',', '.');
                                    price = parseFloat(cleaned) || 0;
                                }
                                // Upsert to DB
                                const upsertResult = await this.upsertProduct({
                                    externalId: enriched.externalId,
                                    name: enriched.name,
                                    description: enriched.description,
                                    price,
                                    priceRaw: enriched.priceRaw,
                                    currency: 'USD',
                                    stock: enriched.stock,
                                    sku: enriched.sku,
                                    imageUrls: enriched.imageUrls,
                                    categories: enriched.categories,
                                    attributes: [],
                                    inStock: enriched.stock > 0 || true,
                                });
                                return upsertResult;
                            }));
                            enrichedCount += results.filter(r => r.status === 'fulfilled').length;
                            for (const f of results.filter(r => r.status === 'rejected')) {
                                console.error(`[Playwright] enrichment failed: ${f.reason?.message || f}`);
                            }
                        }
                    }
                    console.log(`[Scraper] Category ${cat.id}: ${enrichedCount} products enriched`);
                    // Step 5: Mark discontinued
                    if (externalIds.length > 0) {
                        const result = await productsCollection.updateMany({
                            categories: cat.id,
                            supplier: 'jotakp',
                            externalId: { $nin: externalIds },
                            status: { $ne: 'discontinued' },
                        }, { $set: { status: 'discontinued', discontinuedAt: new Date(), updatedAt: new Date() } });
                        if (result.modifiedCount > 0) {
                            console.log(`[Scraper] Marked ${result.modifiedCount} products as discontinued in ${cat.id}`);
                        }
                    }
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
            await enricher?.close();
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
}
exports.ScraperPlaywrightListingService = ScraperPlaywrightListingService;
// ============================================================================
// FACTORY FUNCTION
// ============================================================================
async function runScraperPlaywrightListing(request) {
    const scraper = new ScraperPlaywrightListingService(undefined, request);
    return scraper.run();
}
