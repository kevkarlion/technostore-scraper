require('dotenv').config();
const express = require('express');
const { chromium } = require('playwright');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME || 'technostore';

let db;
let client;

async function connectDB() {
  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log('[DB] Connected to MongoDB');
  
  // Ensure indexes
  try {
    await db.collection('scraperStates').createIndex({ categoryId: 1 }, { unique: true });
    await db.collection('products').createIndex({ externalId: 1, supplier: 1 }, { unique: true });
    console.log('[DB] Indexes created');
  } catch {}
  
  return db;
}

// ============================================
// CONFIGURACIÓN (adaptada de config.ts)
// ============================================

const SCRAPER_CONFIG = {
  baseUrl: process.env.SUPPLIER_URL || 'https://jotakp.dyndns.org',
  loginUrl: process.env.SUPPLIER_LOGIN_URL || 'https://jotakp.dyndns.org/loginext.aspx',
  email: process.env.SUPPLIER_EMAIL || '20418216795',
  password: process.env.SUPPLIER_PASSWORD || '123456',
  selectors: {
    login: {
      emailInputSelector: '#ContentPlaceHolder1_txtUsuario, #txtUsuario',
      passwordInputSelector: '#ContentPlaceHolder1_txtClave, #txtClave',
      submitButtonSelector: '#ContentPlaceHolder1_btnIngresar, #btnIngresar'
    }
  }
};

// Todas las categorías (de config.ts)
const JOTAKP_CATEGORIES = [
  { id: 'almacenamiento', name: 'Almacenamiento', idsubrubro1: 0, parentId: null },
  { id: 'carry-caddy-disk', name: 'Carry-Caddy Disk', idsubrubro1: 100, parentId: 'almacenamiento' },
  { id: 'cd-dvd-bluray', name: 'CD-DVD-BluRay-Dual Layer', idsubrubro1: 13, parentId: 'almacenamiento' },
  { id: 'discos-externos', name: 'Discos Externos', idsubrubro1: 14, parentId: 'almacenamiento' },
  { id: 'discos-hdd', name: 'Discos HDD', idsubrubro1: 69, parentId: 'almacenamiento' },
  { id: 'discos-m2', name: 'Discos M.2', idsubrubro1: 157, parentId: 'almacenamiento' },
  { id: 'discos-ssd', name: 'Discos SSD', idsubrubro1: 156, parentId: 'almacenamiento' },
  { id: 'memorias-flash', name: 'Memorias Flash', idsubrubro1: 12, parentId: 'almacenamiento' },
  { id: 'pendrive', name: 'Pendrive', idsubrubro1: 5, parentId: 'almacenamiento' },
  { id: 'audio', name: 'Audio', idsubrubro1: 0, parentId: null },
  { id: 'auricular-bluetooth', name: 'Auricular Bluetooth', idsubrubro1: 149, parentId: 'audio' },
  { id: 'auricular-cableado', name: 'Auricular Cableado', idsubrubro1: 36, parentId: 'audio' },
  { id: 'conversores-adaptadores-audio', name: 'Conversores y Adaptadores', idsubrubro1: 122, parentId: 'audio' },
  { id: 'microfonos', name: 'Microfonos', idsubrubro1: 45, parentId: 'audio' },
  { id: 'parlantes', name: 'Parlantes', idsubrubro1: 35, parentId: 'audio' },
  { id: 'placas-de-sonido', name: 'Placas de Sonido', idsubrubro1: 46, parentId: 'audio' },
  { id: 'computadoras', name: 'Computadoras', idsubrubro1: 0, parentId: null },
  { id: 'notebooks', name: 'Notebooks', idsubrubro1: 56, parentId: 'computadoras' },
  { id: 'tablets', name: 'Tablets', idsubrubro1: 57, parentId: 'computadoras' },
  { id: 'pc', name: 'Pc', idsubrubro1: 60, parentId: 'computadoras' },
  { id: 'mini-pc', name: 'Mini Pc', idsubrubro1: 59, parentId: 'computadoras' },
  { id: 'cargadores-computadoras', name: 'Cargadores', idsubrubro1: 63, parentId: 'computadoras' },
  { id: 'fundas-mochilas-bolsos', name: 'Fundas-Mochilas-Bolsos', idsubrubro1: 65, parentId: 'computadoras' },
  { id: 'conectividad', name: 'Conectividad', idsubrubro1: 0, parentId: null },
  { id: 'routers', name: 'Routers', idsubrubro1: 70, parentId: 'conectividad' },
  { id: 'switches', name: 'Switches', idsubrubro1: 74, parentId: 'conectividad' },
  { id: 'placas-de-red', name: 'Placas de Red', idsubrubro1: 75, parentId: 'conectividad' },
  { id: 'puntos-de-acceso', name: 'Puntos de Acceso', idsubrubro1: 71, parentId: 'conectividad' },
  { id: 'energia', name: 'Energia', idsubrubro1: 0, parentId: null },
  { id: 'estabilizadores', name: 'Estabilizadores', idsubrubro1: 54, parentId: 'energia' },
  { id: 'ups', name: 'Ups', idsubrubro1: 53, parentId: 'energia' },
  { id: 'cargadores-energia', name: 'Cargadores', idsubrubro1: 51, parentId: 'energia' },
];

// Solo categorías con idsubrubro1 > 0
const CATEGORIES = JOTAKP_CATEGORIES.filter(c => c.idsubrubro1 > 0).map(c => ({
  id: c.id,
  idsubrubro1: c.idsubrubro1,
  name: c.name
}));

const MAX_PARALLEL_PAGES = 2;
const MAX_DETAIL_PAGES = 3; // Máximo páginas por categoría

// ============================================
// FUNCIONES DEL SCRAPER
// ============================================

function generateContentHash(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

// Pre-check: obtener hash de primera página
async function getCategoryPreview(page, idsubrubro1, baseUrl) {
  try {
    const url = `${baseUrl}/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=1`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Wait for prices
    await page.waitForSelector("div:has-text('U$D')", { timeout: 10000 }).catch(() => {});
    
    const content = await page.content();
    const contentHash = generateContentHash(content);
    
    // Get product IDs
    const items = await page.locator('a[href*="articulo.aspx?id="]').all();
    const productIds = [];
    const seenIds = new Set();
    
    for (const item of items) {
      const href = await item.getAttribute('href');
      if (href) {
        const idMatch = href.match(/id=(\d+)/);
        if (idMatch && !seenIds.has(idMatch[1])) {
          seenIds.add(idMatch[1]);
          productIds.push(idMatch[1]);
        }
      }
    }
    
    return { contentHash, productCount: productIds.length, productIds };
  } catch (e) {
    console.error('[Pre-check] Error:', e.message);
    return null;
  }
}

// Pre-check de todas las categorías (paralelo)
async function preCheckCategories(categories, page) {
  const result = { changed: [], unchanged: [], errors: [] };
  
  console.log('[Pre-check] Checking', categories.length, 'categories...');
  
  for (let i = 0; i < categories.length; i += MAX_PARALLEL_PAGES) {
    const batch = categories.slice(i, i + MAX_PARALLEL_PAGES);
    console.log(`[Pre-check] Batch ${Math.floor(i/MAX_PARALLEL_PAGES) + 1}: ${batch.map(c => c.name).join(', ')}`);
    
    const batchPromises = batch.map(async (cat) => {
      const preview = await getCategoryPreview(page, cat.idsubrubro1, SCRAPER_CONFIG.baseUrl);
      
      if (!preview) return { categoryId: cat.id, status: 'error' };
      
      // Check if changed in DB
      const existing = await db.collection('scraperStates').findOne({ categoryId: cat.id });
      const hasChanged = !existing || existing.contentHash !== preview.contentHash;
      
      // Save snapshot
      await db.collection('scraperStates').updateOne(
        { categoryId: cat.id },
        { 
          $set: { 
            categoryId: cat.id, 
            idsubrubro1: cat.idsubrubro1, 
            contentHash: preview.contentHash,
            productCount: preview.productCount,
            productIds: preview.productIds,
            capturedAt: new Date()
          }
        },
        { upsert: true }
      );
      
      return { categoryId: cat.id, status: hasChanged ? 'changed' : 'unchanged', count: preview.productCount };
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    for (const r of batchResults) {
      if (r.status === 'changed') {
        result.changed.push(r.categoryId);
        console.log(`[Pre-check] Changed: ${r.categoryId} (${r.count} products)`);
      } else if (r.status === 'unchanged') {
        result.unchanged.push(r.categoryId);
      } else {
        result.errors.push(r.categoryId);
      }
    }
  }
  
  console.log('[Pre-check] Complete:', result.changed.length, 'changed,', result.unchanged.length, 'unchanged,', result.errors.length, 'errors');
  return result;
}

// Scrapear productos de una categoría (detalle)
async function scrapeCategory(page, categoryId, idsubrubro1) {
  console.log(`[Scraper] Scraping: ${categoryId}`);
  
  const products = [];
  const scrapedIds = [];
  
  for (let pageNum = 1; pageNum <= MAX_DETAIL_PAGES; pageNum++) {
    const url = `${SCRAPER_CONFIG.baseUrl}/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=${pageNum}`;
    
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForSelector('a[href*="articulo.aspx?id="]', { timeout: 5000 }).catch(() => {});
      
      const items = await page.locator('a[href*="articulo.aspx?id="]').all();
      
      if (items.length === 0) break;
      
      console.log(`[Scraper] Page ${pageNum}: ${items.length} products`);
      
      // Scrapear cada producto (paralelo en batches de 2)
      for (let i = 0; i < items.length; i += 2) {
        const batch = items.slice(i, i + 2);
        
        const batchPromises = batch.map(async (item) => {
          try {
            const href = await item.getAttribute('href');
            const fullText = await item.textContent();
            
            const idMatch = href.match(/id=(\d+)/);
            const externalId = idMatch ? idMatch[1] : null;
            if (!externalId) return null;
            
            // Get price from text
            let price = null;
            const priceMatch = fullText.match(/U\$D\s+([\d.,]+)/);
            if (priceMatch) price = parseFloat(priceMatch[1].replace(',', '.'));
            
            // Get name
            let name = fullText.replace(/U\$D[\s\d.,+IVA%]+$/, '').trim();
            if (!name || name.length < 3) return null;
            
            // Navigate to detail
            const detailUrl = `${SCRAPER_CONFIG.baseUrl}/articulo.aspx?id=${externalId}`;
            await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 30000 });
            
            // Get details
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
                const m = stockText.match(/(\d+)/);
                stock = m ? parseInt(m[1]) : 0;
              }
            } catch {}
            
            let sku = '';
            try {
              const skuEl = await page.$('#ContentPlaceHolder1_lblCodigo');
              if (skuEl) sku = await skuEl.textContent() || '';
            } catch {}
            
            const images = [];
            try {
              const imgs = await page.locator('div.tg-img-overlay.artImg').all();
              for (const img of imgs.slice(0, 5)) {
                const src = await img.getAttribute('data-src');
                if (src && src.includes('imagenes/')) images.push(src);
              }
            } catch {}
            
            // Back to list
            await page.goBack();
            await page.waitForLoadState('networkidle').catch(() => {});
            
            return { externalId, name, price, stock, description, sku, imageUrls: images };
          } catch (e) {
            console.log(`[Scraper] Error product:`, e.message);
            try { await page.goBack(); } catch {}
            return null;
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        for (const p of batchResults) {
          if (p) {
            products.push(p);
            scrapedIds.push(p.externalId);
          }
        }
      }
      
    } catch (e) {
      console.log(`[Scraper] Error page ${pageNum}:`, e.message);
    }
  }
  
  return { products, scrapedIds };
}

// Guardar producto (atomic upsert)
async function saveProduct(product, categoryId) {
  const collection = db.collection('products');
  
  const existing = await collection.findOne({ externalId: product.externalId, supplier: 'jotakp' });
  
  const update = {
    lastSyncedAt: new Date(),
    categories: [categoryId]
  };
  
  if (product.name) update.name = product.name;
  if (product.price !== null) update.price = product.price;
  if (product.stock !== undefined) update.stock = product.stock;
  if (product.description) update.description = product.description;
  if (product.sku) update.sku = product.sku;
  if (product.imageUrls && product.imageUrls.length > 0) update.imageUrls = product.imageUrls;
  
  if (existing) {
    // Check what changed
    const changed = {};
    for (const [key, value] of Object.entries(update)) {
      if (key !== 'lastSyncedAt' && key !== 'categories') {
        if (JSON.stringify(existing[key]) !== JSON.stringify(value)) {
          changed[key] = value;
        }
      }
    }
    
    if (Object.keys(changed).length > 0) {
      await collection.updateOne({ _id: existing._id }, { $set: { ...changed, lastSyncedAt: new Date() } });
      return { created: false, updated: true };
    }
    return { created: false, updated: false };
  } else {
    // Create new
    await collection.insertOne({
      ...update,
      externalId: product.externalId,
      supplier: 'jotakp',
      status: 'active',
      currency: 'USD',
      attributes: [],
      createdAt: new Date(),
      updatedAt: new Date()
    });
    return { created: true, updated: false };
  }
}

// Marcar descontinuados
async function markDiscontinued(categoryId, scrapedIds) {
  const collection = db.collection('products');
  
  const result = await collection.updateMany(
    { 
      categories: categoryId,
      supplier: 'jotakp',
      externalId: { $nin: scrapedIds }
    },
    { 
      $set: { status: 'discontinued', discontinuedAt: new Date() }
    }
  );
  
  return result.modifiedCount;
}

// ============================================
// RUNNER PRINCIPAL
// ============================================

async function runIncrementalScraper() {
  console.log('[Incremental] Starting...');
  
  const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
  
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumPath,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const results = {
    created: 0,
    updated: 0,
    unchanged: 0,
    discontinued: 0,
    errors: []
  };
  
  try {
    // Login
    console.log('[Incremental] Login...');
    console.log('[Incremental] Login URL:', SCRAPER_CONFIG.loginUrl);
    const context = await browser.newContext();
    const page = await context.newPage();
    
    await page.goto(SCRAPER_CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000); // Espera inicial para que cargue
    
    console.log('[Incremental] Page loaded, trying to find inputs...');
    
    // Try multiple selectors for email
    const emailSelectors = [
      '#ContentPlaceHolder1_txtUsuario',
      '#txtUsuario', 
      'input[name*="Usuario"]',
      'input[id*="Usuario"]',
      'input[type="text"]'
    ];
    
    let emailInput = null;
    for (const sel of emailSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          emailInput = el;
          console.log('[Incremental] Found email input:', sel);
          break;
        }
      } catch {}
    }
    
    if (!emailInput) {
      // Get page html for debug
      const html = await page.content();
      console.log('[Incremental] Page HTML (first 500 chars):', html.substring(0, 500));
      throw new Error('Could not find email input');
    }
    
    // Get password input
    const passSelectors = ['#ContentPlaceHolder1_txtClave', '#txtClave', 'input[name*="Clave"]', 'input[type="password"]'];
    let passInput = null;
    for (const sel of passSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          passInput = el;
          console.log('[Incremental] Found password input:', sel);
          break;
        }
      } catch {}
    }
    
    if (!passInput) {
      throw new Error('Could not find password input');
    }
    
    // Fill and submit
    await emailInput.fill(SCRAPER_CONFIG.email);
    await passInput.fill(SCRAPER_CONFIG.password);
    
    // Try to find submit button
    const submitSelectors = ['#ContentPlaceHolder1_btnIngresar', '#btnIngresar', 'input[type="submit"]', 'button[type="submit"]'];
    let submitBtn = null;
    for (const sel of submitSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          submitBtn = el;
          console.log('[Incremental] Found submit button:', sel);
          break;
        }
      } catch {}
    }
    
    if (submitBtn) {
      await submitBtn.click();
    } else {
      // Press Enter as fallback
      await page.keyboard.press('Enter');
    }
    
    await page.waitForLoadState('networkidle');
    console.log('[Incremental] Logged in (hopefully)');
    
    // Select branch
    await page.waitForTimeout(2000);
    try {
      const branchSelect = await page.$('#ContentPlaceHolder1_ddlSucursal, #ddlSucursal');
      if (branchSelect) {
        await branchSelect.selectOption({ index: 1 });
        await page.waitForLoadState('networkidle');
      }
    } catch {}
    
    console.log('[Incremental] Logged in');
    
    // Pre-check de todas las categorías
    const preCheckResult = await preCheckCategories(CATEGORIES, page);
    
    console.log('[Incremental] Pre-check result:', preCheckResult.changed.length, 'changed');
    
    // Si no hay cambios, terminar
    if (preCheckResult.changed.length === 0) {
      return { success: true, preCheck: preCheckResult, message: 'No changes detected' };
    }
    
    // Scrapear solo las categorías que changed (en paralelo)
    console.log('[Incremental] Scraping changed categories...');
    
    const changedCats = CATEGORIES.filter(c => preCheckResult.changed.includes(c.id));
    
    for (let i = 0; i < changedCats.length; i += MAX_PARALLEL_PAGES) {
      const batch = changedCats.slice(i, i + MAX_PARALLEL_PAGES);
      console.log(`[Incremental] Scraping batch: ${batch.map(c => c.id).join(', ')}`);
      
      const batchPromises = batch.map(async (cat) => {
        try {
          return await scrapeCategory(page, cat.id, cat.idsubrubro1);
        } catch (e) {
          console.log(`[Incremental] Error ${cat.id}:`, e.message);
          return { products: [], scrapedIds: [] };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      for (const r of batchResults) {
        for (const product of r.products) {
          const catId = r.products[0] ? CATEGORIES.find(c => c.id === preCheckResult.changed.find(c => c))?.id : 'unknown';
          const result = await saveProduct(product, catId);
          if (result.created) results.created++;
          else if (result.updated) results.updated++;
          else results.unchanged++;
        }
        
        // Mark discontinued
        if (r.scrapedIds.length > 0) {
          const count = await markDiscontinued(catId, r.scrapedIds);
          results.discontinued += count;
        }
      }
    }
    
    console.log('[Incremental] Complete! Created:', results.created, 'Updated:', results.updated, 'Discontinued:', results.discontinued);
    
    return { 
      success: true, 
      preCheck: preCheckResult,
      created: results.created,
      updated: results.updated,
      unchanged: results.unchanged,
      discontinued: results.discontinued
    };
    
  } catch (error) {
    console.error('[Incremental] Error:', error);
    return { success: false, error: error.message };
  } finally {
    await browser.close();
  }
}

// ============================================
// API ENDPOINTS
// ============================================

app.post('/run', async (req, res) => {
  try {
    if (!db) await connectDB();
    
    const result = await runIncrementalScraper();
    res.json(result);
  } catch (error) {
    console.error('[API] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Status endpoint
app.get('/status', async (req, res) => {
  try {
    if (!db) await connectDB();
    
    const totalProducts = await db.collection('products').countDocuments({ supplier: 'jotakp', status: 'active' });
    const lastScrapes = await db.collection('scraperStates').find().sort({ lastScrapeAt: -1 }).limit(10).toArray();
    
    res.json({ 
      status: 'ok',
      products: totalProducts,
      lastScrapes: lastScrapes.map(s => ({ category: s.categoryId, date: s.lastScrapeAt }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`[Server] Scraping server on port ${PORT}`);
  connectDB().catch(console.error);
});