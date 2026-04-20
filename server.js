"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const playwright_1 = require("playwright");
const mongodb_1 = require("mongodb");
const crypto_1 = __importDefault(require("crypto"));
const node_cron_1 = __importDefault(require("node-cron"));
// ===============================================
// TIMEZONE HELPERS - Argentina (UTC-3)
// ===============================================
const TIMEZONE = 'America/Argentina/Buenos_Aires';
function toArgentinaTime(date) {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString('es-AR', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}
function formatArgentinaDate(date) {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString('es-AR', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}
// Import new scraper modules (use alias to avoid conflict)
const index_1 = require("./src/lib/scraper/index");
// CONFIG - with defaults and logging
const SUPPLIER_URL = process.env.SUPPLIER_URL || 'https://jotakp.dyndns.org';
const SUPPLIER_LOGIN_URL = process.env.SUPPLIER_LOGIN_URL || 'http://jotakp.dyndns.org/loginext.aspx';
const SUPPLIER_EMAIL = process.env.SUPPLIER_EMAIL || '20418216795';
const SUPPLIER_PASSWORD = process.env.SUPPLIER_PASSWORD || '123456';
console.log('[Config] SUPPLIER_URL:', SUPPLIER_URL);
console.log('[Config] SUPPLIER_EMAIL:', SUPPLIER_EMAIL);
const SCRAPER_CONFIG = {
    baseUrl: SUPPLIER_URL,
    loginUrl: SUPPLIER_LOGIN_URL,
    email: SUPPLIER_EMAIL,
    password: SUPPLIER_PASSWORD,
    selectors: {
        login: {
            emailInputSelector: '#ContentPlaceHolder1_txtUsuario, #txtUsuario',
            passwordInputSelector: '#ContentPlaceHolder1_txtClave, #txtClave',
            submitButtonSelector: '#ContentPlaceHolder1_btnIngresar, #btnIngresar'
        }
    }
};
// Validation
if (!SCRAPER_CONFIG.email) {
    throw new Error('SUPPLIER_EMAIL is required');
}
if (!SCRAPER_CONFIG.password) {
    throw new Error('SUPPLIER_PASSWORD is required');
}
if (!SCRAPER_CONFIG.selectors.login.emailInputSelector) {
    throw new Error('emailInputSelector is undefined');
}
console.log('[Config] Selectors:', SCRAPER_CONFIG.selectors.login);
const JOTAKP_CATEGORIES = [
    { id: 'carry-caddy-disk', idsubrubro1: 100 },
    { id: 'cd-dvd-bluray', idsubrubro1: 13 },
    { id: 'discos-externos', idsubrubro1: 14 },
    { id: 'discos-hdd', idsubrubro1: 69 },
    { id: 'discos-m2', idsubrubro1: 157 },
    { id: 'discos-ssd', idsubrubro1: 156 },
    { id: 'memorias-flash', idsubrubro1: 12 },
    { id: 'pendrive', idsubrubro1: 5 },
    { id: 'memorias', idsubrubro1: 1 },
    { id: 'auricular-bluetooth', idsubrubro1: 149 },
    { id: 'auricular-cableado', idsubrubro1: 36 },
    { id: 'microfonos', idsubrubro1: 45 },
    { id: 'parlantes', idsubrubro1: 35 },
];
const CATEGORIES = JOTAKP_CATEGORIES;
const MAX_PARALLEL = 2;
const MAX_PAGES = 3;
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME || 'ecommerce';
// SINGLETON: cliente y db reuse - CRÍTICO para M0
let mongoClient = null;
let db = null;
async function getDb() {
    if (!mongoClient) {
        mongoClient = new mongodb_1.MongoClient(MONGO_URI, {
            maxPoolSize: 5, // Reducido para M0 (500 conexiones máximo)
            minPoolSize: 0, // No mantener conexiones ociosas
            maxIdleTimeMS: 10000, // Cerrar inactivas después de 10s
            waitQueueTimeoutMS: 5000,
            serverSelectionTimeoutMS: 5000,
        });
        await mongoClient.connect();
        console.log('[Mongo] Connected with pool (max: 5, min: 0)');
    }
    if (!db) {
        db = mongoClient.db(DB_NAME);
        global.db = db;
    }
    return db;
}
// Force close después de operaciones batch
async function closeMongoConnection() {
    if (mongoClient) {
        await mongoClient.close();
        console.log('[Mongo] Connection closed');
        mongoClient = null;
        db = null;
    }
}
process.on('SIGINT', async () => {
    await closeMongoConnection();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    await closeMongoConnection();
    process.exit(0);
});
function generateContentHash(content) {
    return crypto_1.default.createHash('md5').update(content).digest('hex');
}
async function getCategoryPreview(page, idsubrubro1, baseUrl) {
    try {
        const url = baseUrl + '/buscar.aspx?idsubrubro1=' + idsubrubro1 + '&pag=1';
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForSelector("div:has-text('U$D')", { timeout: 10000 }).catch(() => { });
        const content = await page.content();
        const contentHash = generateContentHash(content);
        const items = await page.locator('a[href*="articulo.aspx?id="]').all();
        const productIds = [];
        const seenIds = new Set();
        for (const item of items) {
            const href = await item.getAttribute('href');
            if (href) {
                const match = href.match(/id=(\d+)/);
                if (match && !seenIds.has(match[1])) {
                    seenIds.add(match[1]);
                    productIds.push(match[1]);
                }
            }
        }
        return { contentHash, productCount: productIds.length, productIds };
    }
    catch (e) {
        console.error('[Pre-check] Error:', e.message);
        return null;
    }
}
async function preCheckCategories(categories, page) {
    const result = { changed: [], unchanged: [], errors: [] };
    console.log('[Pre-check] Checking', categories.length, 'categories...');
    for (let i = 0; i < categories.length; i += MAX_PARALLEL) {
        const batch = categories.slice(i, i + MAX_PARALLEL);
        console.log('[Pre-check] Batch', Math.floor(i / MAX_PARALLEL) + 1);
        const batchPromises = batch.map(async (cat) => {
            const preview = await getCategoryPreview(page, cat.idsubrubro1, SCRAPER_CONFIG.baseUrl);
            if (!preview)
                return { categoryId: cat.id, status: 'error' };
            const database = await getDb();
            const existing = await database.collection('scraper_state').findOne({ categoryId: cat.id });
            const hasChanged = !existing || existing.contentHash !== preview.contentHash;
            await database.collection('scraper_state').updateOne({ categoryId: cat.id }, { $set: { categoryId: cat.id, idsubrubro1: cat.idsubrubro1, contentHash: preview.contentHash, productCount: preview.productCount, capturedAt: new Date() } }, { upsert: true });
            return { categoryId: cat.id, status: hasChanged ? 'changed' : 'unchanged', count: preview.productCount };
        });
        const batchResults = await Promise.all(batchPromises);
        for (const r of batchResults) {
            if (r.status === 'changed')
                result.changed.push(r.categoryId);
            else if (r.status === 'unchanged')
                result.unchanged.push(r.categoryId);
            else
                result.errors.push(r.categoryId);
        }
    }
    console.log('[Pre-check] Complete:', result.changed.length, 'changed');
    return result;
}
async function scrapeCategoryProducts(page, categoryId, idsubrubro1) {
    console.log('[Scraper] Scraping:', categoryId);
    const products = [];
    const scrapedIds = [];
    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
        const url = SCRAPER_CONFIG.baseUrl + '/buscar.aspx?idsubrubro1=' + idsubrubro1 + '&pag=' + pageNum;
        try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForSelector('a[href*="articulo.aspx?id="]', { timeout: 5000 }).catch(() => { });
            const items = await page.locator('a[href*="articulo.aspx?id="]').all();
            if (items.length === 0)
                break;
            console.log('[Scraper] Page', pageNum, ':', items.length, 'products');
            for (const item of items) {
                try {
                    const href = await item.getAttribute('href');
                    const fullText = await item.textContent();
                    const match = href.match(/id=(\d+)/);
                    const externalId = match ? match[1] : null;
                    if (!externalId)
                        continue;
                    let price = null;
                    const priceMatch = fullText.match(/U\$D\s+([\d.,]+)/);
                    if (priceMatch)
                        price = parseFloat(priceMatch[1].replace(',', '.'));
                    let name = fullText.replace(/U\$D[\s\d.,+IVA%]+$/, '').trim();
                    if (!name || name.length < 3)
                        continue;
                    await page.goto(SCRAPER_CONFIG.baseUrl + '/articulo.aspx?id=' + externalId, { waitUntil: 'networkidle', timeout: 30000 });
                    let description = '';
                    try {
                        const desc = await page.$('#ContentPlaceHolder1_lblDescripcion');
                        if (desc)
                            description = await desc.textContent() || '';
                    }
                    catch { }
                    let stock = 0;
                    try {
                        const stockEl = await page.$('#ContentPlaceHolder1_lblStock');
                        if (stockEl) {
                            const stockText = await stockEl.textContent() || '';
                            const stockMatch = stockText.match(/(\d+)/);
                            stock = stockMatch ? parseInt(stockMatch[1]) : 0;
                        }
                    }
                    catch { }
                    let sku = '';
                    try {
                        const skuEl = await page.$('#ContentPlaceHolder1_lblCodigo');
                        if (skuEl)
                            sku = await skuEl.textContent() || '';
                    }
                    catch { }
                    const imageUrls = [];
                    try {
                        const imgs = await page.locator('div.tg-img-overlay.artImg').all();
                        for (const img of imgs.slice(0, 5)) {
                            const src = await img.getAttribute('data-src');
                            if (src && src.includes('imagenes/'))
                                imageUrls.push(src);
                        }
                    }
                    catch { }
                    await page.goBack();
                    await page.waitForLoadState('networkidle').catch(() => { });
                    products.push({ externalId, name, price, stock, description, sku, imageUrls });
                    scrapedIds.push(externalId);
                }
                catch (e) {
                    console.log('[Scraper] Error product:', e.message);
                    try {
                        await page.goBack();
                    }
                    catch { }
                }
            }
        }
        catch (e) {
            console.log('[Scraper] Error page', pageNum, ':', e.message);
        }
    }
    return { products, scrapedIds };
}
// ===============================================
// BULK OPERATIONS - Optimizado para M0
// ===============================================
async function saveProductsBatch(products, categoryId) {
    if (products.length === 0)
        return { created: 0, updated: 0, unchanged: 0 };
    const database = await getDb();
    const collection = database.collection('products');
    // 1. Obtener todos los productos existentes de una sola vez
    const externalIds = products.map(p => p.externalId);
    const existingProducts = await collection.find({
        externalId: { $in: externalIds },
        supplier: 'jotakp'
    }).toArray();
    const existingMap = new Map(existingProducts.map((p) => [p.externalId, p]));
    // 2. Preparar operaciones bulk
    const operations = [];
    const now = new Date();
    for (const product of products) {
        const existing = existingMap.get(product.externalId);
        const baseUpdate = {
            lastSyncedAt: now,
            categories: [categoryId],
            externalId: product.externalId,
            supplier: 'jotakp'
        };
        // Agregar campos si existen
        if (product.name)
            baseUpdate.name = product.name;
        if (product.price !== null)
            baseUpdate.price = product.price;
        if (product.stock !== undefined)
            baseUpdate.stock = product.stock;
        if (product.description)
            baseUpdate.description = product.description;
        if (product.sku)
            baseUpdate.sku = product.sku;
        if (product.imageUrls && product.imageUrls.length > 0)
            baseUpdate.imageUrls = product.imageUrls;
        if (existing) {
            // Verificar si hay cambios
            const changed = { lastSyncedAt: now };
            for (const key of ['name', 'price', 'stock', 'description', 'sku', 'imageUrls']) {
                if (product[key] !== undefined && JSON.stringify(existing[key]) !== JSON.stringify(product[key])) {
                    changed[key] = product[key];
                }
            }
            if (Object.keys(changed).length > 1) { // más que solo lastSyncedAt
                operations.push({
                    updateOne: {
                        filter: { _id: existing._id },
                        update: { $set: changed }
                    }
                });
            }
        }
        else {
            // Insertar nuevo
            operations.push({
                insertOne: {
                    document: {
                        ...baseUpdate,
                        status: 'active',
                        currency: 'USD',
                        attributes: [],
                        createdAt: now,
                        updatedAt: now
                    }
                }
            });
        }
    }
    // 3. Ejecutar bulkWrite si hay operaciones
    if (operations.length > 0) {
        const result = await collection.bulkWrite(operations, { ordered: false });
        return {
            created: result.insertedCount || 0,
            updated: result.modifiedCount || 0,
            unchanged: products.length - (result.insertedCount || 0) - (result.modifiedCount || 0)
        };
    }
    return { created: 0, updated: 0, unchanged: products.length };
}
// Función legacy para compatibilidad (usa bulk internamente)
async function saveProduct(product, categoryId) {
    const result = await saveProductsBatch([product], categoryId);
    return { created: result.created > 0, updated: result.updated > 0 };
}
async function markDiscontinued(categoryId, scrapedIds) {
    const database = await getDb();
    const result = await database.collection('products').updateMany({ categories: categoryId, supplier: 'jotakp', externalId: { $nin: scrapedIds } }, { $set: { status: 'discontinued', discontinuedAt: new Date() } });
    return result.modifiedCount;
}
async function runIncrementalScraper(forceFullScrape = false) {
    console.log('[Incremental] Starting...');
    const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
    const browser = await playwright_1.chromium.launch({ headless: true, executablePath: chromiumPath, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const results = { created: 0, updated: 0, unchanged: 0, discontinued: 0 };
    try {
        console.log('[Incremental] Login...');
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(SCRAPER_CONFIG.loginUrl, { waitUntil: 'networkidle' });
        await page.fill(SCRAPER_CONFIG.selectors.login.emailInputSelector, SCRAPER_CONFIG.email);
        await page.fill(SCRAPER_CONFIG.selectors.login.passwordInputSelector, SCRAPER_CONFIG.password);
        await page.click(SCRAPER_CONFIG.selectors.login.submitButtonSelector);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);
        try {
            const branchSelect = await page.$('#ContentPlaceHolder1_ddlSucursal, #ddlSucursal');
            if (branchSelect) {
                await branchSelect.selectOption({ index: 1 });
                await page.waitForLoadState('networkidle');
            }
        }
        catch {
            // Ignore branch selection errors
        }
        console.log('[Incremental] Logged in');
        let preCheckResult;
        if (forceFullScrape) {
            preCheckResult = { changed: CATEGORIES.map(c => c.id), unchanged: [], errors: [] };
        }
        else {
            preCheckResult = await preCheckCategories(CATEGORIES, page);
        }
        console.log('[Incremental] Pre-check:', preCheckResult.changed.length, 'changed');
        if (preCheckResult.changed.length === 0) {
            return { success: true, preCheck: preCheckResult };
        }
        const changedCats = CATEGORIES.filter(c => preCheckResult.changed.includes(c.id));
        for (let i = 0; i < changedCats.length; i += MAX_PARALLEL) {
            const batch = changedCats.slice(i, i + MAX_PARALLEL);
            console.log('[Incremental] Scraping batch:', batch.map(c => c.id).join(', '));
            const batchPromises = batch.map(async (cat) => {
                try {
                    return await scrapeCategoryProducts(page, cat.id, cat.idsubrubro1);
                }
                catch (e) {
                    console.log('[Incremental] Error', cat.id, ':', e.message);
                    return { products: [], scrapedIds: [] };
                }
            });
            const batchResults = await Promise.all(batchPromises);
            // Guardar en batch POR CATEGORÍA (no producto por producto)
            for (const r of batchResults) {
                if (r.products.length > 0) {
                    // Encontrar la categoría correcta para este resultado
                    const catResult = batch.find((cat, idx) => batchResults[idx]?.products === r.products || batchResults[idx] === r);
                    const catId = catResult?.id || 'unknown';
                    // bulkWrite de todos los productos de una vez
                    const saveResult = await saveProductsBatch(r.products, catId);
                    results.created += saveResult.created;
                    results.updated += saveResult.updated;
                    results.unchanged += saveResult.unchanged;
                    // Marcar discontinued solo si hay products scrapeados
                    if (r.scrapedIds.length > 0) {
                        const count = await markDiscontinued(catId, r.scrapedIds);
                        results.discontinued += count;
                    }
                }
            }
            console.log('[Incremental] Done! Created:', results.created, 'Updated:', results.updated);
        }
        return { success: true, preCheck: preCheckResult, scrapeResult: results };
    }
    catch (error) {
        console.error('[Incremental] Error:', error);
        return { success: false, error: String(error) };
    }
    finally {
        // CERRAR conexion Mongo despues de cada scrape (libera conexiones para M0)
        await closeMongoConnection();
        console.log('[Mongo] Connection closed after scrape');
        await browser.close();
    }
}
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
app.use(express_1.default.json());
app.get('/health', async (req, res) => { res.json({ status: 'ok', timestamp: new Date().toISOString() }); });
app.post('/run', async (req, res) => {
    try {
        const forceFullScrape = req.query.force === 'true';
        const result = await runIncrementalScraper(forceFullScrape);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ success: false, error: String(error) });
    }
});
app.get('/status', async (req, res) => {
    try {
        const database = await getDb();
        const totalProducts = await database.collection('products').countDocuments({ supplier: 'jotakp', status: 'active' });
        const lastScrapes = await database.collection('scraper_state').find().sort({ capturedAt: -1 }).limit(10).toArray();
        res.json({
            status: 'ok',
            products: totalProducts,
            timezone: TIMEZONE,
            lastScrapes: lastScrapes.map((s) => ({
                category: s.categoryId,
                date: formatArgentinaDate(s.capturedAt)
            }))
        });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// NEW: Full scraper endpoints (from TechnoStore)
app.get('/scraper/categories', (req, res) => {
    // List available categories
    const categories = index_1.jotakpCategories.map(c => ({ id: c.id, name: c.name, idsubrubro1: c.idsubrubro1, parentId: c.parentId }));
    res.json({ categories });
});
app.post('/scraper/run', async (req, res) => {
    // Run full scraper for specific category or all
    // Add retry logic for cold starts
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            console.log(`[Scraper] Attempt ${attempt}/3...`);
            const { categoryId, idsubrubro1, source } = req.body;
            const result = await (0, index_1.runScraper)({ categoryId, idsubrubro1, source });
            return res.json(result);
        }
        catch (error) {
            console.error(`[Scraper] Attempt ${attempt} failed:`, error.message);
            lastError = error;
            if (attempt < 3) {
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }
    res.status(500).json({ success: false, error: String(lastError) });
});
app.post('/scraper/incremental', async (req, res) => {
    // Run incremental scraper with pre-check (using new module)
    // Add retry logic for cold starts
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            console.log(`[Incremental] Attempt ${attempt}/3...`);
            const { forceFullScrape } = req.body;
            const result = await (0, index_1.runIncrementalScraper)(forceFullScrape);
            return res.json(result);
        }
        catch (error) {
            console.error(`[Incremental] Attempt ${attempt} failed:`, error.message);
            lastError = error;
            // Wait 5 seconds before retry
            if (attempt < 3) {
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }
    res.status(500).json({ success: false, error: String(lastError) });
});
// Debug endpoint to fix discontinued products
app.post('/debug/fix-discontinued', async (req, res) => {
    try {
        const { category } = req.body;
        const db = await getDb();
        const result = await db.collection('products').updateMany({ categories: category, status: 'discontinued' }, { $set: { status: 'active' }, $unset: { discontinuedAt: '' } });
        res.json({ success: true, modifiedCount: result.modifiedCount });
    }
    catch (error) {
        res.status(500).json({ success: false, error: String(error) });
    }
});
// Debug endpoint to check products
app.post('/debug/check-products', async (req, res) => {
    try {
        const { category } = req.body;
        const db = await getDb();
        const products = await db.collection('products')
            .find({ categories: category, status: 'active' })
            .project({ name: 1, imageUrls: 1 })
            .limit(5)
            .toArray();
        res.json({ success: true, products });
    }
    catch (error) {
        res.status(500).json({ success: false, error: String(error) });
    }
});
app.listen(PORT, () => {
    console.log('[Server] Scraper server on port', PORT);
    // ===============================================
    // SCHEDULER - Argentina timezone (UTC-3)
    // ===============================================
    const SCRAPER_SCHEDULE = process.env.SCRAPER_SCHEDULE || '0 6 * * *'; // Default: 6am Argentina
    const TIMEZONE = 'America/Argentina/Buenos_Aires';
    console.log(`[Cron] Schedule: ${SCRAPER_SCHEDULE} (${TIMEZONE})`);
    // Verificar que el schedule sea válido
    if (!node_cron_1.default.validate(SCRAPER_SCHEDULE)) {
        console.error('[Cron] Invalid schedule:', SCRAPER_SCHEDULE);
    }
    else {
        node_cron_1.default.schedule(SCRAPER_SCHEDULE, async () => {
            console.log('[Cron] Running scheduled incremental scrape...');
            const startTime = Date.now();
            try {
                const result = await (0, index_1.runIncrementalScraper)(false);
                const duration = Math.round((Date.now() - startTime) / 1000);
                console.log(`[Cron] Completed in ${duration}s - Created: ${result.scrapeResult?.created}, Updated: ${result.scrapeResult?.updated}`);
            }
            catch (error) {
                console.error('[Cron] Error:', error);
            }
        }, { timezone: TIMEZONE });
        console.log('[Cron] Scheduler active');
    }
});
// Endpoints para controlar el scheduler
app.get('/scheduler/status', (req, res) => {
    res.json({
        schedule: process.env.SCRAPER_SCHEDULE || '0 6 * * *',
        timezone: 'America/Argentina/Buenos_Aires',
        enabled: true
    });
});
