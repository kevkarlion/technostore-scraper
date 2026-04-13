require('dotenv').config();
const express = require('express');
const { chromium } = require('playwright');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { v2: cloudinary } = require('cloudinary');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3001;

// ============================================
// CLOUDFINARY UPLOAD (for new products only)
// ============================================

function initCloudinary() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  
  if (cloudName && apiKey && apiSecret) {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
    });
    return true;
  }
  return false;
}

// Upload images to Cloudinary for a product
async function uploadImagesToCloudinary(imageUrls, supplier, externalId) {
  if (!imageUrls || imageUrls.length === 0) return [];
  
  const cloudinaryEnabled = initCloudinary();
  if (!cloudinaryEnabled) {
    console.log('[Cloudinary] Not configured, skipping upload');
    return imageUrls;
  }
  
  const cloudUrls = [];
  
  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    
    // Skip if already Cloudinary
    if (!imageUrl || imageUrl.includes('cloudinary')) {
      cloudUrls.push(imageUrl);
      continue;
    }
    
    // Convert relative URLs to absolute
    let fullUrl = imageUrl;
    if (imageUrl.startsWith('imagenes/') || imageUrl.startsWith('/imagenes/')) {
      fullUrl = `${SCRAPER_CONFIG.baseUrl}/${imageUrl.replace(/^\//, '')}`;
    } else if (!imageUrl.startsWith('http')) {
      fullUrl = `${SCRAPER_CONFIG.baseUrl}/${imageUrl}`;
    }
    
    try {
      const publicId = `${supplier}/${externalId}_${i}`;
      const result = await cloudinary.uploader.upload(fullUrl, {
        public_id: publicId,
        folder: `technostore/${supplier}`,
        transformation: [
          { width: 800, height: 800, crop: 'limit' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
      });
      cloudUrls.push(result.secure_url);
      console.log(`[Cloudinary] Uploaded: ${externalId} #${i}`);
    } catch (e) {
      console.error(`[Cloudinary] Failed: ${fullUrl}`, e.message);
      // Keep original URL as fallback
      cloudUrls.push(imageUrl);
    }
    
    await new Promise(r => setTimeout(r, 500)); // 500ms between images
  }
  
  // Extra delay between products to avoid overwhelming Cloudinary
  await new Promise(r => setTimeout(r, 1000));
  
  return cloudUrls;
}

// ============================================
// MONGODB CONNECTION
// ============================================
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.DB_NAME || 'ecommerce';

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
// CONFIG (extraído de config.ts)
// ============================================
function toHttps(url) {
  return url.replace(/^http:/, 'https:');
}

const SCRAPER_CONFIG = {
  baseUrl: toHttps(process.env.SUPPLIER_URL || 'https://jotakp.dyndns.org'),
  loginUrl: toHttps(process.env.SUPPLIER_LOGIN_URL || 'https://jotakp.dyndns.org/loginext.aspx'),
  email: process.env.SUPPLIER_EMAIL || '20418216795',
  password: process.env.SUPPLIER_PASSWORD || '123456',
  delayMs: parseInt(process.env.SUPPLIER_DELAY_MS || '3000'),
  selectors: {
    login: {
      emailInputSelector: '#ContentPlaceHolder1_txtUsuario, #txtUsuario',
      passwordInputSelector: '#ContentPlaceHolder1_txtClave, #txtClave',
      submitButtonSelector: '#ContentPlaceHolder1_btnIngresar, #btnIngresar'
    }
  }
};

// ============================================
// CATEGORIES (extraído de config.ts)
// ============================================
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

const CATEGORIES = JOTAKP_CATEGORIES.filter(c => c.idsubrubro1 > 0).map(c => ({
  id: c.id,
  idsubrubro1: c.idsubrubro1,
  name: c.name
}));

const MAX_PARALLEL_PAGES = 2;
const MAX_DETAIL_PAGES = 3;

// ============================================
// HELPER FUNCTIONS (del original)
// ============================================

function generateContentHash(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

async function shortDelay() {
  await new Promise(r => setTimeout(r, SCRAPER_CONFIG.delayMs || 3000));
}

// ============================================
// SCRAPER STATE REPOSITORY (adaptado del original)
// ============================================

const scraperStateRepository = {
  async ensureIndexes() {
    await db.collection('scraperStates').createIndex({ categoryId: 1 }, { unique: true });
  },
  
  async hasChanged(categoryId, contentHash) {
    const existing = await db.collection('scraperStates').findOne({ categoryId });
    return !existing || existing.contentHash !== contentHash;
  },
  
  async saveSnapshot(data) {
    await db.collection('scraperStates').updateOne(
      { categoryId: data.categoryId },
      { $set: { ...data, capturedAt: new Date() } },
      { upsert: true }
    );
  },
  
  async getAllCategoryStates() {
    return await db.collection('scraperStates').find().toArray();
  },
  
  async upsertCategoryState(data) {
    await db.collection('scraperStates').updateOne(
      { categoryId: data.categoryId },
      { $set: { ...data, lastScrapeAt: data.lastScrapeAt } },
      { upsert: true }
    );
  }
};

// ============================================
// PRODUCT REPOSITORY (adaptado del original)
// ============================================

const productRepository = {
  async ensureIndexes() {
    await db.collection('products').createIndex({ externalId: 1, supplier: 1 }, { unique: true });
  },
  
  async findByExternalId(externalId, supplier) {
    return await db.collection('products').findOne({ externalId, supplier });
  },
  
  async upsert(productData) {
    const existing = await this.findByExternalId(productData.externalId, productData.supplier);
    
    if (existing) {
      const changed = {};
      for (const [key, value] of Object.entries(productData)) {
        if (key !== 'externalId' && key !== 'supplier') {
          if (JSON.stringify(existing[key]) !== JSON.stringify(value)) {
            changed[key] = value;
          }
        }
      }
      
      if (Object.keys(changed).length > 0) {
        await db.collection('products').updateOne(
          { _id: existing._id },
          { $set: { ...changed, updatedAt: new Date() } }
        );
        return { created: false, updated: true };
      }
      return { created: false, updated: false };
    } else {
      await db.collection('products').insertOne({
        ...productData,
        status: 'active',
        currency: 'USD',
        attributes: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
      return { created: true, updated: false };
    }
  },
  
  async markDiscontinued(categoryId, scrapedIds) {
    const result = await db.collection('products').updateMany(
      { 
        categories: categoryId,
        supplier: 'jotakp',
        externalId: { $nin: scrapedIds }
      },
      { $set: { status: 'discontinued', discontinuedAt: new Date() } }
    );
    return result.modifiedCount;
  }
};

// ============================================
// CATEGORY PREVIEW (del original - exact copy)
// ============================================

async function getCategoryPreview(page, idsubrubro1, baseUrl) {
  try {
    const url = `${baseUrl}/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=1`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Wait for prices to load (dynamic content)
    await page.waitForSelector("div:has-text('U$D')", { timeout: 10000 }).catch(() => {});
    
    // Get content for hash
    const content = await page.content();
    const contentHash = generateContentHash(content);
    
    // Contar productos (links con articulo.aspx?id=)
    const items = await page.locator("a[href*='articulo.aspx?id=']").all();
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
    
    // Extraer primer precio USD para referencia
    let firstPriceUsd;
    const firstItemText = items[0] ? await items[0].textContent() : null;
    if (firstItemText) {
      const priceMatch = firstItemText.match(/U\$D\s+([\d.,]+)/);
      if (priceMatch) {
        firstPriceUsd = priceMatch[1];
      }
    }
    
    return {
      contentHash,
      productCount: productIds.length,
      productIds,
      firstPriceUsd
    };
  } catch (error) {
    console.error(`[Incremental] Error getting preview for idsubrubro1=${idsubrubro1}:`, error);
    return null;
  }
}

// ============================================
// SCRAPER PRODUCTS (del original - exact copy)
// ============================================

async function scrapeProductDetail(page, productUrl) {
  await page.goto(productUrl, { waitUntil: 'networkidle', timeout: 30000 });
  
  const product = {
    description: '',
    stock: 0,
    sku: '',
    imageUrls: []
  };
  
  // Description
  try {
    const desc = await page.$('#ContentPlaceHolder1_lblDescripcion');
    if (desc) product.description = await desc.textContent() || '';
  } catch {}
  
  // Stock
  try {
    const stockEl = await page.$('#ContentPlaceHolder1_lblStock');
    if (stockEl) {
      const stockText = await stockEl.textContent() || '';
      const m = stockText.match(/(\d+)/);
      product.stock = m ? parseInt(m[1]) : 0;
    }
  } catch {}
  
  // SKU
  try {
    const skuEl = await page.$('#ContentPlaceHolder1_lblCodigo');
    if (skuEl) product.sku = await skuEl.textContent() || '';
  } catch {}
  
// Images - get from detail page structure
  try {
    const pageContent = await page.content();
    
    // Method 1: Buscar miniaturas - pattern: imagenes/min/imagen+Números
    // Esto evita capturar el logo que tiene otro formato
    const allImgMatches = pageContent.match(/imagenes\/min\/imagen\d+\.[a-zA-Z]{3,4}/gi);
    
    if (allImgMatches && allImgMatches.length > 0) {
      const uniqueImages = [...new Set(allImgMatches)];
      
      for (const imgPath of uniqueImages.slice(0, 5)) {
        // Skip miniaturas si tenemos la imagen grande
        if (imgPath.includes('/min/') && uniqueImages.some(i => !i.includes('/min/') && i.includes(imgPath.replace('/min/', '/'))) {
          continue;
        }
        const fullUrl = `${SCRAPER_CONFIG.baseUrl}/${imgPath}`;
        if (!product.imageUrls.includes(fullUrl)) {
          product.imageUrls.push(fullUrl);
        }
      }
    }
    
    // Method 2: Buscar en src de imágenes img
    if (product.imageUrls.length === 0) {
      const imgs = await page.locator('img[src*="imagenes"]').all();
      for (const img of imgs.slice(0, 5)) {
        const src = await img.getAttribute('src');
        if (src && src.includes('imagenes')) {
          const fullUrl = src.startsWith('http') ? src : `${SCRAPER_CONFIG.baseUrl}/${src.replace(/^\//, '')}`;
          if (!product.imageUrls.includes(fullUrl)) {
            product.imageUrls.push(fullUrl);
          }
        }
      }
    }
  } catch (e) {
    console.log(`[Detail] Image error: ${e.message}`);
  }

  return product;
}

async function scrapeCategoryProducts(categoryId, idsubrubro1, baseUrl, browser, context) {
  const allProducts = [];
  
  // Loop through pages
  for (let pageNum = 1; pageNum <= MAX_DETAIL_PAGES; pageNum++) {
    const url = `${baseUrl}/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=${pageNum}`;
    
    const page = await context.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
      await shortDelay();
      
      // Check if there are products
      const content = await page.content();
      if (!content.includes('articulo.aspx?id=')) {
        await page.close();
        break;
      }
      
      const productLinks = await page.locator("a[href*='articulo.aspx?id=']").all();
      
      if (productLinks.length === 0) {
        await page.close();
        break;
      }
      
      console.log(`[Scraper] Page ${pageNum}: ${productLinks.length} products`);
      
      // Process products in PARALLEL (like original)
      for (let i = 0; i < productLinks.length; i += MAX_PARALLEL_PAGES) {
        const batch = productLinks.slice(i, i + MAX_PARALLEL_PAGES);
        
        const batchPromises = batch.map(async (link) => {
          const href = await link.getAttribute('href');
          const fullText = await link.textContent();
          
          if (!href) return null;
          
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
          
          // Create NEW PAGE for detail (like original)
          const detailPage = await context.newPage();
          
          try {
            const detailUrl = `${baseUrl}/articulo.aspx?id=${externalId}`;
            const details = await scrapeProductDetail(detailPage, detailUrl);
            
            return {
              externalId,
              name,
              price,
              ...details
            };
          } catch (e) {
            console.log(`[Scraper] Error detail ${externalId}:`, e.message);
            return null;
          } finally {
            try { await detailPage.close(); } catch {}
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        
        for (const p of batchResults) {
          if (p) allProducts.push(p);
        }
      }
    } catch (e) {
      console.log(`[Scraper] Error page ${pageNum}:`, e.message);
    } finally {
      try { await page.close(); } catch {}
    }
  }
  
  return allProducts;
}

// ============================================
// PRE-CHECK (del original - exact copy)
// ============================================

async function preCheckCategories(categories, browser, context) {
  const result = {
    changed: [],
    unchanged: [],
    errors: []
  };
  
  console.log('[Incremental] Pre-checking categories in parallel...');
  
  // Process in batches
  for (let i = 0; i < categories.length; i += MAX_PARALLEL_PAGES) {
    const batch = categories.slice(i, i + MAX_PARALLEL_PAGES);
    console.log(`[Incremental] Pre-check batch ${Math.floor(i/MAX_PARALLEL_PAGES) + 1}: ${batch.map(c => c.name).join(', ')}`);
    
    const batchPromises = batch.map(async (cat) => {
      const page = await context.newPage();
      try {
        const preview = await getCategoryPreview(page, cat.idsubrubro1, SCRAPER_CONFIG.baseUrl);
        await page.close();
        
        if (!preview) {
          return { categoryId: cat.id, status: 'error' };
        }
        
        // Compare with previous state
        const hasChanged = await scraperStateRepository.hasChanged(cat.id, preview.contentHash);
        
        // Save snapshot always
        await scraperStateRepository.saveSnapshot({
          categoryId: cat.id,
          idsubrubro1: cat.idsubrubro1,
          contentHash: preview.contentHash,
          productCount: preview.productCount,
          productIds: preview.productIds,
          firstPriceUsd: preview.firstPriceUsd,
          capturedAt: new Date()
        });
        
        return {
          categoryId: cat.id,
          status: hasChanged ? 'changed' : 'unchanged',
          count: preview.productCount
        };
      } catch (error) {
        await page.close();
        return { categoryId: cat.id, status: 'error' };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    // Process results
    for (const r of batchResults) {
      if (r.status === 'changed') {
        result.changed.push(r.categoryId);
        console.log(`[Incremental] Changed: ${r.categoryId} (count: ${r.count})`);
      } else if (r.status === 'unchanged') {
        result.unchanged.push(r.categoryId);
        console.log(`[Incremental] Unchanged: ${r.categoryId}`);
      } else {
        result.errors.push(r.categoryId);
        console.log(`[Incremental] Error: ${r.categoryId}`);
      }
    }
  }
  
  console.log(`[Incremental] Pre-check complete: ${result.changed.length} changed, ${result.unchanged.length} unchanged, ${result.errors.length} errors`);
  return result;
}

// ============================================
// MAIN RUNNER
// ============================================

async function runIncrementalScraper() {
  console.log('[Incremental] Starting incremental scraper...');
  
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
    // Login (como el original)
    console.log('[Incremental] Login...');
    const context = await browser.newContext();
    const loginPage = await context.newPage();
    
    await loginPage.goto(SCRAPER_CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await loginPage.waitForTimeout(3000); // Wait for page to fully load
    
    // Find all visible inputs (more robust)
    const allInputs = await loginPage.locator('input:not([type="hidden"]):visible').all();
    console.log('[Incremental] Found', allInputs.length, 'visible inputs');
    
    if (allInputs.length >= 2) {
      // Fill first visible input (email) and second visible input (password)
      await allInputs[0].fill(SCRAPER_CONFIG.email);
      await allInputs[1].fill(SCRAPER_CONFIG.password);
      console.log('[Incremental] Filled inputs directly');
      
      // Find submit button
      const submitBtn = await loginPage.locator('input[type="submit"], button').first();
      await submitBtn.click();
    } else {
      throw new Error('Could not find login inputs');
    }
    
    await loginPage.waitForLoadState('networkidle');
    
    // Select branch
    await loginPage.waitForTimeout(2000);
    try {
      const branchSelect = loginPage.locator('#ContentPlaceHolder1_ddlSucursal, #ddlSucursal').first();
      if (await branchSelect.count() > 0) {
        await branchSelect.selectOption({ index: 1 });
        await loginPage.waitForLoadState('networkidle');
      }
    } catch {}
    
    await loginPage.close();
    console.log('[Incremental] Logged in');
    
    // Pre-check
    const preCheckResult = await preCheckCategories(CATEGORIES, browser, context);
    console.log(`[Incremental] Pre-check result: ${preCheckResult.changed.length} changed, ${preCheckResult.unchanged.length} unchanged`);
    
    // No changes?
    if (preCheckResult.changed.length === 0) {
      return { success: true, preCheck: preCheckResult, message: 'No changes detected' };
    }
    
    // Scrape changed categories
    const changedCats = CATEGORIES.filter(c => preCheckResult.changed.includes(c.id));
    
    for (let i = 0; i < changedCats.length; i += MAX_PARALLEL_PAGES) {
      const batch = changedCats.slice(i, i + MAX_PARALLEL_PAGES);
      console.log(`[Incremental] Scraping batch: ${batch.map(c => c.id).join(', ')}`);
      
      const batchPromises = batch.map(async (cat) => {
        try {
          const products = await scrapeCategoryProducts(cat.id, cat.idsubrubro1, SCRAPER_CONFIG.baseUrl, browser, context);
          
          // Save each product
          for (const product of products) {
            // Upload images to Cloudinary for ALL products (new and updated)
            let cloudinaryUrls = product.imageUrls;
            
            // Check if already has cloudinary images
            const existingProduct = await productRepository.findByExternalId(product.externalId, 'jotakp');
            const hasCloudinary = existingProduct?.imageUrls?.some(url => url.includes('cloudinary'));
            
            if (!hasCloudinary && product.imageUrls && product.imageUrls.length > 0) {
              console.log(`[Cloudinary] Uploading images for product: ${product.externalId}`);
              cloudinaryUrls = await uploadImagesToCloudinary(product.imageUrls, 'jotakp', product.externalId);
            } else if (hasCloudinary) {
              console.log(`[Cloudinary] Already has cloudinary, skipping: ${product.externalId}`);
            }
            
            const result = await productRepository.upsert({
              ...product,
              imageUrls: cloudinaryUrls,
              externalId: product.externalId,
              supplier: 'jotakp',
              categories: [cat.id],
              lastSyncedAt: new Date()
            });
            
            if (result.created) results.created++;
            else if (result.updated) results.updated++;
            else results.unchanged++;
          }
          
          // Mark discontinued
          if (products.length > 0) {
            const scrapedIds = products.map(p => p.externalId);
            const count = await productRepository.markDiscontinued(cat.id, scrapedIds);
            results.discontinued += count;
          }
          
          // Update state
          await scraperStateRepository.upsertCategoryState({
            categoryId: cat.id,
            idsubrubro1: cat.idsubrubro1,
            contentHash: '',
            productCount: products.length,
            lastScrapeAt: new Date()
          });
          
          return { success: true, created: products.length };
        } catch (error) {
          console.error(`[Incremental] Error scraping ${cat.id}:`, error);
          return { success: false, created: 0 };
        }
      });
      
      await Promise.all(batchPromises);
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

// Endpoint: reupload images to Cloudinary
app.post('/reupload', async (req, res) => {
  if (!db) await connectDB();
  
  // Config Cloudinary
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  
  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(500).json({ error: 'Cloudinary not configured' });
  }
  
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  });
  
  // Get query params safely (express doesn't give types)
  const qLimit = req.query.limit;
  const qSupplier = req.query.supplier;
  
  const limit = qLimit ? parseInt(String(qLimit)) : 10;
const supplier = qSupplier ? String(qSupplier) : 'jotakp';
  
  // Find products without Cloudinary URL (have imageUrls but not cloudinary)
  const products = await db.collection('products')
    .find({ 
      supplier: supplier,
      imageUrls: { $exists: true, $ne: [] },
      $nor: [
        { imageUrls: { $regex: 'cloudinary' } }
      ]
    })
    .limit(limit)
    .toArray();
  
  const results = { uploaded: 0, failed: 0, products: [] };
  
  for (const product of products) {
    const cloudUrls = [];
    
    for (let i = 0; i < (product.imageUrls || []).length; i++) {
      const imageUrl = product.imageUrls[i];
      
      if (!imageUrl || imageUrl.includes('cloudinary')) {
        cloudUrls.push(imageUrl);
        continue;
      }
      
      try {
        const publicId = `${supplier}/${product.externalId}_${i}`;
        
        const result = await cloudinary.uploader.upload(imageUrl, {
          public_id: publicId,
          folder: `technostore/${supplier}`,
          transformation: [
            { width: 800, height: 800, crop: 'limit' },
            { quality: 'auto', fetch_format: 'auto' },
          ],
        });
        
        cloudUrls.push(result.secure_url);
        console.log(`[Cloudinary] Uploaded: ${product.externalId} #${i}`);
      } catch (e) {
        console.error(`[Cloudinary] Failed: ${imageUrl}`, e.message);
        cloudUrls.push(imageUrl);
      }
      
      // Rate limit - wait between images (500ms)
      await new Promise(r => setTimeout(r, 500));
    }
    
    // Wait between products (1 second) to avoid overwhelming the server
    await new Promise(r => setTimeout(r, 1000));
    
    // Update product with cloudinary URLs in BOTH fields
    await db.collection('products').updateOne(
      { _id: product._id },
      { $set: { 
        imageUrls: cloudUrls,  // This is what the frontend reads!
        cloudinaryUrls: cloudUrls, 
        lastSyncedAt: new Date() 
      } }
    );
    
    results.uploaded++;
    results.products.push({
      externalId: product.externalId,
      name: product.name?.substring(0, 40),
      images: cloudUrls.length
    });
  }
  
  res.json({
    ...results,
    message: `Procesados ${results.uploaded} productos`
  });
});

// Endpoint: scrapear una sola categoría (para testing)
app.post('/scrape-category', async (req, res) => {
  if (!db) await connectDB();
  
  const { categoryId, idsubrubro1 } = req.body;
  
  if (!categoryId || !idsubrubro1) {
    return res.status(400).json({ error: 'categoryId and idsubrubro1 required' });
  }
  
  console.log(`[Test] Scraping single category: ${categoryId}`);
  
  const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
  
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumPath,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    // Login
    const context = await browser.newContext();
    const loginPage = await context.newPage();
    
    await loginPage.goto(SCRAPER_CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await loginPage.waitForTimeout(3000);
    
    const allInputs = await loginPage.locator('input:not([type="hidden"]):visible').all();
    if (allInputs.length >= 2) {
      await allInputs[0].fill(SCRAPER_CONFIG.email);
      await allInputs[1].fill(SCRAPER_CONFIG.password);
      const submitBtn = await loginPage.locator('input[type="submit"], button').first();
      await submitBtn.click();
    }
    
    await loginPage.waitForLoadState('networkidle');
    await loginPage.waitForTimeout(2000);
    await loginPage.close();
    
    // Scrape single category
    console.log(`[Test] Scraping products for: ${categoryId}`);
    const products = await scrapeCategoryProducts(categoryId, idsubrubro1, SCRAPER_CONFIG.baseUrl, browser, context);
    
    console.log(`[Test] Found ${products.length} products`);
    
    // Upload images to Cloudinary for each product
    let uploaded = 0;
    for (const product of products) {
      if (product.imageUrls && product.imageUrls.length > 0) {
        const cloudUrls = await uploadImagesToCloudinary(product.imageUrls, 'jotakp', product.externalId);
        product.imageUrls = cloudUrls;
        uploaded++;
      }
      
      // Save to DB
      await productRepository.upsert({
        ...product,
        externalId: product.externalId,
        supplier: 'jotakp',
        categories: [categoryId],
        lastSyncedAt: new Date()
      });
    }
    
    res.json({ 
      success: true, 
      category: categoryId,
      productsFound: products.length,
      imagesUploaded: uploaded,
      sampleProducts: products.slice(0, 3).map(p => ({
        name: p.name?.substring(0, 40),
        externalId: p.externalId,
        imageUrls: p.imageUrls
      }))
    });
    
  } catch (error) {
    console.error('[Test] Error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    await browser.close();
  }
});

// Endpoint: último scrapeo
app.get('/last-run', async (req, res) => {
  if (!db) await connectDB();
  
  // Últimas categorías actualizadas
  const lastScrapes = await db.collection('scraperStates')
    .find({ lastScrapeAt: { $exists: true } })
    .sort({ lastScrapeAt: -1 })
    .limit(10)
    .toArray();
  
  // Productos nuevos/actualizados en las últimas 24h
  const recentProducts = await db.collection('products')
    .find({ 
      supplier: 'jotakp',
      lastSyncedAt: { $gte: new Date(Date.now() - 24*60*60*1000) }
    })
    .toArray();
  
  res.json({
    lastScrapes: lastScrapes.map(s => ({
      category: s.categoryId,
      products: s.productCount,
      date: s.lastScrapeAt
    })),
    recentProducts: {
      total: recentProducts.length,
      active: recentProducts.filter(p => p.status === 'active').length,
      discontinued: recentProducts.filter(p => p.status === 'discontinued').length
    }
  });
});

// Endpoint: productos actualizados recientemente
app.get('/updates', async (req, res) => {
  if (!db) await connectDB();
  
  const hours = parseInt(req.query.hours) || 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  const updates = await db.collection('products').find({
    supplier: 'jotakp',
    lastSyncedAt: { $gte: since }
  }).sort({ lastSyncedAt: -1 }).limit(50).toArray();
  
  // Agrupar por fecha
  const byDate = {};
  for (const p of updates) {
    const date = new Date(p.lastSyncedAt).toISOString().split('T')[0];
    byDate[date] = byDate[date] || [];
    byDate[date].push({
      name: p.name?.substring(0, 50),
      price: p.price,
      externalId: p.externalId,
      category: p.categories?.[0],
      status: p.status
    });
  }
  
  res.json({
    period: `últimas ${hours} horas`,
    total: updates.length,
    byDate
  });
});

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

// Endpoint: scrapear múltiples categorías (almacenamiento)
app.post('/scrape-categories', async (req, res) => {
  if (!db) await connectDB();
  
  const { categoryIds } = req.body; // Array de {categoryId, idsubrubro1}
  
  if (!categoryIds || !Array.isArray(categoryIds)) {
    return res.status(400).json({ error: 'categoryIds array required' });
  }
  
  console.log(`[Bulk] Scraping ${categoryIds.length} categorías...`);
  
  const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumPath,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const results = { categories: 0, products: 0, images: 0 };
  
  try {
    // Login
    const context = await browser.newContext();
    const loginPage = await context.newPage();
    
    await loginPage.goto(SCRAPER_CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await loginPage.waitForTimeout(3000);
    
    const allInputs = await loginPage.locator('input:not([type="hidden"]):visible').all();
    if (allInputs.length >= 2) {
      await allInputs[0].fill(SCRAPER_CONFIG.email);
      await allInputs[1].fill(SCRAPER_CONFIG.password);
      const submitBtn = await loginPage.locator('input[type="submit"], button').first();
      await submitBtn.click();
    }
    
    await loginPage.waitForLoadState('networkidle');
    await loginPage.waitForTimeout(2000);
    await loginPage.close();
    
    // Process each category
    for (const cat of categoryIds) {
      console.log(`[Bulk] Scraping: ${cat.categoryId}`);
      
      const products = await scrapeCategoryProducts(
        cat.categoryId, 
        cat.idsubrubro1, 
        SCRAPER_CONFIG.baseUrl, 
        browser, 
        context
      );
      
      // Upload images and save
      for (const product of products) {
        if (product.imageUrls && product.imageUrls.length > 0) {
          const cloudUrls = await uploadImagesToCloudinary(
            product.imageUrls, 
            'jotakp', 
            product.externalId
          );
          product.imageUrls = cloudUrls;
          results.images += cloudUrls.length;
        }
        
        await productRepository.upsert({
          ...product,
          externalId: product.externalId,
          supplier: 'jotakp',
          categories: [cat.categoryId],
          lastSyncedAt: new Date()
        });
        
        results.products++;
        
        // Delay between products
        await new Promise(r => setTimeout(r, 500));
      }
      
      results.categories++;
      console.log(`[Bulk] ${cat.categoryId}: ${products.length} products`);
    }
    
    res.json({
      success: true,
      ...results,
      message: `Procesadas ${results.categories} categorías, ${results.products} productos`
    });
  } catch (error) {
    console.error('[Bulk] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    await browser.close();
  }
});

// Endpoint: migrate cloudinaryUrls to imageUrls
app.post('/migrate-images', async (req, res) => {
  if (!db) await connectDB();
  
  const limit = parseInt(req.query.limit) || 100;
  
  // Find products that have cloudinaryUrls but empty imageUrls
  const products = await db.collection('products')
    .find({
      cloudinaryUrls: { $exists: true, $ne: [] },
      $or: [
        { imageUrls: { $exists: false } },
        { imageUrls: { $size: 0 } }
      ]
    })
    .limit(limit)
    .toArray();
  
  console.log(`[Migrate] Found ${products.length} products`);
  
  let migrated = 0;
  for (const p of products) {
    await db.collection('products').updateOne(
      { _id: p._id },
      { $set: { imageUrls: p.cloudinaryUrls } }
    );
    migrated++;
  }
  
  res.json({ migrated, message: `Migrated ${migrated} products` });
});

app.listen(PORT, () => {
  console.log(`[Server] Scraping server on port ${PORT}`);
  connectDB().catch(console.error);
});