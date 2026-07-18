import 'dotenv/config';
import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';

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

    // DISABLED: scraper-stopped check - not needed since scraper runs manually/on-demand
    // Start periodic scraper-stopped check (every 30 min). Outside the
    // 07:00–24:00 Argentina active window the check is a no-op, so this
    // timer is safe to run 24/7.
    // scraperStoppedInterval = setInterval(async () => {
    //   try {
    //     if (!healthChecker) return;
    //     const alert = await healthChecker.checkScraperStopped();
    //     if (alert) {
    //       console.warn('[Health] Scraper stopped alert:', alert.message);
    //       if (sseEmitter) {
    //         sseEmitter.broadcast('health-alert', alert);
    //         console.log(`[SSE] Broadcast health-alert: scraper-stopped (${alert.severity})`);
    //       }
    //     }
    //   } catch (e) {
    //     console.error('[Health] Error in stopped check:', e);
    //   }
    // }, 30 * 60 * 1000);

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

/**
 * Maximum time (ms) the lock can be held before auto-releasing.
 * Protects against stuck locks after OOM kills, crashes, or unhandled exceptions.
 * Set to 30 minutes — a full scrape should never exceed this.
 */
const SCRAPER_LOCK_TTL_MS = 30 * 60 * 1000;

let scraperRunning = false;
let scraperLockAcquiredAt: number | null = null;

/**
 * Marca el scraper como "en ejecución" y devuelve handle para liberar.
 * Si ya está corriendo pero el lock lleva más de TTL, lo libera automáticamente
 * (protege contra crashes que no ejecutaron el finally).
 * Si el lock es reciente, lanza 409.
 */
function tryAcquireScraper(): (() => void) {
  if (scraperRunning && scraperLockAcquiredAt) {
    const elapsed = Date.now() - scraperLockAcquiredAt;
    if (elapsed > SCRAPER_LOCK_TTL_MS) {
      console.warn(
        `[Mutex] Lock stale (${(elapsed / 60000).toFixed(1)}min old) — auto-releasing`
      );
      scraperRunning = false;
      scraperLockAcquiredAt = null;
    } else {
      throw Object.assign(new Error('Scraper is already running'), { statusCode: 409 });
    }
  }
  scraperRunning = true;
  scraperLockAcquiredAt = Date.now();
  console.log('[Mutex] Lock acquired');
  return () => {
    scraperRunning = false;
    scraperLockAcquiredAt = null;
    console.log('[Mutex] Lock released');
  };
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
    release = tryAcquireScraper();
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
          productsUnavailable: r.scrapeResult?.discontinued || 0,
          errors: r.scrapeResult?.errors || [],
          createdProductIds: r.scrapeResult?.createdIds || [],
          updatedProductIds: r.scrapeResult?.updatedIds || [],
          categoriesScraped: [...(r.preCheck?.changed || []), ...(r.preCheck?.errors || [])],
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
    release = tryAcquireScraper();
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

// Endpoint para testar una categoría o grupo padre (ej: "seguridad" → todas sus hijas)
app.post('/scraper/test-category', async (req, res) => {
  const release = tryAcquireScraper();
  try {
    const { categoryId } = req.body;
    if (!categoryId) {
      return res.status(400).json({ error: "categoryId es requerido" });
    }

    // Buscar la categoría
    const cat = jotakpCategories.find((c) => c.id === categoryId);
    if (!cat) {
      return res.status(404).json({ error: `Categoría "${categoryId}" no encontrada` });
    }

    // Si es padre (idsubrubro1 === 0), expandir a todas sus hijas
    let targetIds: string[];
    if (cat.idsubrubro1 === 0) {
      targetIds = jotakpCategories
        .filter((c) => c.parentId === categoryId && c.idsubrubro1 > 0)
        .map((c) => c.id);
      console.log(`[Test] Parent category "${categoryId}" → ${targetIds.length} subcategories: ${targetIds.join(', ')}`);
    } else {
      targetIds = [categoryId];
    }

    // Importar runScraper
    const { runScraper } = await import('./src/lib/scraper/scraper.service');

    // Correr en batches de 4 (como el incremental) y agregar resultados
    const aggregated = { created: 0, updated: 0, createdIds: [] as string[], updatedIds: [] as string[], errors: [] as string[], durationMs: 0 };
    const startTime = Date.now();
    const MAX_PARALLEL = 4;

    for (let i = 0; i < targetIds.length; i += MAX_PARALLEL) {
      const batch = targetIds.slice(i, i + MAX_PARALLEL);
      console.log(`[Test] Batch ${Math.floor(i / MAX_PARALLEL) + 1}: ${batch.join(', ')}`);

      const batchResults = await Promise.all(
        batch.map(async (id) => {
          try {
            const result = await runScraper({ categoryId: id, source: 'test' });
            return result;
          } catch (e: any) {
            return { created: 0, updated: 0, createdIds: [], updatedIds: [], errors: [`Error scraping ${id}: ${e.message}`], success: false };
          }
        }),
      );

      for (const r of batchResults) {
        aggregated.created += r.created || 0;
        aggregated.updated += r.updated || 0;
        if (r.createdIds) aggregated.createdIds.push(...r.createdIds);
        if (r.updatedIds) aggregated.updatedIds.push(...r.updatedIds);
        if (r.errors) aggregated.errors.push(...r.errors);
      }
    }

    aggregated.durationMs = Date.now() - startTime;

    return res.json({
      success: aggregated.errors.length === 0,
      categories: targetIds.length,
      ...aggregated,
      timestamp: new Date(),
    });
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
    release = tryAcquireScraper();
    const { forceFullScrape, categoryId, skipExistingCheck } = req.body;
    res.json({ success: true, message: 'Incremental scrape started in background', categoryId, startedAt: new Date().toISOString() });
    const { result, executionId } = await executionRecorder.recordExecution(
      'http',
      () => runIncrementalScraper(forceFullScrape, categoryId, skipExistingCheck),
      {
        extractStats: (r: any) => ({
          productsFound: (r.scrapeResult?.created || 0) + (r.scrapeResult?.updated || 0),
          productsCreated: r.scrapeResult?.created || 0,
          productsUpdated: r.scrapeResult?.updated || 0,
          productsUnavailable: r.scrapeResult?.discontinued || 0,
          errors: r.scrapeResult?.errors || [],
          createdProductIds: r.scrapeResult?.createdIds || [],
          updatedProductIds: r.scrapeResult?.updatedIds || [],
          categoriesScraped: [...(r.preCheck?.changed || []), ...(r.preCheck?.errors || [])],
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

// NEW: Playwright Listing scraper - detects price changes for existing products
app.post('/scraper/playwright-listing', async (req, res) => {
  let release: (() => void) | null = null;
  try {
    release = tryAcquireScraper();
    const { categoryId } = req.body;
    
    // Record execution for metrics
    const { result, executionId } = await executionRecorder.recordExecution(
      'http',
      async () => {
        const { runScraperPlaywrightListing } = await import('./src/lib/scraper/scraper-playwright-listing.service');
        return await runScraperPlaywrightListing({ categoryId, source: 'playwright-listing' });
      },
      {
        extractStats: (r: any) => ({
          productsFound: (r.created || 0) + (r.updated || 0),
          productsCreated: r.created || 0,
          productsUpdated: r.updated || 0,
          errors: r.errors || [],
          createdProductIds: r.createdIds || [],
          updatedProductIds: r.updatedIds || [],
        }),
        categoryId: categoryId || 'all',
        triggerSource: 'http',
      }
    );
    
    res.json({ success: true, message: 'Playwright Listing scrape started', executionId, categoryId, startedAt: new Date().toISOString() });
    console.log(`[Playwright Listing] Run complete: ${result.created} created, ${result.updated} updated`);
  } catch (error: any) {
    if (!res.headersSent) res.status(error.statusCode || 500).json({ error: error.message });
    console.error('[Playwright Listing] Run failed:', error.message);
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
});

// Debug: check chromium processes
app.get('/debug/processes', async (_req, res) => {
  const fs = require('fs');
  const path = require('path');
  
  try {
    const procs = fs.readdirSync('/proc').filter(p => /^\d+$/.test(p));
    const chromium: string[] = [];
    
    for (const pid of procs.slice(0, 200)) { // limit check
      try {
        const cmdline = fs.readFileSync(path.join('/proc', pid, 'cmdline'), 'utf8');
        if (cmdline.includes('chromium') || cmdline.includes('playwright') || cmdline.includes('chrome')) {
          chromium.push(`PID ${pid}: ${cmdline.replace(/\0/g, ' ').slice(0, 100)}`);
        }
      } catch (e) {}
    }
    
    res.json({ count: chromium.length, processes: chromium });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});
