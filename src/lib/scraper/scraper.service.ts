import { chromium, type Browser, type Page, type BrowserContext } from "playwright";
import { getScraperConfig, jotakpCategories } from "./config";
import { transformProducts } from "./data-transformer";
import { uploadProductImages, downloadProductImages } from "./image-downloader";
import type { ScraperConfig, ScraperResult, RawProduct, ScraperRunRequest, ScraperRun, CheckpointData } from "./types";
import { ScraperError } from "./types";
import path from "path";
import os from "os";
import crypto from "crypto";
import { MongoClient } from "mongodb";

// Get DB - try global first, then direct connection
let dbInstance: any = null;
let mongoClient: MongoClient | null = null;

async function getDb(): Promise<any> {
  // First try global (from Express server)
  if ((global as any).db) {
    return (global as any).db;
  }
  
  // Fallback to direct connection
  if (!dbInstance) {
    const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
    const DB_NAME = process.env.DB_NAME || process.env.MONGODB_DB_NAME || "ecommerce";
    
    if (!MONGO_URI) {
      throw new Error("MONGO_URI is required");
    }
    
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    dbInstance = mongoClient.db(DB_NAME);
  }
  
  return dbInstance;
}

const productRepository = {
  async upsert(product: any) {
    const db = await getDb();
    const collection = db.collection('products');
    const existing = await collection.findOne({ externalId: product.externalId, supplier: 'jotakp' });
    
    if (existing) {
      const changed: any = {};
      for (const [key, value] of Object.entries(product)) {
        if (JSON.stringify(existing[key]) !== JSON.stringify(value)) {
          changed[key] = value;
        }
      }
      if (Object.keys(changed).length > 0) {
        await collection.updateOne({ _id: existing._id }, { $set: { ...changed, lastSyncedAt: new Date() } });
        return { created: false, updated: true };
      }
      return { created: false, updated: false };
    } else {
      await collection.insertOne({ ...product, supplier: 'jotakp', status: 'active', createdAt: new Date(), updatedAt: new Date() });
      return { created: true, updated: false };
    }
  },
  
  async atomicUpsertByExternalId(product: any): Promise<{ created: boolean; updated: boolean; changes: string[] }> {
    const db = await getDb();
    const collection = db.collection('products');
    const now = new Date();
    
    const existing = await collection.findOne({ externalId: product.externalId, supplier: product.supplier || 'jotakp' });
    
    if (!existing) {
      await collection.insertOne({ ...product, supplier: product.supplier || 'jotakp', status: 'active', lastSyncedAt: now, createdAt: now, updatedAt: now });
      return { created: true, updated: false, changes: ['CREATE'] };
    }
    
    const changes: string[] = [];
    const updateOps: any = { lastSyncedAt: now, updatedAt: now };
    
    // If product was discontinued but is now found again, reactivate it
    if (existing.status === 'discontinued') {
      updateOps.status = 'active';
      updateOps.discontinuedAt = null;
      changes.push('status');
    }
    
    const fieldsToCompare = ['name', 'description', 'price', 'priceRaw', 'currency', 'stock', 'sku', 'categories', 'imageUrls'];
    
    for (const field of fieldsToCompare) {
      const existingVal = existing[field];
      const newVal = product[field];
      if (JSON.stringify(existingVal) !== JSON.stringify(newVal) && newVal !== undefined) {
        updateOps[field] = newVal;
        changes.push(field);
      }
    }
    
    if (changes.length > 0) {
      await collection.updateOne({ _id: existing._id }, { $set: updateOps });
      return { created: false, updated: true, changes };
    }
    
    return { created: false, updated: false, changes: [] };
  },
  
  async markDiscontinued(supplier: string, scrapedIds: string[]): Promise<number> {
    const db = await getDb();
    const result = await db.collection('products').updateMany(
      { supplier, externalId: { $nin: scrapedIds }, status: 'active' },
      { $set: { status: 'discontinued', discontinuedAt: new Date() } }
    );
    return result.modifiedCount;
  },
  
  async ensureIndexes() {
    const db = await getDb();
    const collection = db.collection('products');
    await collection.createIndex({ externalId: 1, supplier: 1 }, { unique: true });
    await collection.createIndex({ supplier: 1, status: 1 });
    await collection.createIndex({ categories: 1 });
  },

  // bulkUpsert - guarda TODOS los productos en 1 sola query
  async bulkUpsert(products: any[]): Promise<{ created: number; updated: number; unchanged: number }> {
    if (!products.length) return { created: 0, updated: 0, unchanged: 0 };
    
    const db = await getDb();
    const collection = db.collection('products');
    const now = new Date();
    
    // 1. Get todos los existentes en 1 query
    const externalIds = products.map(p => p.externalId);
    const existingDocs: any[] = await collection.find({ 
      externalId: { $in: externalIds }, 
      supplier: 'jotakp' 
    }).toArray();
    
    const existingMap = new Map(existingDocs.map((d: any) => [d.externalId, d]));
    const operations: any[] = [];
    let created = 0, updated = 0, unchanged = 0;
    
    // 2. Preparar operaciones
    for (const product of products) {
      const existing = existingMap.get(product.externalId);
      
      if (!existing) {
        // Insert nuevo
        operations.push({
          insertOne: {
            document: { ...product, supplier: 'jotakp', status: 'active', lastSyncedAt: now, createdAt: now, updatedAt: now }
          }
        });
        created++;
      } else {
        // Check cambios
        const changes: any = { lastSyncedAt: now };
        let hasChanges = false;
        
        const fields = ['name', 'description', 'price', 'priceRaw', 'currency', 'stock', 'sku', 'categories', 'imageUrls'];
        for (const field of fields) {
          if (product[field] !== undefined && JSON.stringify(existing[field]) !== JSON.stringify(product[field])) {
            changes[field] = product[field];
            hasChanges = true;
          }
        }
        
        if (hasChanges) {
          operations.push({
            updateOne: {
              filter: { _id: existing._id },
              update: { $set: changes }
            }
          });
          updated++;
        } else {
          unchanged++;
        }
      }
    }
    
    // 3. Ejecutar bulkWrite
    if (operations.length > 0) {
      await collection.bulkWrite(operations, { ordered: false });
    }
    
    return { created, updated, unchanged };
  }
};

const scraperRunRepository = {
  async create(run: any) {
    const db = await getDb();
    // Generate a unique runId if not provided
    const runId = run.runId || crypto.randomUUID();
    const now = new Date();
    const result = await db.collection('scraper_runs').insertOne({ 
      ...run, 
      runId,
      status: run.status || 'in_progress',
      currentCategoryIndex: run.currentCategoryIndex || 0,
      lastPageNumber: run.lastPageNumber || 1,
      lastProductId: run.lastProductId || null,
      lastProductOffset: run.lastProductOffset || 0,
      productsScraped: run.productsScraped || 0,
      productsSaved: run.productsSaved || 0,
      resumeCount: run.resumeCount || 0,
      startedAt: run.startedAt || now,
      updatedAt: now,
      createdAt: now
    });
    return { ...run, runId, _id: result.insertedId };
  },
  async update(runId: string, updates: any) {
    const db = await getDb();
    return await db.collection('scraper_runs').updateOne({ runId }, { $set: updates });
  },
  async ensureIndexes() {
    const db = await getDb();
    const collection = db.collection('scraper_runs');
    await collection.createIndex({ runId: 1 }, { unique: true });
    await collection.createIndex({ status: 1 });
    await collection.createIndex({ createdAt: -1 });
  },
  async cleanupStaleRuns(hoursOld: number): Promise<number> {
    const db = await getDb();
    const cutoff = new Date(Date.now() - hoursOld * 60 * 60 * 1000);
    const result = await db.collection('scraper_runs').updateMany(
      { status: 'in_progress', updatedAt: { $lt: cutoff } },
      { $set: { status: 'stale' } }
    );
    return result.modifiedCount;
  },
  async findIncomplete() {
    const db = await getDb();
    return db.collection('scraper_runs').findOne({ status: 'in_progress' });
  },
  async incrementResumeCount(runId: string) {
    const db = await getDb();
    await db.collection('scraper_runs').updateOne(
      { runId },
      { $inc: { resumeCount: 1 }, $set: { updatedAt: new Date() } }
    );
  },
  async markCompleted(runId: string, stats: { productsScraped: number; productsSaved: number; durationMs: number }) {
    const db = await getDb();
    await db.collection('scraper_runs').updateOne(
      { runId },
      { 
        $set: { 
          status: 'completed', 
          completedAt: new Date(),
          productsScraped: stats.productsScraped,
          productsSaved: stats.productsSaved,
          durationMs: stats.durationMs,
          updatedAt: new Date()
        } 
      }
    );
  },
  async markFailed(runId: string, error: string) {
    const db = await getDb();
    await db.collection('scraper_runs').updateOne(
      { runId },
      { $set: { status: 'failed', errorMessage: error, updatedAt: new Date() } }
    );
  },
  async updateCheckpoint(runId: string, checkpoint: any) {
    const db = await getDb();
    await db.collection('scraper_runs').updateOne(
      { runId },
      { $set: { ...checkpoint, updatedAt: new Date() } }
    );
  }
};

// Find playwright chromium executable in various locations
async function getChromiumExecutable(): Promise<string | undefined> {
  const fs = require("fs");
  const { execSync } = require("child_process");
  
  const possiblePaths = [
    // System chromium (Railway, Docker)
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    // Vercel cache
    "/vercel/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome",
    "/vercel/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell",
    // Vercel sandbox user
    "/home/sbx_user1051/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome",
    "/home/sbx_user1051/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell",
    // HOME fallback
    path.join(os.homedir() || "/root", ".cache", "ms-playwright", "chromium-1208", "chrome-linux64", "chrome"),
    // Playwright default
    "/tmp/ms-playwright/chromium-1208/chrome-linux64/chrome",
    "/tmp/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell",
  ];
  
  console.log("[Scraper] Looking for chromium...");
  
  for (const p of possiblePaths) {
    try {
      console.log("[Scraper] Checking:", p);
      if (p && fs.existsSync(p)) {
        console.log("[Scraper] Found chromium at:", p);
        return p;
      }
    } catch (e) {
      console.log("[Scraper] Error checking path:", e);
    }
  }
  
  // Try download to /tmp
  console.log("[Scraper] No chromium found in cache, downloading at runtime...");
  try {
    const downloadDir = "/tmp/playwright-browsers";
    try { fs.mkdirSync(downloadDir, { recursive: true }); } catch {}
    
    execSync("npx playwright install chromium", { 
      stdio: "inherit",
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: downloadDir },
      cwd: "/tmp"
    });
    
    const newPaths = [
      path.join(downloadDir, "ms-playwright", "chromium-1208", "chrome-linux64", "chrome"),
      path.join(downloadDir, "chromium-1208", "chrome-linux64", "chrome"),
    ];
    
    for (const p of newPaths) {
      if (p && fs.existsSync(p)) {
        console.log("[Scraper] Downloaded chromium found at:", p);
        return p;
      }
    }
  } catch (e) {
    console.log("[Scraper] Failed to download chromium:", e);
  }
  
  return undefined;
}

/**
 * Retry configuration
 */
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;
const PAGE_NAVIGATION_TIMEOUT = 60000; // 60 segundos para páginas complejas

/**
 * Maximum number of parallel pages for detail scraping
 */
const MAX_PARALLEL_PAGES = 3;

/**
 * Track open pages for cleanup
 */
const openPages: Page[] = [];

export class ScraperService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private config: ScraperConfig;
  private request: ScraperRunRequest;
  private currentRun: ScraperRun | null = null;
  private currentCategoryIndex = 0;
  private currentPageNum = 1;
  private productsScrapedCount = 0;
  private productsSavedCount = 0;

  constructor(config?: ScraperConfig, request?: ScraperRunRequest) {
    this.config = config || getScraperConfig();
    this.request = request || {};
  }

  // ============================================================================
  // HELPER FUNCTIONS - Safe Browser/Page Management
  // ============================================================================

  /**
   * Register a page for tracking (to close later)
   */
  private trackPage(page: Page): void {
    openPages.push(page);
    // Clean up old closed pages
    while (openPages.length > 0 && openPages[0]?.isClosed()) {
      openPages.shift();
    }
  }

  /**
   * Close all tracked pages
   */
  private async closeTrackedPages(): Promise<void> {
    for (const page of openPages) {
      try {
        if (!page.isClosed()) {
          await page.close();
        }
      } catch { /* ignore */ }
    }
    openPages.length = 0;
  }

  /**
   * Create or reuse a page from the context
   * Includes browser connection check and auto-reconnect
   */
  private async getPage(): Promise<Page> {
    // Check browser connection first
    if (!this.browser || !this.browser.isConnected()) {
      console.log("[Scraper] Browser disconnected in getPage, reconnecting...");
      await this.reconnectBrowser();
    }
    
    // Ensure context is valid
    if (!this.context || !this.context.browser()?.isConnected()) {
      try { if (this.context) await this.context.close(); } catch { /* ignore */ }
      this.context = await this.browser!.newContext();
    }
    
    // Clean up closed pages first
    const validPages: Page[] = [];
    for (const page of openPages) {
      try {
        if (!page.isClosed()) {
          validPages.push(page);
        }
      } catch { /* ignore */ }
    }
    openPages.length = 0;
    openPages.push(...validPages);
    
    // Create new page
    const page = await this.context!.newPage();
    this.trackPage(page);
    return page;
  }

  /**
   * Safe page navigation with retry logic
   */
  private async safeGoto(page: Page, url: string, retries = MAX_RETRIES): Promise<boolean> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        if (!page || page.isClosed()) {
          page = await this.getPage();
        }
        
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_NAVIGATION_TIMEOUT });
        return true;
      } catch (error) {
        console.log(`[Scraper] Error navigating (attempt ${attempt}/${retries}):`, error);
        
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          // Try to get a fresh page
          try {
            page = await this.getPage();
          } catch {
            // ignore
          }
        }
      }
    }
    return false;
  }

  /**
   * Safe page content retrieval with retry
   */
  private async safeContent(page: Page, retries = MAX_RETRIES): Promise<string | null> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        if (!page || page.isClosed()) {
          return null;
        }
        return await page.content();
      } catch (error) {
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }
    return null;
  }

  // ============================================================================
  // BROWSER LIFECYCLE
  // ============================================================================

  /**
   * Initialize the browser instance
   */
  private async initBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      if (this.browser) {
        try { await this.browser.close(); } catch { /* ignore */ }
      }
      
      // Try to find or download chromium
      let chromiumPath: string | undefined;
      try {
        chromiumPath = await getChromiumExecutable();
      } catch (e) {
        console.log("[Scraper] Error getting chromium:", e);
      }
      
      this.browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--disable-dev-shm-usage",
        ],
        ...(chromiumPath ? { executablePath: chromiumPath } : {})
      });
    }
    return this.browser;
  }

  /**
   * Reinitialize browser and re-login
   */
  private async reconnectBrowser(): Promise<Page> {
    // Close all tracked pages and context
    await this.closeTrackedPages();
    
    try { 
      if (this.context) await this.context.close(); 
    } catch { /* ignore */ }
    this.context = null;
    
    await this.closeBrowser();
    
    // Create fresh browser and page
    await this.initBrowser();
    this.context = await this.browser!.newContext();
    const page = await this.context.newPage();
    this.trackPage(page);
    
    // Re-login
    console.log("[Scraper] Re-logging in after reconnect...");
    await this.login(page);
    await this.delay();
    
    return page;
  }

  /**
   * Ensure browser is connected, reconnect if needed
   * Returns a valid page to use
   */
  private async ensureBrowserConnected(): Promise<Page> {
    try {
      // Check if browser exists and is connected
      if (!this.browser || !this.browser.isConnected()) {
        console.log("[Scraper] Browser not connected, reconnecting...");
        return await this.reconnectBrowser();
      }
      
      // Check if context is still valid
      if (!this.context || !this.context.browser()?.isConnected()) {
        console.log("[Scraper] Context not valid, recreating...");
        await this.closeTrackedPages();
        try { if (this.context) await this.context.close(); } catch { /* ignore */ }
        this.context = await this.browser!.newContext();
        
        // Must login again after recreating context
        const loginPage = await this.context.newPage();
        await this.login(loginPage);
        await loginPage.close();
      }
      
      // Create a fresh page
      const page = await this.context.newPage();
      this.trackPage(page);
      return page;
    } catch (error) {
      console.log("[Scraper] Error checking browser, reconnecting...", error);
      return await this.reconnectBrowser();
    }
  }

  /**
   * Close the browser instance
   */
  async closeBrowser(): Promise<void> {
    if (this.browser) {
      try { await this.browser.close(); } catch { /* ignore */ }
      this.browser = null;
    }
    this.context = null;
  }

  /**
   * Wait for a specified delay
   */
  private async delay(ms?: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms ?? this.config.delayMs);
    });
  }

  /**
   * Short delay for between operations
   */
  private async shortDelay(): Promise<void> {
    // Delay reduced to minimum - most time is network wait anyway
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  /**
   * Login to the supplier website
   */
  async login(page: Page): Promise<void> {
    try {
      await page.goto(this.config.loginUrl, { waitUntil: "networkidle" });

      const selectors = this.config.selectors.login;

      // Fill in the login form
      await page.fill(selectors.emailInputSelector, this.config.email);
      await page.fill(selectors.passwordInputSelector, this.config.password);

      // Click submit
      await page.click(selectors.submitButtonSelector);

      // Wait for navigation after login
      await page.waitForLoadState("networkidle");

      // Check if login was successful by verifying we're not on the login page
      const currentUrl = page.url();
      if (currentUrl.includes("login") && !currentUrl.includes("logged")) {
        throw new Error("Login failed - still on login page");
      }

      console.log(`[Scraper] Successfully logged in as ${this.config.email}`);

      // Wait for the branch/sucursal selection modal to appear
      await this.delay();
      
      // Try to select a branch/sucursal (usually a modal appears after login)
      // Try common selectors for branch selection
      const branchSelectors = [
        "#ContentPlaceHolder1_ddlSucursal",
        "#ddlSucursal",
        "select[id*='Sucursal']",
        ".sucursal-select",
      ];

      for (const selector of branchSelectors) {
        try {
          const branchSelect = page.locator(selector);
          if (await branchSelect.count() > 0) {
            // Select the first option (or a specific branch like "Cipolletti")
            await branchSelect.selectOption({ index: 1 });
            await page.waitForLoadState("networkidle");
            console.log(`[Scraper] Selected branch/sucursal`);
            break;
          }
        } catch {
          // Try next selector
        }
      }

      // Also try clicking on a branch option directly if it's a list/buttons
      const branchLinkSelectors = [
        "a:has-text('Cipolletti')",
        "a:has-text('Neuquen')",
        ".branch-option",
      ];

      for (const selector of branchLinkSelectors) {
        try {
          const branchLink = page.locator(selector).first();
          if (await branchLink.count() > 0) {
            await branchLink.click();
            await page.waitForLoadState("networkidle");
            console.log(`[Scraper] Clicked on branch`);
            break;
          }
        } catch {
          // Try next selector
        }
      }

      await this.delay();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new ScraperError(`Login failed: ${message}`, "AUTH_FAILED", error) as ScraperError;
    }
  }

  /**
   * Scrape products from a single page (Jotakp specific)
   * Products are links with format: "Name U$D 98,75+ IVA ..."
   */
  private async scrapePage(page: Page): Promise<RawProduct[]> {
    const selectors = this.config.selectors.productList;

    const products: RawProduct[] = [];

    // For Jotakp, product links are: a[href*='articulo.aspx?id=']
    const items = await page.locator(selectors.itemSelector).all();
    
    console.log(`[Scraper] Found ${items.length} product links to scrape`);

    for (const item of items) {
      try {
        // Get the full text content and href from the link
        const fullText = await item.textContent();
        const href = await item.getAttribute("href");

        if (!fullText || !href) continue;

        // Parse the product ID from URL: articulo.aspx?id=14438
        const idMatch = href.match(/id=(\d+)/);
        const externalId = idMatch ? idMatch[1] : href;

        // Estructura HTML en página de categoría: <article><a><div class="tg-article-img">...</div><div class="tg-article-txt">Nombre</div><div class="tg-body-f12 font-weight-bold pt-2">U$D 14,20</div></a></article>
        // El textContent() del <a> no captura correctamente los divs anidados
        // Usamos evaluate() para obtener el innerHTML completo y parsear con regex
        let priceRaw: string | undefined;
        
        try {
          // Wait for prices to be loaded (they're dynamic content)
          await item.locator("div:has-text('U$D')").first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
          
          // Get the full HTML to parse prices
          const innerHTML = await item.evaluate(el => el.innerHTML);
          
          // Parse USD price from HTML: <div class="tg-body-f12 font-weight-bold pt-2">U$D 14,20<span class="badge...">+ IVA 21%</span></div>
          const usdPriceMatch = innerHTML.match(/U\$D\s+([\d.,]+)/);
          if (usdPriceMatch) {
            priceRaw = usdPriceMatch[1];
          }
        } catch (e) {
          // Fallback to textContent will handle this
        }

        // Fallback: try textContent if innerHTML didn't have price
        if (!priceRaw && fullText) {
          const priceMatch = fullText.match(/U\$D\s+([\d.,]+)/);
          priceRaw = priceMatch ? priceMatch[1] : undefined;
        }

        // Extract price with IVA (may not always be present)
        const priceWithIvaMatch = fullText.match(/\$?([\d.]+),([\d.]+)\+ IVA/);
        
        // Extract name (everything before U$D)
        const name = fullText.replace(/U\$D[\s\d.,+IVA%]+$/, "").trim();

        // Skip if no meaningful name
        if (!name || name.length < 3) continue;

        // Try to extract image - look for img inside or near the link
        // First, check if there's an image directly inside the link
        const imageUrls: string[] = [];
        
        try {
          // Method 1: Try to find img element inside the link
          const imgElement = item.locator("img").first();
          const imgCount = await imgElement.count();
          
          if (imgCount > 0) {
            const src = await imgElement.getAttribute("src");
            const dataSrc = await imgElement.getAttribute("data-src");
            const dataOriginal = await imgElement.getAttribute("data-original");
            
            if (src && (src.startsWith("http") || src.startsWith("/"))) {
              imageUrls.push(src);
            } else if (dataSrc && (dataSrc.startsWith("http") || dataSrc.startsWith("/"))) {
              imageUrls.push(dataSrc);
            } else if (dataOriginal && (dataOriginal.startsWith("http") || dataOriginal.startsWith("/"))) {
              imageUrls.push(dataOriginal);
            }
          }
          
          // Method 2: Try to extract from background-image in style attribute
          // Format: style='background-image: url(imagenes/min/imagen00012509.jpg); '
          if (imageUrls.length === 0) {
            const style = await item.locator("[style*='background-image']").first().getAttribute("style");
            if (style) {
              const bgMatch = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
              if (bgMatch && bgMatch[1]) {
                const bgUrl = bgMatch[1];
                if (bgUrl.startsWith("http") || bgUrl.startsWith("/") || bgUrl.startsWith("imagenes")) {
                  imageUrls.push(bgUrl);
                }
              }
            }
          }
          
          // Method 3: Find div with class "tg-article-img" or "w-100 tg-article-img"
          // Structure: article > a > div.tg-article-img
          // IMPORTANTE: Dejar la miniatura tal cual (imagenes/min/...), NO convertir a HD
          // La página de detalle nos da las imágenes HD reales
          if (imageUrls.length === 0) {
            // Try to find any descendant with the class
            const articleImgDiv = item.locator("div.tg-article-img, div.w-100.tg-article-img, [class*='tg-article-img']").first();
            const divCount = await articleImgDiv.count();
            
            if (divCount > 0) {
              const articleImgStyle = await articleImgDiv.getAttribute("style");
              if (articleImgStyle) {
                const bgMatch = articleImgStyle.match(/url\(['"]?([^'")\s]+)['"]?\)/);
                if (bgMatch && bgMatch[1]) {
                  const bgUrl = bgMatch[1];
                  // NO convertir a HD - dejar la miniatura tal cual
                  // La página de detalle tendrá las imágenes HD reales
                  if (bgUrl.startsWith("http") || bgUrl.startsWith("/") || bgUrl.startsWith("imagenes")) {
                    imageUrls.push(bgUrl);
                  }
                }
              }
            }
          }
        } catch {
          // No image found in this product link
        }

        // Extract stock from listing - si no es "0", usar ese valor
        let stockFromListing: number | undefined;
        try {
          const stockDiv = item.locator("div[id^='artcant']").first();
          const stockCount = await stockDiv.count();
          if (stockCount > 0) {
            const stockText = await stockDiv.textContent();
            const stockMatch = stockText?.match(/(\d+)/);
            if (stockMatch && parseInt(stockMatch[1], 10) > 0) {
              stockFromListing = parseInt(stockMatch[1], 10);
            }
          }
        } catch {
          // No stock found
        }
        
        const rawProduct: RawProduct = {
          externalId,
          name: name.substring(0, 200), // Limit name length
          priceRaw,
          priceWithIvaRaw: priceWithIvaMatch ? `${priceWithIvaMatch[1]},${priceWithIvaMatch[2]}` : undefined,
          imageUrls,
          categories: [],
          productUrl: href.startsWith("http") ? href : `${this.config.baseUrl}/${href}`,
          rawElement: undefined,
          // Optional: si scraped desde listado y hay stock > 0, usarlo
          ...(stockFromListing && stockFromListing > 0 ? { stock: stockFromListing } : {}),
        };

        products.push(rawProduct);
      } catch (error) {
        console.error("[Scraper] Error parsing product item:", error);
      }
    }

    console.log(`[Scraper] Found ${products.length} products on page`);
    return products;
  }

  /**
   * Scrape detailed product information from individual product pages
   * Uses safe navigation and content retrieval
   */
  async scrapeProductDetail(page: Page, productUrl: string): Promise<Partial<RawProduct> | null> {
    try {
      // Ensure URL is complete
      const fullUrl = productUrl.startsWith("http") 
        ? productUrl 
        : `${this.config.baseUrl}/${productUrl}`;
      
      // Use safe navigation with retry
      const navSuccess = await this.safeGoto(page, fullUrl);
      if (!navSuccess) {
        console.log(`[Scraper] Failed to navigate to product detail: ${productUrl}`);
        return null;
      }
      
      await this.shortDelay();

      const detail: Partial<RawProduct> = {};

      // Use safe content retrieval
      const content = await this.safeContent(page);
      if (!content) {
        console.log(`[Scraper] Failed to get content for: ${productUrl}`);
        return detail; // Return empty detail, not null - we still have the product URL
      }
      
      // Extract image URLs from the page content
      // Las imágenes están en las miniaturas: div.tg-img-overlay.artImg con data-src
      // Y la imagen principal: img.img-fluid con src
      
      // Method 1: Get ALL images from thumbnails (data-src attribute)
      // Estructura: <div class="tg-img-overlay artImg" data-src="imagenes/000015886.JPG">
      const thumbnailDivs = await page.locator("div.tg-img-overlay.artImg").all();
      const thumbnailUrls: string[] = [];
      
      for (const div of thumbnailDivs) {
        const dataSrc = await div.getAttribute("data-src");
        if (dataSrc && dataSrc.includes("imagenes/") && !dataSrc.includes("/min/")) {
          const fullUrl = dataSrc.startsWith("http") 
            ? dataSrc 
            : `${this.config.baseUrl}/${dataSrc}`;
          thumbnailUrls.push(fullUrl);
        }
      }
      
      // Method 2: Also get the main image (img.img-fluid)
      try {
        const mainImg = page.locator("img.img-fluid").first();
        if (await mainImg.count() > 0) {
          const src = await mainImg.getAttribute("src");
          if (src && src.includes("imagenes/") && !src.includes("/min/")) {
            const fullUrl = src.startsWith("http") 
              ? src 
              : `${this.config.baseUrl}/${src}`;
            // Add if not already in thumbnailUrls
            if (!thumbnailUrls.includes(fullUrl)) {
              thumbnailUrls.unshift(fullUrl); // Add at beginning (main image first)
            }
          }
        }
      } catch {
        // Ignore if no main image
      }
      
      if (thumbnailUrls.length > 0) {
        detail.imageUrls = thumbnailUrls;
      }

      // Also try common selectors as fallback
      if (!detail.imageUrls || detail.imageUrls.length === 0) {
        const imageSelectors = [
          "#ContentPlaceHolder1_imgArticulo",
          "img[id*='img']",
          ".product-image img",
          "#product-image img",
          ".principal-image img",
          "img.product-img",
          "img[itemprop='image']",
          "img.main-image",
        ];

        for (const selector of imageSelectors) {
          try {
            const img = page.locator(selector).first();
            if (await img.count() > 0) {
              const src = await img.getAttribute("src");
              const dataSrc = await img.getAttribute("data-src");
              const dataOriginal = await img.getAttribute("data-original");

              if (src && (src.startsWith("http") || src.startsWith("/"))) {
                detail.imageUrls = [src.startsWith("http") ? src : `${this.config.baseUrl}${src}`];
                break;
              } else if (dataSrc && (dataSrc.startsWith("http") || dataSrc.startsWith("/"))) {
                detail.imageUrls = [dataSrc.startsWith("http") ? dataSrc : `${this.config.baseUrl}${dataSrc}`];
                break;
              } else if (dataOriginal && (dataOriginal.startsWith("http") || dataOriginal.startsWith("/"))) {
                detail.imageUrls = [dataOriginal.startsWith("http") ? dataOriginal : `${this.config.baseUrl}${dataOriginal}`];
                break;
              }
            }
          } catch {
            // Try next selector
          }
        }
      }

      // Try to get description
      // The Jotakp site has description in a div with "Descripcion" in the class or id
      const descSelectors = [
        "#ContentPlaceHolder1_lblDescripcion",
        "[id*='lblDescripcion']",
        "div[id*='Descripcion']",
        "div[class*='Descripcion']",
        ".product-description",
        "#product-description",
        ".description",
        "[itemprop='description']",
      ];

      for (const selector of descSelectors) {
        try {
          const desc = page.locator(selector).first();
          if (await desc.count() > 0) {
            const text = await desc.textContent();
            // Make sure it's the actual description content, not empty or too short
            if (text && text.trim().length > 10 && !text.includes("guardarArtDescripcionBD")) {
              detail.description = text.trim();
              console.log(`[ScrapeDetail] Found description with selector "${selector}": ${text.substring(0, 100)}...`);
              break;
            }
          }
        } catch {
          // Try next selector
        }
      }

      // Try to get stock
      const stockSelectors = [
        "#ContentPlaceHolder1_lblStock",
        "#lblStock",
        ".stock",
        "#stock",
        "[itemprop='availability']",
        ".product-stock",
        ".stock-info",
        "span:has-text('Stock')",
        // Stock desde el div dinámico (funciona en listado Y detalle)
        "div[id^='artcant']",
        "div[id*='artcant']",
        ".tg-btn-secondary[style*='min-width: 80px']",
        // Span "Cantidad:" seguido del número
        "span:has-text('Cantidad:') + button + div",
        // Cualquier div que contenga número y esté cerca de botones +/-
        "div:text-nowrap button + div",
      ];

      for (const selector of stockSelectors) {
        try {
          const stock = page.locator(selector).first();
          if (await stock.count() > 0) {
            const text = await stock.textContent();
            if (text) {
              // Check if it says "Sin stock" or "Sin Stock" = no stock
              if (text.toLowerCase().includes("sin stock")) {
                detail.stock = 0;
                break;
              }
              // Check for "consultar" or similar = no stock
              if (text.toLowerCase().includes("consultar") || text.toLowerCase().includes("sin disponibilidad")) {
                detail.stock = 0;
                break;
              }
              // Try to extract a number
              const stockMatch = text.match(/(\d+)/);
              if (stockMatch) {
                detail.stock = parseInt(stockMatch[1], 10);
                break;
              }
            }
          }
        } catch {
          // Try next selector
        }
      }

      // Si el valor es 0 (cantidad por defecto), asumimos que HAY stock porque hay botones +/-
      // El valor 0 no significa "sin stock", significa "0 seleccionados"
      // Si hay botones + y -, el producto tiene stock disponible
      if (!detail.stock || detail.stock === 0) {
        try {
          const masBtn = page.locator("button:has-text('+')");
          const menosBtn = page.locator("button:has-text('-')");
          if ((await masBtn.count()) > 0 && (await menosBtn.count()) > 0) {
            // Hay botones +/-, MARCAMOS como que tiene stock (asumimos al menos 1)
            detail.stock = 1;
          }
        } catch {
          // No hay botones = sin stock
          detail.stock = 0;
        }
      }

      return detail;
    } catch (error) {
      console.error(`[Scraper] Error scraping product detail: ${productUrl}`, error);
      return null;
    }
  }

  /**
   * Scrape all products from multiple categories with detail pages and pagination
   * Can filter by specific category or idsubrubro1
   * Supports resume from checkpoint
   */
  async scrapeProducts(page: Page, categoriesToProcess: { id: string; name: string; idsubrubro1: number }[]): Promise<RawProduct[]> {
    const allProducts: RawProduct[] = [];
    const seenExternalIds = new Set<string>(); // Track IDs to avoid duplicates

    console.log(`[Scraper] Will scrape ${categoriesToProcess.length} category(ies)`);

    for (let catIndex = 0; catIndex < categoriesToProcess.length; catIndex++) {
      const category = categoriesToProcess[catIndex];
      
      // Check browser connection before starting each category
      try {
        page = await this.ensureBrowserConnected();
      } catch (error) {
        console.error(`[Scraper] Failed to reconnect browser for category ${category.name}:`, error);
        continue;
      }
      
      // Update current category index for checkpoint
      this.currentCategoryIndex = catIndex;
      
      console.log(`[Scraper] Scraping category: ${category.name} (id=${category.idsubrubro1})`);
      
      try {
        // Always start at page 1 for each new category
        // (Even if resuming, we start fresh per category)
        let pageNum = 1;
        this.currentPageNum = 1;
        let hasNextPage = true;
        
        await page.goto(
          `${this.config.baseUrl}/buscar.aspx?idsubrubro1=${category.idsubrubro1}&pag=${pageNum}`,
          { waitUntil: "networkidle" }
        );
        
        // Wait for dynamic content (prices) to load
        await page.waitForSelector("div:has-text('U$D')", { timeout: 10000 }).catch(() => {});
        
        // Additional small wait to ensure DOM is stable
        await this.delay(500);
        
        while (hasNextPage) {
          console.log(`[Scraper] Scraping ${category.name} - page ${pageNum}`);
          
          // Save checkpoint before scraping page
          await this.saveCheckpoint(category, pageNum);
          
          // Scrape products from this page
          const pageProducts = await this.scrapePage(page);
          
          console.log(`[Scraper] Found ${pageProducts.length} products on page ${pageNum}`);
          
          // Process products in PARALLEL batches for speed
          const productsWithDetails = await this.scrapeProductsInParallel(pageProducts);
          
          // Add category to each product
          for (const product of productsWithDetails) {
            // Skip if we've already seen this externalId (from previous page)
            if (seenExternalIds.has(product.externalId)) {
              console.log(`[Scraper] Skipping duplicate: ${product.externalId}`);
              continue;
            }
            seenExternalIds.add(product.externalId);
            
            product.categories = [category.id];
            allProducts.push(product);
            this.productsScrapedCount++;
          }
          
          console.log(`[Scraper] Processed ${productsWithDetails.length} products with details`);
          
          // Check for next page - navigate to next page and verify it has products
          try {
            // Create a fresh page for pagination check
            const paginationPage = await this.getPage();
            
            // Try to navigate to next page
            const nextPageNum = pageNum + 1;
            console.log(`[Scraper] Checking for page ${nextPageNum}...`);
            
            const navSuccess = await this.safeGoto(
              paginationPage,
              `${this.config.baseUrl}/buscar.aspx?idsubrubro1=${category.idsubrubro1}&pag=${nextPageNum}`
            );
            
            if (!navSuccess) {
              hasNextPage = false;
              console.log(`[Scraper] Navigation failed, no more pages in ${category.name}`);
            } else {
              // Wait a bit for page to render
              await this.shortDelay();
              await this.shortDelay(); // Extra wait for slow pages
              
              // Check if there are products on this page
              const content = await this.safeContent(paginationPage);
              
              if (content && content.includes('articulo.aspx?id=')) {
                // Count products on the page
                const productMatches = content.match(/articulo\.aspx\?id=\d+/g);
                const productCount = productMatches ? new Set(productMatches).size : 0;
                
                console.log(`[Scraper] Page ${nextPageNum} has ${productCount} products`);
                
                if (productCount > 0) {
                  pageNum = nextPageNum;
                  this.currentPageNum = pageNum;
                  console.log(`[Scraper] Moving to page ${pageNum}...`);
                  
                  // Navigate main page to the next page
                  await this.safeGoto(page, `${this.config.baseUrl}/buscar.aspx?idsubrubro1=${category.idsubrubro1}&pag=${pageNum}`);
                } else {
                  hasNextPage = false;
                  console.log(`[Scraper] No more pages in ${category.name} (page ${nextPageNum} is empty)`);
                }
              } else {
                hasNextPage = false;
                console.log(`[Scraper] No more pages in ${category.name}`);
              }
            }
            
            // Close pagination page
            try { await paginationPage.close(); } catch { /* ignore */ }
          } catch (e) {
            hasNextPage = false;
            console.log(`[Scraper] Error checking next page: ${e}`);
            console.log(`[Scraper] No more pages in ${category.name}`);
          }
        }
        
        // Save checkpoint after completing category
        await this.saveCheckpoint(category, pageNum);
        
      } catch (error) {
        console.error(`[Scraper] Error scraping category ${category.name}:`, error);
        // Save checkpoint on error
        await this.saveCheckpoint(category, 1);
      }
    }

    console.log(`[Scraper] Total products scraped: ${allProducts.length}`);
    return allProducts;
  }

  /**
   * Scrape multiple product details in PARALLEL for faster processing
   * Uses batch processing with MAX_PARALLEL_PAGES concurrent requests
   */
  private async scrapeProductsInParallel(pageProducts: RawProduct[]): Promise<RawProduct[]> {
    const results: RawProduct[] = [];
    const productsWithUrl = pageProducts.filter(p => p.productUrl);
    
    // Process in batches of MAX_PARALLEL_PAGES
    for (let i = 0; i < productsWithUrl.length; i += MAX_PARALLEL_PAGES) {
      const batch = productsWithUrl.slice(i, i + MAX_PARALLEL_PAGES);
      
      // Process this batch in parallel
      const batchPromises = batch.map(async (product) => {
        try {
          const detailPage = await this.getPage();
          const detail = await this.scrapeProductDetail(detailPage, product.productUrl!);
          
          // Close page immediately after use
          try { await detailPage.close(); } catch { /* ignore */ }
          
          // Merge detail into product
          if (detail) {
            if (detail.imageUrls && detail.imageUrls.length > 0) {
              product.imageUrls = detail.imageUrls;
            }
            if (detail.description) {
              product.description = detail.description;
            }
            if (detail.stock !== undefined) {
              product.stock = detail.stock;
            }
          }
          return product;
        } catch (error) {
          console.error(`[Scraper] Error scraping ${product.productUrl}:`, error);
          return product; // Return product even if detail failed
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches
      await this.shortDelay();
    }
    
    // Add products without URLs
    const productsWithoutUrl = pageProducts.filter(p => !p.productUrl);
    results.push(...productsWithoutUrl);
    
    return results;
  }

  /**
   * Run the complete scraping pipeline
   * Includes checkpoint system for resume on crash
   */
  async run(): Promise<ScraperResult> {
    const startTime = Date.now();
    const result: ScraperResult = {
      success: false,
      created: 0,
      updated: 0,
      errors: [],
      durationMs: 0,
      timestamp: new Date(),
    };

    let page: Page | null = null;

    try {
      // Ensure indexes exist
      await scraperRunRepository.ensureIndexes();

      // Step 0: Clean up stale runs (older than 24 hours)
      console.log("[Scraper] Cleaning up stale runs...");
      const cleanedCount = await scraperRunRepository.cleanupStaleRuns(24);
      if (cleanedCount > 0) {
        console.log(`[Scraper] Marked ${cleanedCount} stale run(s) as stale`);
      }

      // Step 0b: Check for incomplete run to resume
      const incompleteRun = await scraperRunRepository.findIncomplete();
      
      // Get categories to process
      const { jotakpCategories } = await import("./config");
      let validCategories = jotakpCategories.filter(c => c.idsubrubro1 > 0);

      // Filter by request
      if (this.request.idsubrubro1 !== undefined) {
        validCategories = validCategories.filter(c => c.idsubrubro1 === this.request.idsubrubro1);
        console.log(`[Scraper] Filtering to idsubrubro1=${this.request.idsubrubro1}`);
      } else if (this.request.categoryId) {
        validCategories = validCategories.filter(c => c.id === this.request.categoryId);
        console.log(`[Scraper] Filtering to categoryId=${this.request.categoryId}`);
      }

      const categoriesToProcess = validCategories.map(c => c.id);

      // Create new run or resume from checkpoint
      if (incompleteRun) {
        console.log(`[Scraper] Resuming from incomplete run ${incompleteRun.runId}`);
        this.currentRun = incompleteRun;
        this.currentCategoryIndex = incompleteRun.currentCategoryIndex;
        this.currentPageNum = incompleteRun.lastPageNumber;
        this.productsScrapedCount = incompleteRun.productsScraped;
        this.productsSavedCount = incompleteRun.productsSaved;
        
        // Increment resume count
        await scraperRunRepository.incrementResumeCount(incompleteRun.runId);
        
        // Update categories to process from the run
        if (incompleteRun.categoriesToProcess.length > 0) {
          // Filter validCategories based on what was being processed
          validCategories = validCategories.slice(this.currentCategoryIndex);
        }
      } else {
        // Create new run
        this.currentRun = await scraperRunRepository.create({
          source: this.request.source,
          categoryId: this.request.categoryId,
          idsubrubro1: this.request.idsubrubro1,
          categoriesToProcess,
        });
        console.log(`[Scraper] Created new run ${this.currentRun.runId}`);
      }

      // Initialize browser
      const browser = await this.initBrowser();
      const context = await browser.newContext();
      page = await context.newPage();

      // Step 1: Login
      console.log("[Scraper] Starting login...");
      await this.login(page);

      // Add delay after login
      await this.delay();

      // Step 2: Navigate to products page and scrape
      console.log("[Scraper] Starting to scrape products...");
      const rawProducts = await this.scrapeProducts(page, validCategories);
      result.errors.push(`Scraped ${rawProducts.length} raw products from website`);

      if (rawProducts.length === 0) {
        result.success = true;
        result.durationMs = Date.now() - startTime;
        // Mark as completed
        if (this.currentRun) {
          await scraperRunRepository.markCompleted(this.currentRun.runId, {
            productsScraped: this.productsScrapedCount,
            productsSaved: this.productsSavedCount,
            durationMs: result.durationMs,
          });
        }
        return result;
      }

      // Step 4: Transform products
      console.log("[Scraper] Transforming products...");
      const { products, errors } = transformProducts(rawProducts, this.config.supplier);
      result.errors.push(...errors);
      
      // Debug: log transformed products
      for (const p of products) {
        console.log(`[Scraper] Transformed product ${p.externalId}: priceRaw=${p.priceRaw}, price=${p.price}`);
      }

      // Step 5: Upload images to Cloudinary for each product
      console.log("[Scraper] Uploading images to Cloudinary...");
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        if (product.imageUrls && product.imageUrls.length > 0) {
          // Keep original imageUrls as fallback
          const originalImageUrls = [...product.imageUrls];
          
          try {
            // Upload to Cloudinary
            const cloudUrls = await uploadProductImages(
              product.imageUrls,
              product.supplier,
              product.externalId
            );
            
            // Save Cloudinary URLs in cloudinaryUrls field
            if (cloudUrls.length > 0) {
              product.cloudinaryUrls = cloudUrls;
              console.log(`[Scraper] Uploaded ${cloudUrls.length} images for ${product.name.substring(0, 30)}... (cloudinary)`);
            }
            
            // Keep original URLs as fallback in imageUrls
            product.imageUrls = originalImageUrls;
            
          } catch (imageError) {
            console.error(`[Scraper] Error uploading images for ${product.externalId}:`, imageError);
            // Keep original URLs if upload failed
            product.imageUrls = originalImageUrls;
          }
        }
        // Small delay between products to not saturate the server
        await this.shortDelay();
      }

      // Step 6: Save to database con BULK WRITE (1 query para todos los productos)
      console.log("[Scraper] Saving products to database (BULK)...");
      const seenExternalIds: string[] = [];
      let bulkCreated = 0, bulkUpdated = 0, bulkUnchanged = 0;
      
      try {
        const r = await productRepository.bulkUpsert(products);
        bulkCreated = r.created;
        bulkUpdated = r.updated;
        bulkUnchanged = r.unchanged;
        seenExternalIds.push(...products.map(p => p.externalId));
        this.productsSavedCount = products.length;
        console.log(`[Scraper] Bulk saved: ${bulkCreated} created, ${bulkUpdated} updated, ${bulkUnchanged} unchanged`);
      } catch (dbError) {
        const errorMsg = dbError instanceof Error ? dbError.message : "Unknown error";
        result.errors.push(`Bulk save failed: ${errorMsg}`);
      }
      
      // Step 7: Marcar productos descontinuados de la categoría scrapeada
      // Cuando scrapeamos una subcategoría específica, marcamos solo los de esa subcategoría
      let discontinuedCount = 0;
      
      if (this.request.idsubrubro1 !== undefined) {
        // Scrapeo específico de subcategoría - marcar descontinuados solo de esa subcategoría
        const category = jotakpCategories.find(c => c.idsubrubro1 === this.request.idsubrubro1);
        const categoryId = category?.id;
        
        if (categoryId) {
          console.log(`[Scraper] Marking discontinued products for category: ${categoryId}`);
          
          // Obtener productos actuales de esa categoría en la DB
          const db = await getDb();
          const productsCollection = db.collection("products");
          const existingProducts = await productsCollection.find({
            supplier: this.config.supplier,
            categories: categoryId,
            status: "active"
          }).toArray();
          
          const existingIds = existingProducts.map(p => p.externalId);
          const scrapedIds = seenExternalIds;
          
          // Los que estaban pero ya no aparecieron en el scrapeo
          const disappearedIds = existingIds.filter(id => !scrapedIds.includes(id));
          
          if (disappearedIds.length > 0) {
            const result = await productsCollection.updateMany(
              {
                supplier: this.config.supplier,
                externalId: { $in: disappearedIds },
                categories: categoryId
              },
              {
                $set: {
                  status: "discontinued",
                  discontinuedAt: new Date()
                }
              }
            );
            discontinuedCount = result.modifiedCount;
            console.log(`[Scraper] Marked ${discontinuedCount} products as discontinued in ${categoryId}`);
          }
        }
      } else if (this.request.categoryId) {
        // Scrapeo por categoryId (sin idsubrubro1 específico) - también marcar descontinuados
        const categoryId = this.request.categoryId;
        console.log(`[Scraper] Marking discontinued products for category: ${categoryId}`);
        
        const db = await getDb();
        const productsCollection = db.collection("products");
        const existingProducts = await productsCollection.find({
          supplier: this.config.supplier,
          categories: categoryId,
          status: "active"
        }).toArray();
        
        const existingIds = existingProducts.map(p => p.externalId);
        const scrapedIds = seenExternalIds;
        
        const disappearedIds = existingIds.filter(id => !scrapedIds.includes(id));
        
        if (disappearedIds.length > 0) {
          const result = await productsCollection.updateMany(
            {
              supplier: this.config.supplier,
              externalId: { $in: disappearedIds },
              categories: categoryId
            },
            {
              $set: {
                status: "discontinued",
                discontinuedAt: new Date()
              }
            }
          );
          discontinuedCount = result.modifiedCount;
          console.log(`[Scraper] Marked ${discontinuedCount} products as discontinued in ${categoryId}`);
        }
      } else if (this.request.categoryId === undefined) {
        // Scrapeo completo de todas las categorías
        console.log("[Scraper] Marking discontinued products (full scrape)...");
        discontinuedCount = await productRepository.markDiscontinued(
          this.config.supplier,
          seenExternalIds
        );
      } else {
        console.log("[Scraper] Skipping mark discontinued (category-specific scrape)");
      }
      
      result.created = bulkCreated;
      result.updated = bulkUpdated;
      result.errors.push(`Unchanged: ${bulkUnchanged}, Discontinued: ${discontinuedCount}`);

      // Mark run as completed
      if (this.currentRun) {
        await scraperRunRepository.markCompleted(this.currentRun.runId, {
          productsScraped: this.productsScrapedCount,
          productsSaved: this.productsSavedCount,
          durationMs: result.durationMs,
        });
      }

      result.success = true;
      console.log(`[Scraper] Completed: ${bulkCreated} created, ${bulkUpdated} updated, ${bulkUnchanged} unchanged, ${discontinuedCount} discontinued`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const scraperError = error as ScraperError;

      result.errors.push(`Error: ${message}`);
      console.error("[Scraper] Pipeline failed:", message);

      // Save checkpoint before throwing (if we have a run)
      if (this.currentRun) {
        await scraperRunRepository.updateCheckpoint(this.currentRun.runId, {
          currentCategoryIndex: this.currentCategoryIndex,
          lastPageNumber: this.currentPageNum,
          productsScraped: this.productsScrapedCount,
          productsSaved: this.productsSavedCount,
        });
        await scraperRunRepository.markFailed(this.currentRun.runId, message);
      }

      // Provide more specific error codes
      if (scraperError.code === "AUTH_FAILED") {
        throw error; // Re-throw auth errors
      }
    } finally {
      result.durationMs = Date.now() - startTime;

      // Clean up
      if (page) {
        await page.close();
      }
      await this.closeBrowser();
    }

    return result;
  }

  /**
   * Save checkpoint for current progress
   */
  private async saveCheckpoint(category: { id: string; name: string; idsubrubro1: number }, pageNum: number): Promise<void> {
    if (!this.currentRun) return;

    await scraperRunRepository.updateCheckpoint(this.currentRun.runId, {
      lastCategoryId: category.id,
      lastCategoryName: category.name,
      currentCategoryIndex: this.currentCategoryIndex,
      lastPageNumber: pageNum,
      productsScraped: this.productsScrapedCount,
      productsSaved: this.productsSavedCount,
    });
  }
}

/**
 * Create a simple function to run the scraper
 * @param request - Optional request to filter by category
 */
export async function runScraper(request?: ScraperRunRequest): Promise<ScraperResult> {
  const scraper = new ScraperService(undefined, request);
  return scraper.run();
}
