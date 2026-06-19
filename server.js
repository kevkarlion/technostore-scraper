"use strict";
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
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const mongodb_1 = require("mongodb");
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
// Import new scraper modules
const index_1 = require("./src/lib/scraper/index");
const monitoring_1 = require("./src/lib/monitoring");
const api_1 = require("./src/lib/monitoring/api");
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
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || process.env.MONGODB_DB_NAME || 'ecommerce';
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
// Initialize monitoring module.
// Sidecar pattern: runs in the background after Mongo is reachable.
// Failures here are logged but never block server boot — the scraper
// must work even if monitoring indexes fail to create.
let executionRecorder = null;
let healthChecker = null;
let metricsAggregator = null;
let sseEmitter = null;
let monitoringRouter = null;
let metricsInterval = null;
let scraperStoppedInterval = null;
(async () => {
    try {
        const database = await getDb();
        await (0, monitoring_1.initMonitoring)({ db: database });
        executionRecorder = (0, monitoring_1.createExecutionRecorder)({ db: database });
        healthChecker = (0, monitoring_1.createHealthChecker)({ db: database });
        metricsAggregator = (0, monitoring_1.createMetricsAggregator)({ db: database });
        sseEmitter = (0, monitoring_1.createSSEEmitter)();
        // Start periodic metrics aggregation (hourly). The handle is kept so
        // a future shutdown hook can clearInterval() cleanly.
        metricsInterval = metricsAggregator.startPeriodicAggregation(60 * 60 * 1000);
        // Start periodic scraper-stopped check (every 30 min). Outside the
        // 07:00–24:00 Argentina active window the check is a no-op, so this
        // timer is safe to run 24/7.
        scraperStoppedInterval = setInterval(async () => {
            try {
                if (!healthChecker)
                    return;
                const alert = await healthChecker.checkScraperStopped();
                if (alert) {
                    console.warn('[Health] Scraper stopped alert:', alert.message);
                    if (sseEmitter) {
                        sseEmitter.broadcast('health-alert', alert);
                        console.log(`[SSE] Broadcast health-alert: scraper-stopped (${alert.severity})`);
                    }
                }
            }
            catch (e) {
                console.error('[Health] Error in stopped check:', e);
            }
        }, 30 * 60 * 1000);
        // Build the monitoring API router. The router is registered with
        // express below via a deferred mount (see "Mount monitoring API"
        // comment near `const app = express()`), because `app` is declared
        // after this IIFE. Storing the router in a module-level let lets
        // the middleware closure resolve it at request time.
        monitoringRouter = (0, api_1.createMonitoringRouter)({ db: database }, healthChecker, metricsAggregator, sseEmitter);
        console.log('[Monitoring] API router built — ready at /api/monitoring');
        console.log('[Monitoring] Initialized');
    }
    catch (e) {
        console.error('[Monitoring] Init error:', e);
    }
})();
/**
 * Fire-and-forget post-execution hooks: run anomaly detection and refresh
 * today's metrics snapshot. Never throws — wrapped individually so a
 * failure in one hook cannot starve the other.
 */
async function runPostExecutionHooks(executionId) {
    if (!executionId)
        return;
    if (healthChecker) {
        try {
            const database = await getDb();
            const execDoc = await database.collection('execution_logs').findOne({ _id: new mongodb_1.ObjectId(executionId) });
            if (execDoc) {
                // checkAfterExecution never throws, but we still wrap to be safe.
                const alerts = await healthChecker.checkAfterExecution(execDoc) || [];
                // Broadcast detected alerts via SSE in real-time
                if (alerts.length > 0 && sseEmitter) {
                    for (const alert of alerts) {
                        const payload = {
                            ...alert,
                            _id: alert._id?.toString?.() || undefined,
                            executionId,
                        };
                        sseEmitter.broadcast('health-alert', payload);
                        console.log(`[SSE] Broadcast health-alert: ${alert.checkType} (${alert.severity})`);
                    }
                }
            }
        }
        catch (e) {
            console.error('[Health] Error in post-execution checks:', e);
        }
    }
    if (metricsAggregator) {
        try {
            await metricsAggregator.aggregateToday();
        }
        catch (e) {
            console.error('[Metrics] Error aggregating after execution:', e);
        }
    }
}
// ===============================================
// SCRAPER MUTEX — evita solapamiento entre runs
// ===============================================
let scraperRunning = false;
/**
 * Marca el scraper como "en ejecución" y devuelve handle para liberar.
 * Si ya está corriendo, lanza 409.
 */
function tryAcquireScraper() {
    if (scraperRunning) {
        throw Object.assign(new Error('Scraper is already running'), { statusCode: 409 });
    }
    scraperRunning = true;
    console.log('[Mutex] Lock acquired');
    return () => { scraperRunning = false; console.log('[Mutex] Lock released'); };
}
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
app.use(express_1.default.json());
// Serve monitoring dashboard static files
app.use('/dashboard', express_1.default.static('public/dashboard'));
// Redirect root to the dashboard
app.get('/', (_req, res) => res.redirect('/dashboard'));
// Mount monitoring API via deferred middleware. The router is built
// inside the IIFE above (which runs in the background after Mongo is
// reachable); the closure here resolves it at request time. Until the
// IIFE finishes, requests to /api/monitoring/* get a 503.
app.use('/api/monitoring', (req, res, next) => {
    if (monitoringRouter)
        return monitoringRouter(req, res, next);
    res.status(503).json({ error: 'Monitoring not ready yet' });
});
app.get('/health', async (req, res) => { res.json({ status: 'ok', timestamp: new Date().toISOString() }); });
// Debug: test MongoDB connection
app.get('/debug/mongo-test', async (req, res) => {
    try {
        const db = await getDb();
        const result = await db.command({ ping: 1 });
        res.json({ success: true, mongo: 'connected', result });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
app.post('/run', async (req, res) => {
    let release = null;
    try {
        release = tryAcquireScraper();
        const forceFullScrape = req.query.force === 'true';
        res.json({ success: true, message: 'Scrape started in background', startedAt: new Date().toISOString() });
        const { result, executionId } = await executionRecorder.recordExecution('http', () => (0, index_1.runIncrementalScraper)(forceFullScrape), {
            extractStats: (r) => ({
                productsFound: (r.scrapeResult?.created || 0) + (r.scrapeResult?.updated || 0),
                productsCreated: r.scrapeResult?.created || 0,
                productsUpdated: r.scrapeResult?.updated || 0,
                productsUnavailable: 0,
                errors: r.scrapeResult?.errors || [],
                createdProductIds: r.scrapeResult?.createdIds || [],
                updatedProductIds: r.scrapeResult?.updatedIds || [],
            }),
        });
        void runPostExecutionHooks(executionId);
        console.log(`[Scraper] Background run complete: ${result.scrapeResult?.created} created, ${result.scrapeResult?.updated} updated`);
    }
    catch (error) {
        if (!res.headersSent)
            res.status(error.statusCode || 500).json({ error: error.message });
        console.error('[Scraper] Background run failed:', error.message);
    }
    finally {
        if (release)
            release();
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
    let release = null;
    const categoryId = req.body.categoryId;
    try {
        release = tryAcquireScraper();
        const { idsubrubro1, source } = req.body;
        res.json({ success: true, message: 'Scrape started in background', categoryId, startedAt: new Date().toISOString() });
        console.log(`[Scraper] Background run for ${categoryId}...`);
        const result = await (0, index_1.runScraper)({ categoryId, idsubrubro1, source });
        console.log(`[Scraper] Background run for ${categoryId} complete: ${result.created} created, ${result.updated} updated`);
    }
    catch (error) {
        if (!res.headersSent)
            res.status(error.statusCode || 500).json({ error: error.message });
        console.error(`[Scraper] Background run for ${categoryId} failed:`, error.message);
    }
    finally {
        if (release)
            release();
    }
});
// Endpoint para testar una categoría o grupo padre (ej: "seguridad" → todas sus hijas)
app.post('/scraper/test-category', async (req, res) => {
    const release = tryAcquireScraper();
    try {
        const { categoryId } = req.body;
        if (!categoryId) {
            return res.status(400).json({ error: "categoryId es requerido" });
        }
        // Buscar la categoría
        const cat = index_1.jotakpCategories.find((c) => c.id === categoryId);
        if (!cat) {
            return res.status(404).json({ error: `Categoría "${categoryId}" no encontrada` });
        }
        // Si es padre (idsubrubro1 === 0), expandir a todas sus hijas
        let targetIds;
        if (cat.idsubrubro1 === 0) {
            targetIds = index_1.jotakpCategories
                .filter((c) => c.parentId === categoryId && c.idsubrubro1 > 0)
                .map((c) => c.id);
            console.log(`[Test] Parent category "${categoryId}" → ${targetIds.length} subcategories: ${targetIds.join(', ')}`);
        }
        else {
            targetIds = [categoryId];
        }
        // Importar runScraper
        const { runScraper } = await Promise.resolve().then(() => __importStar(require('./src/lib/scraper/scraper.service')));
        // Correr en batches de 4 (como el incremental) y agregar resultados
        const aggregated = { created: 0, updated: 0, createdIds: [], updatedIds: [], errors: [], durationMs: 0 };
        const startTime = Date.now();
        const MAX_PARALLEL = 4;
        for (let i = 0; i < targetIds.length; i += MAX_PARALLEL) {
            const batch = targetIds.slice(i, i + MAX_PARALLEL);
            console.log(`[Test] Batch ${Math.floor(i / MAX_PARALLEL) + 1}: ${batch.join(', ')}`);
            const batchResults = await Promise.all(batch.map(async (id) => {
                try {
                    const result = await runScraper({ categoryId: id, source: 'test' });
                    return result;
                }
                catch (e) {
                    return { created: 0, updated: 0, createdIds: [], updatedIds: [], errors: [`Error scraping ${id}: ${e.message}`], success: false };
                }
            }));
            for (const r of batchResults) {
                aggregated.created += r.created || 0;
                aggregated.updated += r.updated || 0;
                if (r.createdIds)
                    aggregated.createdIds.push(...r.createdIds);
                if (r.updatedIds)
                    aggregated.updatedIds.push(...r.updatedIds);
                if (r.errors)
                    aggregated.errors.push(...r.errors);
            }
        }
        aggregated.durationMs = Date.now() - startTime;
        return res.json({
            success: aggregated.errors.length === 0,
            categories: targetIds.length,
            ...aggregated,
            timestamp: new Date(),
        });
    }
    catch (error) {
        console.error("[Test] Error:", error.message);
        res.status(500).json({ success: false, error: String(error) });
    }
    finally {
        release();
    }
});
app.post('/scraper/incremental', async (req, res) => {
    let release = null;
    try {
        release = tryAcquireScraper();
        const { forceFullScrape } = req.body;
        res.json({ success: true, message: 'Incremental scrape started in background', startedAt: new Date().toISOString() });
        const { result, executionId } = await executionRecorder.recordExecution('http', () => (0, index_1.runIncrementalScraper)(forceFullScrape), {
            extractStats: (r) => ({
                productsFound: (r.scrapeResult?.created || 0) + (r.scrapeResult?.updated || 0),
                productsCreated: r.scrapeResult?.created || 0,
                productsUpdated: r.scrapeResult?.updated || 0,
                productsUnavailable: 0,
                errors: r.scrapeResult?.errors || [],
                createdProductIds: r.scrapeResult?.createdIds || [],
                updatedProductIds: r.scrapeResult?.updatedIds || [],
            }),
        });
        void runPostExecutionHooks(executionId);
        console.log(`[Incremental] Background run complete: ${result.scrapeResult?.created} created, ${result.scrapeResult?.updated} updated`);
    }
    catch (error) {
        if (!res.headersSent)
            res.status(error.statusCode || 500).json({ error: error.message });
        console.error('[Incremental] Background run failed:', error.message);
    }
    finally {
        if (release)
            release();
    }
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
});
