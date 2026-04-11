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

// Scraper configuration (from your config.ts)
const SCRAPER_CONFIG = {
  baseUrl: process.env.SUPPLIER_URL || 'https://jotakp.dyndns.org',
  loginUrl: process.env.SUPPLIER_LOGIN_URL || 'http://jotakp.dyndns.org/loginext.aspx',
  email: process.env.SUPPLIER_EMAIL || '20418216795',
  password: process.env.SUPPLIER_PASSWORD || '123456',
  selectors: {
    login: {
      // Múltiples selectores para el usuario
      emailInputSelector: '#ContentPlaceHolder1_txtUsuario, #txtUsuario, input[name*="Usuario"], input#usuario, #username',
      passwordInputSelector: '#ContentPlaceHolder1_txtClave, #txtClave, input[name*="Clave"], input#password, #password',
      submitButtonSelector: '#ContentPlaceHolder1_btnIngresar, #btnIngresar, input[type="submit"], button[type="submit"]'
    }
  }
};

// Categories to scrape
const CATEGORIES = [
  { id: 'pendrive', idsubrubro1: 5 },
  { id: 'discos-ssd', idsubrubro1: 156 },
  { id: 'discos-m2', idsubrubro1: 157 },
  { id: 'discos-hdd', idsubrubro1: 69 },
  { id: 'discos-externos', idsubrubro1: 14 },
  { id: 'memorias-flash', idsubrubro1: 12 },
  // Add more as needed
];

function generateContentHash(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

async function runScraper() {
  console.log('[Scraper] Starting...');
  
  // Usar chromium del sistema (en Railway con Dockerfile está en /usr/bin/chromium)
  const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
  
  const browser = await chromium.launch({ 
    headless: true,
    executablePath: chromiumPath,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    // Login
    console.log('[Scraper] Logging in...');
    const context = await browser.newContext();
    const page = await context.newPage();
    
    await page.goto(SCRAPER_CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Wait a bit for page to fully load
    await page.waitForTimeout(2000);
    
    // Debug: print page title
    const title = await page.title();
    console.log('[Scraper] Page title:', title);
    
    // Try different selectors for login
    const emailInput = await page.locator('input[name*="Usuario"], input#txtUsuario, #ContentPlaceHolder1_txtUsuario, input[type="text"]').first();
    const passwordInput = await page.locator('input[name*="Clave"], input#txtClave, #ContentPlaceHolder1_txtClave, input[type="password"]').first();
    const submitBtn = await page.locator('input[type="submit"], button[type="submit"], #btnIngresar, #ContentPlaceHolder1_btnIngresar').first();
    
    console.log('[Scraper] Found form elements, filling...');
    
    await emailInput.fill(SCRAPER_CONFIG.email);
    await passwordInput.fill(SCRAPER_CONFIG.password);
    await submitBtn.click();
    
    await page.waitForLoadState('networkidle');
    
    // Select branch
    await page.waitForTimeout(2000);
    try {
      const branchSelect = await page.$('#ContentPlaceHolder1_ddlSucursal, #ddlSucursal');
      if (branchSelect) {
        await branchSelect.selectOption({ index: 1 });
        await page.waitForLoadState('networkidle');
      }
    } catch {}
    
    // Pre-check: get first page of each category and compare hash
    console.log('[Scraper] Pre-checking categories...');
    
    const results = {
      changed: [],
      unchanged: [],
      errors: []
    };
    
    for (const cat of CATEGORIES) {
      try {
        const url = `${SCRAPER_CONFIG.baseUrl}/buscar.aspx?idsubrubro1=${cat.idsubrubro1}&pag=1`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForSelector("div:has-text('U$D')", { timeout: 10000 }).catch(() => {});
        
        const content = await page.content();
        const hash = generateContentHash(content);
        
        // Check if changed (simplified - compare with DB)
        const existingState = await db.collection('scraperStates').findOne({ categoryId: cat.id });
        
        if (!existingState || existingState.contentHash !== hash) {
          results.changed.push(cat.id);
          console.log(`[Scraper] Changed: ${cat.id}`);
          
          // Save new state
          await db.collection('scraperStates').updateOne(
            { categoryId: cat.id },
            { $set: { categoryId: cat.id, idsubrubro1: cat.idsubrubro1, contentHash: hash, lastScrapeAt: new Date() } },
            { upsert: true }
          );
        } else {
          results.unchanged.push(cat.id);
          console.log(`[Scraper] Unchanged: ${cat.id}`);
        }
      } catch (e) {
        results.errors.push(cat.id);
        console.log(`[Scraper] Error: ${cat.id}`, e.message);
      }
    }
    
    console.log('[Scraper] Pre-check complete:', results);
    return { success: true, preCheck: results };
    
  } catch (error) {
    console.error('[Scraper] Error:', error);
    return { success: false, error: error.message };
  } finally {
    await browser.close();
  }
}

// API endpoint to trigger scraper
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`[Server] Scraper server running on port ${PORT}`);
  connectDB().catch(console.error);
});