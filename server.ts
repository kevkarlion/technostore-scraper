import 'dotenv/config';
import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import cron from 'node-cron';

// ===============================================
// TIMEZONE HELPERS - Argentina (UTC-3)
// ===============================================
const TIMEZONE = 'America/Argentina/Buenos_Aires';

function toArgentinaTime(date: Date | string): string {
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

function formatArgentinaDate(date: Date | string): string {
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
import { runScraper, runIncrementalScraper, jotakpCategories } from './src/lib/scraper/index';
import { initMonitoring, createExecutionRecorder, createHealthChecker, createMetricsAggregator, createSSEEmitter } from './src/lib/monitoring';
import { createMonitoringRouter } from './src/lib/monitoring/api';

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
let mongoClient: MongoClient | null = null;
let db: any = null;

async function getDb() {
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGO_URI, {
      maxPoolSize: 5,         // Reducido para M0 (500 conexiones máximo)
      minPoolSize: 0,        // No mantener conexiones ociosas
      maxIdleTimeMS: 10000,  // Cerrar inactivas después de 10s
      waitQueueTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000,
    });
    await mongoClient.connect();
    console.log('[Mongo] Connected with pool (max: 5, min: 0)');
  }
  if (!db) {
    db = mongoClient.db(DB_NAME);
    (global as any).db = db;
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
let executionRecorder: any = null;
let healthChecker: any = null;
let metricsAggregator: any = null;
let sseEmitter: any = null;
let monitoringRouter: any = null;
let metricsInterval: NodeJS.Timeout | null = null;
let scraperStoppedInterval: NodeJS.Timeout | null = null;
(async () => {
  try {
    const database = await getDb();
    await initMonitoring({ db: database });
    executionRecorder = createExecutionRecorder({ db: database });
    healthChecker = createHealthChecker({ db: database });
    metricsAggregator = createMetricsAggregator({ db: database });
    sseEmitter = createSSEEmitter();

    // Start periodic metrics aggregation (hourly). The handle is kept so
    // a future shutdown hook can clearInterval() cleanly.
    metricsInterval = metricsAggregator.startPeriodicAggregation(60 * 60 * 1000);

    // Start periodic scraper-stopped check (every 30 min). Outside the
    // 07:00–24:00 Argentina active window the check is a no-op, so this
    // timer is safe to run 24/7.
    scraperStoppedInterval = setInterval(async () => {
      try {
        if (!healthChecker) return;
        const alert = await healthChecker.checkScraperStopped();
        if (alert) {
          console.warn('[Health] Scraper stopped alert:', alert.message);
          if (sseEmitter) {
            sseEmitter.broadcast('health-alert', alert);
            console.log(`[SSE] Broadcast health-alert: scraper-stopped (${alert.severity})`);
          }
        }
      } catch (e) {
        console.error('[Health] Error in stopped check:', e);
      }
    }, 30 * 60 * 1000);

    // Build the monitoring API router. The router is registered with
    // express below via a deferred mount (see "Mount monitoring API"
    // comment near `const app = express()`), because `app` is declared
    // after this IIFE. Storing the router in a module-level let lets
    // the middleware closure resolve it at request time.
    monitoringRouter = createMonitoringRouter(
      { db: database },
      healthChecker,
      metricsAggregator,
      sseEmitter
    );
    console.log('[Monitoring] API router built — ready at /api/monitoring');

    console.log('[Monitoring] Initialized');
  } catch (e) {
    console.error('[Monitoring] Init error:', e);
  }
})();

/**
 * Fire-and-forget post-execution hooks: run anomaly detection and refresh
 * today's metrics snapshot. Never throws — wrapped individually so a
 * failure in one hook cannot starve the other.
 */
async function runPostExecutionHooks(executionId: string | null): Promise<void> {
  if (!executionId) return;

  if (healthChecker) {
    try {
      const database = await getDb();
      const execDoc = await database.collection('execution_logs').findOne({ _id: new ObjectId(executionId) });
      if (execDoc) {
        // checkAfterExecution never throws, but we still wrap to be safe.
        const alerts: any[] = await healthChecker.checkAfterExecution(execDoc) || [];

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
    } catch (e) {
      console.error('[Health] Error in post-execution checks:', e);
    }
  }

  if (metricsAggregator) {
    try {
      await metricsAggregator.aggregateToday();
    } catch (e) {
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
 * Si ya está corriendo, lanza 409 (HTTP) o skipea (cron).
 */
function tryAcquireScraper(source: 'http' | 'cron'): (() => void) | null {
  if (scraperRunning) {
    if (source === 'http') throw Object.assign(new Error('Scraper is already running'), { statusCode: 409 });
    console.log('[Mutex] Scraper already running — skipping cron tick');
    return null; // cron: skip
  }
  scraperRunning = true;
  console.log('[Mutex] Lock acquired');
  return () => { scraperRunning = false; console.log('[Mutex] Lock released'); };
}

const app = express();
const PORT = process.env.PORT || 3001;
app.use(express.json());

// Serve monitoring dashboard static files
app.use('/dashboard', express.static('public/dashboard'));
// Redirect root to the dashboard
app.get('/', (_req, res) => res.redirect('/dashboard'));

// Mount monitoring API via deferred middleware. The router is built
// inside the IIFE above (which runs in the background after Mongo is
// reachable); the closure here resolves it at request time. Until the
// IIFE finishes, requests to /api/monitoring/* get a 503.
app.use('/api/monitoring', (req, res, next) => {
  if (monitoringRouter) return monitoringRouter(req, res, next);
  res.status(503).json({ error: 'Monitoring not ready yet' });
});

app.get('/health', async (req, res) => { res.json({ status: 'ok', timestamp: new Date().toISOString() }); });

// Debug: test MongoDB connection
app.get('/debug/mongo-test', async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.command({ ping: 1 });
    res.json({ success: true, mongo: 'connected', result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});
app.post('/run', async (req, res) => {
  let release: (() => void) | null = null;
  try {
    release = tryAcquireScraper('http');
    if (!release) { res.status(409).json({ error: 'Scraper is already running' }); return; }
    const forceFullScrape = req.query.force === 'true';
    res.json({ success: true, message: 'Scrape started in background', startedAt: new Date().toISOString() });
    const { result, executionId } = await executionRecorder.recordExecution(
      'http',
      () => runIncrementalScraper(forceFullScrape),
      {
        extractStats: (r: any) => ({
          productsFound: (r.scrapeResult?.created || 0) + (r.scrapeResult?.updated || 0),
          productsCreated: r.scrapeResult?.created || 0,
          productsUpdated: r.scrapeResult?.updated || 0,
          productsUnavailable: 0,
          errors: r.scrapeResult?.errors || [],
        }),
      }
    );
    void runPostExecutionHooks(executionId);
    console.log(`[Scraper] Background run complete: ${result.scrapeResult?.created} created, ${result.scrapeResult?.updated} updated`);
  } catch (error: any) {
    if (!res.headersSent) res.status(error.statusCode || 500).json({ error: error.message });
    console.error('[Scraper] Background run failed:', error.message);
  } finally {
    if (release) release();
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
      lastScrapes: lastScrapes.map((s: any) => ({ 
        category: s.categoryId, 
        date: formatArgentinaDate(s.capturedAt)
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// NEW: Full scraper endpoints (from TechnoStore)
app.get('/scraper/categories', (req, res) => {
  // List available categories
  const categories = jotakpCategories.map(c => ({ id: c.id, name: c.name, idsubrubro1: c.idsubrubro1, parentId: c.parentId }));
  res.json({ categories });
});

app.post('/scraper/run', async (req, res) => {
  let release: (() => void) | null = null;
  const categoryId = req.body.categoryId;
  try {
    release = tryAcquireScraper('http');
    if (!release) { res.status(409).json({ error: 'Scraper is already running' }); return; }
    const { idsubrubro1, source } = req.body;
    res.json({ success: true, message: 'Scrape started in background', categoryId, startedAt: new Date().toISOString() });
    console.log(`[Scraper] Background run for ${categoryId}...`);
    const result = await runScraper({ categoryId, idsubrubro1, source });
    console.log(`[Scraper] Background run for ${categoryId} complete: ${result.created} created, ${result.updated} updated`);
  } catch (error: any) {
    if (!res.headersSent) res.status(error.statusCode || 500).json({ error: error.message });
    console.error(`[Scraper] Background run for ${categoryId} failed:`, error.message);
  } finally {
    if (release) release();
  }
});

// Endpoint para testar UNA sola categoría
app.post('/scraper/test-category', async (req, res) => {
  const release = tryAcquireScraper('http');
  if (!release) return;
  try {
    const { categoryId } = req.body;
    if (!categoryId) {
      return res.status(400).json({ error: "categoryId es requerido" });
    }
    console.log(`[Test] Scraping category: ${categoryId}`);
    
    // Importar y ejecutar runScraper directamente para una categoría
    const { runScraper } = await import('./src/lib/scraper/scraper.service');
    const result = await runScraper({ categoryId, source: 'test' });
    return res.json(result);
  } catch (error) {
    console.error("[Test] Error:", error.message);
    res.status(500).json({ success: false, error: String(error) });
  } finally {
    release();
  }
});

app.post('/scraper/incremental', async (req, res) => {
  let release: (() => void) | null = null;
  try {
    release = tryAcquireScraper('http');
    if (!release) { res.status(409).json({ error: 'Scraper is already running' }); return; }
    const { forceFullScrape } = req.body;
    res.json({ success: true, message: 'Incremental scrape started in background', startedAt: new Date().toISOString() });
    const { result, executionId } = await executionRecorder.recordExecution(
      'http',
      () => runIncrementalScraper(forceFullScrape),
      {
        extractStats: (r: any) => ({
          productsFound: (r.scrapeResult?.created || 0) + (r.scrapeResult?.updated || 0),
          productsCreated: r.scrapeResult?.created || 0,
          productsUpdated: r.scrapeResult?.updated || 0,
          productsUnavailable: 0,
          errors: r.scrapeResult?.errors || [],
        }),
      }
    );
    void runPostExecutionHooks(executionId);
    console.log(`[Incremental] Background run complete: ${result.scrapeResult?.created} created, ${result.scrapeResult?.updated} updated`);
  } catch (error: any) {
    if (!res.headersSent) res.status(error.statusCode || 500).json({ error: error.message });
    console.error('[Incremental] Background run failed:', error.message);
  } finally {
    if (release) release();
  }
});

// Debug endpoint to fix discontinued products
app.post('/debug/fix-discontinued', async (req, res) => {
  try {
    const { category } = req.body;
    const db = await getDb();
    const result = await db.collection('products').updateMany(
      { categories: category, status: 'discontinued' },
      { $set: { status: 'active' }, $unset: { discontinuedAt: '' } }
    );
    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (error) {
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
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.listen(PORT, () => { 
  console.log('[Server] Scraper server on port', PORT);
  
  // ===============================================
  // SCHEDULER - Argentina timezone (UTC-3)
  // ===============================================
  // Weekdays (Mon-Fri): every 4h from 7am to 19pm
  // Saturday: every 4h from 7am to 15pm
  // Sunday: no scrape
  const TIMEZONE = 'America/Argentina/Buenos_Aires';

  const schedules = [
    { cron: '0 7,11,15,19 * * 1-5', label: 'weekdays (7-19h every 4h)' },
    { cron: '0 7,11,15 * * 6', label: 'saturday (7-15h every 4h)' },
  ];

  for (const { cron: expr, label } of schedules) {
    if (!cron.validate(expr)) {
      console.error(`[Cron] Invalid schedule for ${label}: ${expr}`);
      continue;
    }
    cron.schedule(expr, async () => {
      const release = tryAcquireScraper('cron');
      if (!release) return;
      console.log(`[Cron] Running scheduled incremental scrape (${label})...`);
      const startTime = Date.now();
      try {
        const { result, executionId } = await executionRecorder.recordExecution(
          'cron',
          () => runIncrementalScraper(false),
          {
            extractStats: (r: any) => ({
              productsFound: (r.scrapeResult?.created || 0) + (r.scrapeResult?.updated || 0),
              productsCreated: r.scrapeResult?.created || 0,
              productsUpdated: r.scrapeResult?.updated || 0,
              productsUnavailable: 0,
              errors: r.scrapeResult?.errors || [],
            }),
          }
        );
        void runPostExecutionHooks(executionId);
        const duration = Math.round((Date.now() - startTime) / 1000);
        console.log(`[Cron] Completed in ${duration}s (${label}) - Created: ${result.scrapeResult?.created}, Updated: ${result.scrapeResult?.updated}`);
      } catch (error) {
        console.error('[Cron] Error:', error);
      } finally {
        release();
      }
    }, { timezone: TIMEZONE });
    console.log(`[Cron] Active: ${expr} (${label})`);
  }
});

// Endpoints para controlar el scheduler
app.get('/scheduler/status', (req, res) => {
  res.json({ 
    schedules: [
      { cron: '0 7,11,15,19 * * 1-5', label: 'weekdays (7-19h every 4h)' },
      { cron: '0 7,11,15 * * 6', label: 'saturday (7-15h every 4h)' },
    ],
    timezone: 'America/Argentina/Buenos_Aires',
    enabled: true 
  });
});
