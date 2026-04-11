require('dotenv').config();
const express = require('express');
const { chromium } = require('playwright');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'technostore';

let db;
let client;

async function connectDB() {
  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log('[DB] Connected to MongoDB');
  return db;
}

// Scraper configuration
const SCRAPER_CONFIG = {
  baseUrl: process.env.SUPPLIER_URL || 'https://jotakp.dyndns.org',
  loginUrl: process.env.SUPPLIER_LOGIN_URL || 'http://jotakp.dyndns.org/loginext.aspx',
  email: process.env.SUPPLIER_EMAIL || '20418216795',
  password: process.env.SUPPLIER_PASSWORD || '123456'
};

// Full categories list
const CATEGORIES = [
  { id: 'pendrive', idsubrubro1: 5 },
  { id: 'discos-ssd', idsubrubro1: 156 },
  { id: 'discos-m2', idsubrubro1: 157 },
  { id: 'discos-hdd', idsubrubro1: 69 },
  { id: 'discos-externos', idsubrubro1: 14 },
  { id: 'memorias-flash', idsubrubro1: 12 },
  { id: 'carry-caddy-disk', idsubrubro1: 100 },
  { id: 'cd-dvd-bluray', idsubrubro1: 13 },
  { id: 'auricular-bluetooth', idsubrubro1: 149 },
  { id: 'auricular-cableado', idsubrubro1: 36 },
  { id: 'parlantes', idsubrubro1: 35 },
  { id: 'microfonos', idsubrubro1: 45 },
  { id: 'notebooks', idsubrubro1: 56 },
  { id: 'tablets', idsubrubro1: 57 },
  { id: 'pc', idsubrubro1: 60 },
  { id: 'mini-pc', idsubrubro1: 59 },
  { id: 'aio', idsubrubro1: 58 },
  { id: 'soportes-computadoras', idsubrubro1: 66 },
  { id: 'cargadores-computadoras', idsubrubro1: 63 },
  { id: 'fundas-mochilas-bolsos', idsubrubro1: 65 },
  { id: 'bases-notebook', idsubrubro1: 64 },
  { id: 'placas-de-red', idsubrubro1: 75 },
  { id: 'routers', idsubrubro1: 70 },
  { id: 'switches', idsubrubro1: 74 },
  { id: 'puntos-de-acceso', idsubrubro1: 71 },
  { id: 'extensores', idsubrubro1: 73 },
  { id: 'antenas', idsubrubro1: 72 },
  { id: 'conectores', idsubrubro1: 80 },
  { id: 'rack', idsubrubro1: 78 },
  { id: 'patch-cord', idsubrubro1: 112 },
  { id: 'utp-ftp', idsubrubro1: 113 },
  { id: 'cables', idsubrubro1: 140 },
];

function generateContentHash(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

// Scrape a single category
async function scrapeCategory(page, category) {
  console.log(`[Scraper] Scraping category: ${category.id}`);
  
  const products = [];
  
  // Navigate to first page of category
  let pageNum = 1;
  let hasProducts = true;
  
  while (hasProducts) {
    const url = `${SCRAPER_CONFIG.baseUrl}/buscar.aspx?idsubrubro1=${category.idsubrubro1}&pag=${pageNum}`;
    console.log(`[Scraper] Page ${pageNum}: ${url}`);
    
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      
      // Wait for products to load
      await page.waitForSelector('a[href*="articulo.aspx?id="]', { timeout: 10000 }).catch(() => {});
      
      // Get product links
      const items = await page.locator('a[href*="articulo.aspx?id="]').all();
      
      if (items.length === 0) {
        hasProducts = false;
        break;
      }
      
      console.log(`[Scraper] Found ${items.length} products on page ${pageNum}`);
      
      // Process each product
      for (const item of items) {
        try {
          const href = await item.getAttribute('href');
          const fullText = await item.textContent();
          
          if (!href || !fullText) continue;
          
          // Extract product ID
          const idMatch = href.match(/id=(\d+)/);
          const externalId = idMatch ? idMatch[1] : null;
          if (!externalId) continue;
          
          // Extract price from text
          let price = null;
          const priceMatch = fullText.match(/U\$D\s+([\d.,]+)/);
          if (priceMatch) {
            price = parseFloat(priceMatch[1].replace(',', '.'));
          }
          
          // Extract name (remove price from text)
          let name = fullText.replace(/U\$D[\s\d.,+IVA%]+$/, '').trim();
          
          // Navigate to detail page
          const detailUrl = `${SCRAPER_CONFIG.baseUrl}/articulo.aspx?id=${externalId}`;
          await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 30000 });
          
          // Get description
          let description = '';
          try {
            const descElement = await page.$('#ContentPlaceHolder1_lblDescripcion, .product-description, [id*="Descripcion"]');
            if (descElement) {
              description = await descElement.textContent() || '';
            }
          } catch {}
          
          // Get stock
          let stock = 0;
          try {
            const stockElement = await page.$('#ContentPlaceHolder1_lblStock, .stock, [id*="Stock"]');
            if (stockElement) {
              const stockText = await stockElement.textContent() || '';
              const stockMatch = stockText.match(/(\d+)/);
              stock = stockMatch ? parseInt(stockMatch[1]) : 0;
            }
          } catch {}
          
          // Get images
          const imageUrls = [];
          try {
            const images = await page.locator('div.tg-img-overlay.artImg').all();
            for (const img of images.slice(0, 5)) { // Max 5 images
              const dataSrc = await img.getAttribute('data-src');
              if (dataSrc && dataSrc.includes('imagenes/')) {
                imageUrls.push(dataSrc);
              }
            }
          } catch {}
          
          // Get SKU
          let sku = '';
          try {
            const skuElement = await page.$('#ContentPlaceHolder1_lblCodigo, .sku, [id*="Codigo"]');
            if (skuElement) {
              sku = await skuElement.textContent() || '';
            }
          } catch {}
          
          products.push({
            externalId,
            name,
            price,
            stock,
            description,
            sku,
            imageUrls,
            category: category.id
          });
          
          console.log(`[Scraper] Scraped: ${name} - U$D ${price}`);
          
          // Go back to list
          await page.goBack();
          await page.waitForLoadState('networkidle').catch(() => {});
          
        } catch (e) {
          console.log(`[Scraper] Error scraping product:`, e.message);
          try { await page.goBack(); } catch {}
        }
      }
      
      pageNum++;
      
    } catch (e) {
      console.log(`[Scraper] Error on page ${pageNum}:`, e.message);
      hasProducts = false;
    }
  }
  
  return products;
}

// Save product to MongoDB (atomic upsert)
async function saveProduct(product) {
  const collection = db.collection('products');
  
  const existing = await collection.findOne({ externalId: product.externalId, supplier: 'jotakp' });
  
  if (existing) {
    // Update only changed fields
    const updates = {};
    if (existing.name !== product.name) updates.name = product.name;
    if (existing.price !== product.price) updates.price = product.price;
    if (existing.stock !== product.stock) updates.stock = product.stock;
    if (existing.description !== product.description) updates.description = product.description;
    if (existing.sku !== product.sku) updates.sku = product.sku;
    if (JSON.stringify(existing.imageUrls) !== JSON.stringify(product.imageUrls)) updates.imageUrls = product.imageUrls;
    
    updates.lastSyncedAt = new Date();
    
    if (Object.keys(updates).length > 0) {
      await collection.updateOne({ _id: existing._id }, { $set: updates });
      console.log(`[DB] Updated: ${product.name}`);
      return { updated: true, created: false };
    }
    console.log(`[DB] Unchanged: ${product.name}`);
    return { updated: false, created: false };
  } else {
    // Create new
    const newProduct = {
      ...product,
      supplier: 'jotakp',
      status: 'active',
      categories: [product.category],
      attributes: [],
      currency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSyncedAt: new Date()
    };
    
    await collection.insertOne(newProduct);
    console.log(`[DB] Created: ${product.name}`);
    return { updated: false, created: true };
  }
}

// Mark products not in this scrape as discontinued
async function markDiscontinued(categoryId, scrapedIds) {
  const collection = db.collection('products');
  
  await collection.updateMany(
    { 
      categories: categoryId,
      supplier: 'jotakp',
      externalId: { $nin: scrapedIds }
    },
    { 
      $set: { status: 'discontinued', discontinuedAt: new Date() }
    }
  );
  
  console.log(`[DB] Marked discontinued products in category: ${categoryId}`);
}

async function runScraper() {
  console.log('[Scraper] Starting full scraper...');
  
  const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
  
  const browser = await chromium.launch({ 
    headless: true,
    executablePath: chromiumPath,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const results = {
    preCheck: { changed: [], unchanged: [], errors: [] },
    created: 0,
    updated: 0,
    unchanged: 0,
    errors: []
  };
  
  try {
    // Login
    console.log('[Scraper] Logging in...');
    const context = await browser.newContext();
    const page = await context.newPage();
    
    await page.goto(SCRAPER_CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    const emailInput = await page.locator('input[name*="Usuario"], input#txtUsuario, #ContentPlaceHolder1_txtUsuario, input[type="text"]').first();
    const passwordInput = await page.locator('input[name*="Clave"], input#txtClave, #ContentPlaceHolder1_txtClave, input[type="password"]').first();
    const submitBtn = await page.locator('input[type="submit"], button[type="submit"], #btnIngresar').first();
    
    await emailInput.fill(SCRAPER_CONFIG.email);
    await passwordInput.fill(SCRAPER_CONFIG.password);
    await submitBtn.click();
    
    await page.waitForLoadState('networkidle');
    console.log('[Scraper] Logged in successfully');
    
    // Select branch if needed
    await page.waitForTimeout(2000);
    try {
      const branchSelect = await page.$('#ContentPlaceHolder1_ddlSucursal, #ddlSucursal');
      if (branchSelect) {
        await branchSelect.selectOption({ index: 1 });
        await page.waitForLoadState('networkidle');
      }
    } catch {}
    
    // Pre-check all categories
    console.log('[Scraper] Pre-checking categories...');
    
    for (const cat of CATEGORIES) {
      try {
        const url = `${SCRAPER_CONFIG.baseUrl}/buscar.aspx?idsubrubro1=${cat.idsubrubro1}&pag=1`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForSelector("div:has-text('U$D')", { timeout: 10000 }).catch(() => {});
        
        const content = await page.content();
        const hash = generateContentHash(content);
        
        const existingState = await db.collection('scraperStates').findOne({ categoryId: cat.id });
        
        if (!existingState || existingState.contentHash !== hash) {
          results.preCheck.changed.push(cat.id);
          console.log(`[Scraper] Changed: ${cat.id}`);
          
          await db.collection('scraperStates').updateOne(
            { categoryId: cat.id },
            { $set: { categoryId: cat.id, idsubrubro1: cat.idsubrubro1, contentHash: hash, lastScrapeAt: new Date() } },
            { upsert: true }
          );
        } else {
          results.preCheck.unchanged.push(cat.id);
          console.log(`[Scraper] Unchanged: ${cat.id}`);
        }
      } catch (e) {
        results.preCheck.errors.push(cat.id);
        console.log(`[Scraper] Error pre-check: ${cat.id}`, e.message);
      }
    }
    
    console.log('[Scraper] Pre-check complete:', results.preCheck.changed.length, 'changed');
    
    // Scrape changed categories
    for (const catId of results.preCheck.changed) {
      const category = CATEGORIES.find(c => c.id === catId);
      if (!category) continue;
      
      try {
        console.log(`[Scraper] Full scrape for: ${catId}`);
        const products = await scrapeCategory(page, category);
        
        // Save products
        const scrapedIds = [];
        for (const product of products) {
          scrapedIds.push(product.externalId);
          const result = await saveProduct(product);
          if (result.created) results.created++;
          else if (result.updated) results.updated++;
          else results.unchanged++;
        }
        
        // Mark discontinued
        await markDiscontinued(catId, scrapedIds);
        
      } catch (e) {
        results.errors.push(catId);
        console.log(`[Scraper] Error scraping ${catId}:`, e.message);
      }
    }
    
    console.log('[Scraper] Full scraper complete!');
    return { success: true, ...results };
    
  } catch (error) {
    console.error('[Scraper] Error:', error);
    return { success: false, error: error.message };
  } finally {
    await browser.close();
  }
}

// API endpoint
app.post('/run', async (req, res) => {
  try {
    if (!db) await connectDB();
    
    const result = await runScraper();
    res.json(result);
  } catch (error) {
    console.error('[API] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`[Server] Scraper server on port ${PORT}`);
  connectDB().catch(console.error);
});