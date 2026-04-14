import 'dotenv/config';
import express from 'express';
import { chromium } from 'playwright';
import { MongoClient } from 'mongodb';
import crypto from 'crypto';

// Import new scraper modules (use alias to avoid conflict)
import { runScraper, runIncrementalScraper as runIncrementalScraperNew, jotakpCategories } from './src/lib/scraper/index';

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
let db: any;

async function getDb() {
  if (!db) {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    // Expose globally for scraper modules
    (global as any).db = db;
  }
  return db;
}

function generateContentHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

async function getCategoryPreview(page: any, idsubrubro1: number, baseUrl: string) {
  try {
    const url = baseUrl + '/buscar.aspx?idsubrubro1=' + idsubrubro1 + '&pag=1';
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector("div:has-text('U$D')", { timeout: 10000 }).catch(() => {});
    const content = await page.content();
    const contentHash = generateContentHash(content);
    const items = await page.locator('a[href*="articulo.aspx?id="]').all();
    const productIds: string[] = [];
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
  } catch (e) {
    console.error('[Pre-check] Error:', e.message);
    return null;
  }
}

async function preCheckCategories(categories: any[], page: any) {
  const result = { changed: [], unchanged: [], errors: [] };
  console.log('[Pre-check] Checking', categories.length, 'categories...');
  for (let i = 0; i < categories.length; i += MAX_PARALLEL) {
    const batch = categories.slice(i, i + MAX_PARALLEL);
    console.log('[Pre-check] Batch', Math.floor(i / MAX_PARALLEL) + 1);
    const batchPromises = batch.map(async (cat: any) => {
      const preview = await getCategoryPreview(page, cat.idsubrubro1, SCRAPER_CONFIG.baseUrl);
      if (!preview) return { categoryId: cat.id, status: 'error' };
      const database = await getDb();
      const existing = await database.collection('scraper_state').findOne({ categoryId: cat.id });
      const hasChanged = !existing || existing.contentHash !== preview.contentHash;
      await database.collection('scraper_state').updateOne(
        { categoryId: cat.id },
        { $set: { categoryId: cat.id, idsubrubro1: cat.idsubrubro1, contentHash: preview.contentHash, productCount: preview.productCount, capturedAt: new Date() } },
        { upsert: true }
      );
      return { categoryId: cat.id, status: hasChanged ? 'changed' : 'unchanged', count: preview.productCount };
    });
    const batchResults = await Promise.all(batchPromises);
    for (const r of batchResults) {
      if (r.status === 'changed') result.changed.push(r.categoryId);
      else if (r.status === 'unchanged') result.unchanged.push(r.categoryId);
      else result.errors.push(r.categoryId);
    }
  }
  console.log('[Pre-check] Complete:', result.changed.length, 'changed');
  return result;
}

async function scrapeCategoryProducts(page: any, categoryId: string, idsubrubro1: number) {
  console.log('[Scraper] Scraping:', categoryId);
  const products: any[] = [];
  const scrapedIds: string[] = [];
  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    const url = SCRAPER_CONFIG.baseUrl + '/buscar.aspx?idsubrubro1=' + idsubrubro1 + '&pag=' + pageNum;
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForSelector('a[href*="articulo.aspx?id="]', { timeout: 5000 }).catch(() => {});
      const items = await page.locator('a[href*="articulo.aspx?id="]').all();
      if (items.length === 0) break;
      console.log('[Scraper] Page', pageNum, ':', items.length, 'products');
      for (const item of items) {
        try {
          const href = await item.getAttribute('href');
          const fullText = await item.textContent();
          const match = href.match(/id=(\d+)/);
          const externalId = match ? match[1] : null;
          if (!externalId) continue;
          let price: number | null = null;
          const priceMatch = fullText.match(/U\$D\s+([\d.,]+)/);
          if (priceMatch) price = parseFloat(priceMatch[1].replace(',', '.'));
          let name = fullText.replace(/U\$D[\s\d.,+IVA%]+$/, '').trim();
          if (!name || name.length < 3) continue;
          await page.goto(SCRAPER_CONFIG.baseUrl + '/articulo.aspx?id=' + externalId, { waitUntil: 'networkidle', timeout: 30000 });
          let description = '';
          try {
            const desc = await page.$('#ContentPlaceHolder1_lblDescripcion');
            if (desc) description = await desc.textContent() || '';
          } catch {}
          let stock = 0;
          try {
            const stockEl = await page.$('#ContentPlaceHolder1_lblStock');
            if (stockEl) {
              const stockText = await stockEl.textContent() || '';
              const stockMatch = stockText.match(/(\d+)/);
              stock = stockMatch ? parseInt(stockMatch[1]) : 0;
            }
          } catch {}
          let sku = '';
          try {
            const skuEl = await page.$('#ContentPlaceHolder1_lblCodigo');
            if (skuEl) sku = await skuEl.textContent() || '';
          } catch {}
          const imageUrls: string[] = [];
          try {
            const imgs = await page.locator('div.tg-img-overlay.artImg').all();
            for (const img of imgs.slice(0, 5)) {
              const src = await img.getAttribute('data-src');
              if (src && src.includes('imagenes/')) imageUrls.push(src);
            }
          } catch {}
          await page.goBack();
          await page.waitForLoadState('networkidle').catch(() => {});
          products.push({ externalId, name, price, stock, description, sku, imageUrls });
          scrapedIds.push(externalId);
        } catch (e) {
          console.log('[Scraper] Error product:', e.message);
          try { await page.goBack(); } catch {}
        }
      }
    } catch (e) {
      console.log('[Scraper] Error page', pageNum, ':', e.message);
    }
  }
  return { products, scrapedIds };
}

async function saveProduct(product: any, categoryId: string) {
  const database = await getDb();
  const collection = database.collection('products');
  const existing = await collection.findOne({ externalId: product.externalId, supplier: 'jotakp' });
  const update: any = { lastSyncedAt: new Date(), categories: [categoryId] };
  if (product.name) update.name = product.name;
  if (product.price !== null) update.price = product.price;
  if (product.stock !== undefined) update.stock = product.stock;
  if (product.description) update.description = product.description;
  if (product.sku) update.sku = product.sku;
  if (product.imageUrls && product.imageUrls.length > 0) update.imageUrls = product.imageUrls;
  if (existing) {
    const changed: any = {};
    for (const [key, value] of Object.entries(update)) {
      if (key !== 'lastSyncedAt' && key !== 'categories') {
        if (JSON.stringify(existing[key]) !== JSON.stringify(value)) changed[key] = value;
      }
    }
    if (Object.keys(changed).length > 0) {
      await collection.updateOne({ _id: existing._id }, { $set: { ...changed, lastSyncedAt: new Date() } });
      return { created: false, updated: true };
    }
    return { created: false, updated: false };
  } else {
    await collection.insertOne({ ...update, externalId: product.externalId, supplier: 'jotakp', status: 'active', currency: 'USD', attributes: [], createdAt: new Date(), updatedAt: new Date() });
    return { created: true, updated: false };
  }
}

async function markDiscontinued(categoryId: string, scrapedIds: string[]) {
  const database = await getDb();
  const result = await database.collection('products').updateMany(
    { categories: categoryId, supplier: 'jotakp', externalId: { $nin: scrapedIds } },
    { $set: { status: 'discontinued', discontinuedAt: new Date() } }
  );
  return result.modifiedCount;
}

async function runIncrementalScraper(forceFullScrape: boolean = false) {
  console.log('[Incremental] Starting...');
  const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
  const browser = await chromium.launch({ headless: true, executablePath: chromiumPath, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
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
    } catch {}
    console.log('[Incremental] Logged in');
    let preCheckResult;
    if (forceFullScrape) {
      preCheckResult = { changed: CATEGORIES.map(c => c.id), unchanged: [], errors: [] };
    } else {
      preCheckResult = await preCheckCategories(CATEGORIES, page);
    }
    console.log('[Incremental] Pre-check:', preCheckResult.changed.length, 'changed');
    if (preCheckResult.changed.length === 0) return { success: true, preCheck: preCheckResult };
    const changedCats = CATEGORIES.filter(c => preCheckResult.changed.includes(c.id));
    for (let i = 0; i < changedCats.length; i += MAX_PARALLEL) {
      const batch = changedCats.slice(i, i + MAX_PARALLEL);
      console.log('[Incremental] Scraping batch:', batch.map(c => c.id).join(', '));
      const batchPromises = batch.map(async (cat) => {
        try {
          return await scrapeCategoryProducts(page, cat.id, cat.idsubrubro1);
        } catch (e) {
          console.log('[Incremental] Error', cat.id, ':', e.message);
          return { products: [], scrapedIds: [] };
        }
      });
      const batchResults = await Promise.all(batchPromises);
      for (const r of batchResults) {
        for (const product of r.products) {
          const result = await saveProduct(product, r.products[0] ? changedCats.find(c => preCheckResult.changed.includes(c.id))?.id : 'unknown');
          if (result.created) results.created++;
          else if (result.updated) results.updated++;
          else results.unchanged++;
        }
        if (r.scrapedIds.length > 0) {
          const count = await markDiscontinued('unknown', r.scrapedIds);
          results.discontinued += count;
        }
      }
    }
    console.log('[Incremental] Done! Created:', results.created, 'Updated:', results.updated);
    return { success: true, preCheck: preCheckResult, scrapeResult: results };
  } catch (error) {
    console.error('[Incremental] Error:', error);
    return { success: false, error: String(error) };
  } finally {
    await browser.close();
  }
}

const app = express();
const PORT = process.env.PORT || 3001;
app.use(express.json());
app.get('/health', async (req, res) => { res.json({ status: 'ok', timestamp: new Date().toISOString() }); });
app.post('/run', async (req, res) => {
  try {
    const forceFullScrape = req.query.force === 'true';
    const result = await runIncrementalScraper(forceFullScrape);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});
app.get('/status', async (req, res) => {
  try {
    const database = await getDb();
    const totalProducts = await database.collection('products').countDocuments({ supplier: 'jotakp', status: 'active' });
    const lastScrapes = await database.collection('scraper_state').find().sort({ capturedAt: -1 }).limit(10).toArray();
    res.json({ status: 'ok', products: totalProducts, lastScrapes: lastScrapes.map((s: any) => ({ category: s.categoryId, date: s.capturedAt })) });
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
  // Run full scraper for specific category or all
  // Add retry logic for cold starts
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[Scraper] Attempt ${attempt}/3...`);
      const { categoryId, idsubrubro1, source } = req.body;
      const result = await runScraper({ categoryId, idsubrubro1, source });
      return res.json(result);
    } catch (error) {
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
      const result = await runIncrementalScraperNew(forceFullScrape);
      return res.json(result);
    } catch (error) {
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

app.listen(PORT, () => { console.log('[Server] Scraper server on port', PORT); });