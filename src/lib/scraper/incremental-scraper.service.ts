import { chromium } from "playwright";
import { getScraperConfig, jotakpCategories } from "./config";
import { runScraper } from "./scraper.service";
import { MongoClient, Db } from "mongodb";
import crypto from "crypto";
import path from "path";
import os from "os";

// Set browsers path
const BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || "/tmp/ms-playwright";
process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_PATH;
process.env.HOME = "/tmp";
console.log("[Scraper] Initialized PLAYWRIGHT_BROWSERS_PATH:", BROWSERS_PATH);

/**
 * Incremental Scraper - runs smart scraping every 2 hours
 * 
 * Flow:
 * 1. Pre-check: Get first page of each category and calculate hash
 * 2. Compare with previous state - if changed, mark for re-scrape
 * 3. Only scrape categories that changed
 * 4. Update state in DB
 */

const MAX_PARALLEL_PAGES = 2; // Reducido para evitar sobrecarga

// Find chromium executable
async function getChromiumExecutable(): Promise<string | undefined> {
  const fs = require("fs");
  const pathModule = require("path");
  const { execSync } = require("child_process");

  const possiblePaths = [
    // System chromium (Railway, Docker)
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    // Vercel cache
    "/vercel/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome",
    "/vercel/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell",
    "/home/sbx_user1051/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome",
    "/home/sbx_user1051/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell",
    pathModule.join(BROWSERS_PATH, "chromium-1208", "chrome-linux64", "chrome"),
    pathModule.join(BROWSERS_PATH, "chromium_headless_shell-1208", "chrome-headless-shell-linux64", "chrome-headless-shell"),
    pathModule.join("/tmp", "ms-playwright", "chromium-1208", "chrome-linux64", "chrome"),
  ];

  console.log("[Scraper] Looking for chromium in", possiblePaths.length, "locations...");

  for (const p of possiblePaths) {
    try {
      console.log("[Scraper] Checking:", p);
      if (p && fs.existsSync(p)) {
        console.log("[Scraper] FOUND chromium at:", p);
        return p;
      }
    } catch (e) {
      console.log("[Scraper] Error checking path:", e);
    }
  }

  // Try to download
  console.log("[Scraper] No chromium found, attempting download...");
  try {
    const downloadDir = BROWSERS_PATH;
    try {
      fs.mkdirSync(downloadDir, { recursive: true });
    } catch {
      /* ignore */
    }

    console.log("[Scraper] Running: npx playwright install chromium");
    execSync("npx playwright install chromium", {
      stdio: "inherit",
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: downloadDir,
        HOME: "/tmp",
      },
    });

    const searchPaths = [
      pathModule.join(downloadDir, "chromium-1208", "chrome-linux64", "chrome"),
      pathModule.join(downloadDir, "ms-playwright", "chromium-1208", "chrome-linux64", "chrome"),
      "/tmp/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome",
    ];

    for (const p of searchPaths) {
      console.log("[Scraper] Checking downloaded:", p);
      if (p && fs.existsSync(p)) {
        console.log("[Scraper] Downloaded chromium at:", p);
        return p;
      }
    }
  } catch (e) {
    console.log("[Scraper] Download failed:", e);
  }

  console.log("[Scraper] WARNING: Returning undefined - playwright will use default");
  return undefined;
}

/**
 * Generate MD5 hash of page content
 */
function generateContentHash(content: string): string {
  return crypto.createHash("md5").update(content).digest("hex");
}

/**
 * Get category preview (lightweight info from first page)
 */
async function getCategoryPreview(page: any, idsubrubro1: number, baseUrl: string): Promise<{
  contentHash: string;
  productCount: number;
  productIds: string[];
  firstPriceUsd?: string;
} | null> {
  try {
    const url = `${baseUrl}/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=1`;
    // Use domcontentloaded + wait for content instead of networkidle
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    
    // Wait for dynamic content to load
    await page.waitForTimeout(2000);
    await page.waitForSelector("div:has-text('U$D')", { timeout: 10000 }).catch(() => {});

    const content = await page.content();
    const contentHash = generateContentHash(content);

    const items = await page.locator("a[href*='articulo.aspx?id=']").all();
    const productIds: string[] = [];
    const seenIds = new Set<string>();

    for (const item of items) {
      const href = await item.getAttribute("href");
      if (href) {
        const idMatch = href.match(/id=(\d+)/);
        if (idMatch && !seenIds.has(idMatch[1])) {
          seenIds.add(idMatch[1]);
          productIds.push(idMatch[1]);
        }
      }
    }

    let firstPriceUsd: string | undefined;
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
      firstPriceUsd,
    };
  } catch (error) {
    console.error(`[Incremental] Error getting preview for idsubrubro1=${idsubrubro1}:`, error);
    return null;
  }
}

/**
 * Get DB connection - singleton pattern to avoid connection leaks
 */
let mongoClient: MongoClient | null = null;
let dbInstance: Db | null = null;

async function getDb(): Promise<Db> {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  const DB_NAME = process.env.DB_NAME || process.env.MONGODB_DB_NAME || "ecommerce";

  if (!MONGO_URI) {
    throw new Error("MONGO_URI is required");
  }

  // Reuse existing client instead of creating new one each time
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGO_URI, {
      maxPoolSize: 10,
      minPoolSize: 1,       // Mantener 1 conexión viva
      maxIdleTimeMS: 30000,  // 30 segundos - no cerrar durante scrape
    });
    await mongoClient.connect();
    console.log("[Incremental] MongoDB connected (singleton)");
  }

  if (!dbInstance) {
    dbInstance = mongoClient.db(DB_NAME);
  }

  return dbInstance;
}

/**
 * Close DB connection - call on graceful shutdown
 */
export async function closeDb(): Promise<void> {
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
    dbInstance = null;
    console.log("[Incremental] MongoDB connection closed");
  }
}

/**
 * Pre-check all categories - parallel version
 */
export async function preCheckCategories(categories: { id: string; idsubrubro1: number; name: string }[]): Promise<{
  changed: string[];
  unchanged: string[];
  errors: string[];
}> {
  const result = {
    changed: [] as string[],
    unchanged: [] as string[],
    errors: [] as string[],
  };

  const config = getScraperConfig();

  let chromiumPath: string | undefined;
  try {
    chromiumPath = await getChromiumExecutable();
  } catch (e) {
    console.log("[Scraper] Error getting chromium:", e);
  }

  console.log("[Scraper] Using chromium path:", chromiumPath || "default");

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage", // Agregado para Railway
      "--disable-gpu",
      "--disable-software-rasterizer",
    ],
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  });

  try {
    console.log("[Incremental] Login for pre-check...");
    const context = await browser.newContext({
      viewport: { width: 1024, height: 768 },
    });
    const loginPage = await context.newPage();

    // Use domcontentloaded instead of networkidle - more stable in Railway
    await loginPage.goto(config.loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    
    // Wait a bit for page to settle
    await loginPage.waitForTimeout(3000);
    
    await loginPage.fill(config.selectors.login.emailInputSelector, config.email);
    await loginPage.fill(config.selectors.login.passwordInputSelector, config.password);
    await loginPage.click(config.selectors.login.submitButtonSelector);
    
    // Wait for navigation after login
    await loginPage.waitForTimeout(3000);

    await loginPage.waitForTimeout(2000);
    try {
      const branchSelect = loginPage.locator("#ContentPlaceHolder1_ddlSucursal, #ddlSucursal").first();
      if (await branchSelect.count() > 0) {
        await branchSelect.selectOption({ index: 1 });
        await loginPage.waitForTimeout(2000);
      }
    } catch {
      /* ignore */
    }

    await loginPage.close();

    console.log("[Incremental] Pre-checking categories in parallel...");

    // Process in batches with better error handling
    for (let i = 0; i < categories.length; i += MAX_PARALLEL_PAGES) {
      const batch = categories.slice(i, i + MAX_PARALLEL_PAGES);
      console.log(`[Incremental] Pre-check batch ${Math.floor(i / MAX_PARALLEL_PAGES) + 1}: ${batch.map((c) => c.name).join(", ")}`);

      const batchPromises = batch.map(async (cat) => {
        let page = null;
        try {
          page = await context.newPage();
          // Set memory limits on page
          await page.setViewportSize({ width: 1280, height: 720 });
          
          const preview = await getCategoryPreview(page, cat.idsubrubro1, config.baseUrl);
          
          // Close page immediately after use
          try { await page.close(); } catch { /* ignore */ }
          
          if (!preview) {
            return { categoryId: cat.id, status: "error" };
          }

          // Compare with previous state
          const db = await getDb();
          const existing = await db.collection("scraper_state").findOne({ categoryId: cat.id });
          const hasChanged = !existing || existing.contentHash !== preview.contentHash;

          // Save snapshot
          await db.collection("scraper_state").updateOne(
            { categoryId: cat.id },
            {
              $set: {
                categoryId: cat.id,
                idsubrubro1: cat.idsubrubro1,
                contentHash: preview.contentHash,
                productCount: preview.productCount,
                productIds: preview.productIds,
                firstPriceUsd: preview.firstPriceUsd,
                capturedAt: new Date(),
              },
            },
            { upsert: true }
          );

          return {
            categoryId: cat.id,
            status: hasChanged ? "changed" : "unchanged",
            count: preview.productCount,
          };
        } catch (error) {
          // Close page on error
          console.error(`[Pre-check] Error ${cat.id}:`, error.message);
          try { if (page) await page.close(); } catch { /* ignore */ }
          return { categoryId: cat.id, status: "error" };
        }
      });

      const batchResults = await Promise.all(batchPromises);

      // Process results
      for (const r of batchResults) {
        if (r.status === "changed") {
          result.changed.push(r.categoryId);
          console.log(`[Incremental] Changed: ${r.categoryId} (count: ${r.count})`);
        } else if (r.status === "unchanged") {
          result.unchanged.push(r.categoryId);
          console.log(`[Incremental] Unchanged: ${r.categoryId}`);
        } else {
          result.errors.push(r.categoryId);
          console.log(`[Incremental] Error: ${r.categoryId}`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`[Incremental] Pre-check complete: ${result.changed.length} changed, ${result.unchanged.length} unchanged, ${result.errors.length} errors`);
  return result;
}

/**
 * Run incremental scraper with auto resume
 * 1. Pre-check all categories (parallel)
 * 2. Only scrape changed ones (parallel)
 * 3. Update states
 */
export async function runIncrementalScraper(forceFullScrape: boolean = false): Promise<{
  success: boolean;
  preCheck: {
    total: number;
    changed: string[];
    unchanged: string[];
    errors: string[];
  };
  scrapeResult?: {
    created: number;
    updated: number;
    errors: string[];
    durationMs: number;
  };
  timestamp: Date;
}> {
  console.log("[Incremental] Starting incremental scraper (parallel)...");

  try {
    // Get all subcategories
    const categories = jotakpCategories
      .filter((c) => c.idsubrubro1 > 0)
      .map((c) => ({ id: c.id, idsubrubro1: c.idsubrubro1, name: c.name }));

    let preCheckResult;

    if (forceFullScrape) {
      console.log("[Incremental] Force full scrape - skipping pre-check");
      preCheckResult = {
        changed: categories.map((c) => c.id),
        unchanged: [],
        errors: [],
      };
    } else {
      preCheckResult = await preCheckCategories(categories);
    }

    console.log(`[Incremental] Pre-check result: ${preCheckResult.changed.length} changed, ${preCheckResult.unchanged.length} unchanged`);

    // If no changes, finish
    if (preCheckResult.changed.length === 0) {
      return {
        success: true,
        preCheck: {
          total: categories.length,
          changed: preCheckResult.changed,
          unchanged: preCheckResult.unchanged,
          errors: preCheckResult.errors,
        },
        timestamp: new Date(),
      };
    }

    // ============================================================
    // RESUME LOGIC: Get categories already processed
    // ============================================================
    const processedCategories = new Set<string>();
    try {
      const db = await getDb();
      const allStates = await db.collection("scraper_state").find().toArray();
      for (const state of allStates) {
        if (state.lastScrapeAt) {
          const lastScrape = new Date(state.lastScrapeAt);
          const now = new Date();
          const hoursDiff = (now.getTime() - lastScrape.getTime()) / (1000 * 60 * 60);
          if (hoursDiff < 2) {
            processedCategories.add(state.categoryId);
          }
        }
      }
      console.log(`[Incremental] Found ${processedCategories.size} recently processed categories, will skip them`);
    } catch (e) {
      console.log("[Incremental] Could not load previous state, starting fresh");
    }

    // Filter categories to process
    const categoriesToScrape = preCheckResult.changed.filter((catId) => !processedCategories.has(catId));
    console.log(`[Incremental] Scraping ${categoriesToScrape.length} categories (filtered from ${preCheckResult.changed.length})...`);

    if (categoriesToScrape.length === 0) {
      console.log("[Incremental] All categories already processed recently");
      return {
        success: true,
        preCheck: {
          total: categories.length,
          changed: preCheckResult.changed,
          unchanged: preCheckResult.unchanged,
          errors: preCheckResult.errors,
        },
        timestamp: new Date(),
      };
    }

    // Scrape changed categories in parallel
    const scrapeResults = {
      created: 0,
      updated: 0,
      errors: [] as string[],
      durationMs: 0,
    };

    const startTime = Date.now();

    for (let i = 0; i < categoriesToScrape.length; i += MAX_PARALLEL_PAGES) {
      const batch = categoriesToScrape.slice(i, i + MAX_PARALLEL_PAGES);
      console.log(`[Incremental] Scraping batch ${Math.floor(i / MAX_PARALLEL_PAGES) + 1}: ${batch.join(", ")}`);

      const batchPromises = batch.map(async (categoryId) => {
        try {
          const result = await runScraper({
            categoryId,
            source: "incremental",
          });

          // Update state
          const cat = jotakpCategories.find((c) => c.id === categoryId);
          if (cat) {
            const db = await getDb();
            await db.collection("scraper_state").updateOne(
              { categoryId: cat.id },
              {
                $set: {
                  lastScrapeAt: new Date(),
                },
              }
            );
          }

          return result;
        } catch (error) {
          console.error(`[Incremental] Error scraping ${categoryId}:`, error);
          return {
            created: 0,
            updated: 0,
            errors: [`Error scraping ${categoryId}`],
            success: false,
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);

      for (const r of batchResults) {
        scrapeResults.created += r.created;
        scrapeResults.updated += r.updated;
        scrapeResults.errors.push(...r.errors);
      }
    }

    scrapeResults.durationMs = Date.now() - startTime;

    // ============================================================
    // MARK DISCONTINUED
    // ============================================================
    try {
      console.log(`[Incremental] Scraping completed: ${scrapeResults.created} created, ${scrapeResults.updated} updated`);
    } catch (e) {
      console.log("[Incremental] Error marking discontinued:", e);
    }

    return {
      success: true,
      preCheck: {
        total: categories.length,
        changed: preCheckResult.changed,
        unchanged: preCheckResult.unchanged,
        errors: preCheckResult.errors,
      },
      scrapeResult: scrapeResults,
      timestamp: new Date(),
    };
  } catch (error) {
    console.error("[Incremental] Error:", error);
    throw error;
  } finally {
    // Cerrar conexión MongoDB después de cada ejecución (libera conexiones para M0)
    await closeDb();
    console.log("[Incremental] MongoDB connection closed after scrape");
  }
}