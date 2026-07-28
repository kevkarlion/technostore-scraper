/**
 * Playwright Singleton — shared browser instance across all scraper services.
 * 
 * Railway has strict PID limits. Using a single browser instance instead of
 * launching multiple browsers reduces resource usage significantly.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';

// PLAYWRIGHT_BROWSERS_PATH env var is used automatically by Playwright.
// No need to read it here — playwright.launch() respects it natively.

interface EnrichedProductData {
  priceRaw?: string;
  priceWithIvaRaw?: string;
  description?: string;
  sku?: string;
  stock?: number;
  imageUrls?: string[];
  // Added by caller
  name?: string;
  externalId?: string;
  categories?: string[];
  price?: number;
}

class PlaywrightSingleton {
  private static instance: PlaywrightSingleton;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private initialized = false;
  private baseUrl = '';
  private launchPromise: Promise<void> | null = null;
  private initPromise: Promise<void> | null = null;
  
  // Failure tracking for auto-restart
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly FAILURE_THRESHOLD = 3; // Restart after 3 consecutive failures
  private readonly FAILURE_WINDOW_MS = 60000; // Within 1 minute

  private constructor() {}

  static getInstance(): PlaywrightSingleton {
    if (!PlaywrightSingleton.instance) {
      PlaywrightSingleton.instance = new PlaywrightSingleton();
    }
    return PlaywrightSingleton.instance;
  }

  async launch(): Promise<void> {
    // Already launched
    if (this.browser) return;
    
    // Prevent concurrent launches
    if (this.launchPromise) {
      await this.launchPromise;
      return;
    }

    this.launchPromise = this._doLaunch();
    await this.launchPromise;
    this.launchPromise = null;
  }

  private async _doLaunch(): Promise<void> {
    if (this.browser) return;

    // Let Playwright resolve the browser path from PLAYWRIGHT_BROWSERS_PATH.
    // Don't hardcode chromium version — it changes on every Playwright update.
    console.log('[PlaywrightSingleton] Launching browser');

    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--js-flags=--max-old-space-size=512',
      ],
    });

    this.context = await this.browser.newContext();
    console.log('[PlaywrightSingleton] Browser launched successfully');
  }

  async initSession(baseUrl: string, credentials?: { email: string; password: string }): Promise<void> {
    // Already initialized - wait for the existing promise
    if (this.initialized && this.context) {
      return;
    }

    // Prevent concurrent initialization
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = this._doInitSession(baseUrl, credentials);
    await this.initPromise;
    this.initPromise = null;
  }

  private async _doInitSession(baseUrl: string, credentials?: { email: string; password: string }): Promise<void> {
    if (this.initialized || !this.context) {
      return;
    }

    this.baseUrl = baseUrl;
    const page = await this.context.newPage();

    try {
      // Navigate to login page
      await page.goto(`${baseUrl}/loginext.aspx`, { waitUntil: 'networkidle', timeout: 20000 });

      if (credentials) {
        await page.fill('#TxtEmail', credentials.email);
        await page.fill('#TxtPass1', credentials.password);

        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
          page.click('#BtnIngresar'),
        ]);
        console.log('[PlaywrightSingleton] Login submitted');
      }

      // Navigate to site to establish session
      await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 });

      // Select branch (Cipolletti, Id=1)
      const branchOk = await page.evaluate(async () => {
        try {
          if (typeof (window as any).PageMethods !== 'undefined') {
            return await new Promise<boolean>((resolve) => {
              (window as any).PageMethods.SeleccionarSucursal(
                1,
                (response: any) => {
                  const el = document.getElementById('varIdDeposito');
                  if (el) (el as HTMLInputElement).value = response.IdDepositoDefecto;
                  resolve(true);
                },
                () => resolve(false),
              );
            });
          }
          const resp = await fetch('/articulo.aspx/SeleccionarSucursal', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify({ Id: 1 }),
          });
          return resp.ok;
        } catch {
          return false;
        }
      });

      if (branchOk) {
        this.initialized = true;
        console.log('[PlaywrightSingleton] Session initialized: login OK, branch Cipolletti selected');
      } else {
        console.error('[PlaywrightSingleton] Failed to select branch');
      }
    } finally {
      await page.close();
    }
  }

  async newPage(): Promise<Page> {
    // Auto-recover: if browser crashed, restart immediately
    if (!this.context) {
      console.warn('[PlaywrightSingleton] Browser not launched — restarting...');
      await this.close();
      await this.launch();
    }
    if (!this.context) throw new Error('Browser not launched after restart');
    return this.context.newPage();
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.initialized = false;
      console.log('[PlaywrightSingleton] Browser closed');
    }
  }

  /**
   * Track a failure and restart browser if threshold exceeded.
   * Returns true if browser was restarted.
   */
  async checkAndRestart(): Promise<boolean> {
    const now = Date.now();
    
    // Reset if more than 1 minute since last failure
    if (now - this.lastFailureTime > this.FAILURE_WINDOW_MS) {
      this.failureCount = 0;
    }
    
    this.failureCount++;
    this.lastFailureTime = now;
    
    if (this.failureCount >= this.FAILURE_THRESHOLD) {
      console.log(`[PlaywrightSingleton] Too many failures (${this.failureCount}), restarting browser...`);
      await this.close();
      await this.launch();
      this.failureCount = 0;
      return true;
    }
    
    return false;
  }

  /**
   * Reset failure counter (call on success).
   */
  resetFailureCount(): void {
    this.failureCount = 0;
  }

  // ============================================================================
  // ENRICHMENT METHODS (delegated from PlaywrightEnricher)
  // ============================================================================

  /**
   * Enrich a product by navigating to its detail page.
   */
  async enrichProduct(externalId: string, baseUrl?: string): Promise<EnrichedProductData> {
    const url = baseUrl || this.baseUrl;
    if (!url) throw new Error('baseUrl required — call initSession first');

    if (!this.initialized) {
      await this.initSession(url);
    }

    const page = await this.newPage();
    try {
      const fullUrl = `${url}/articulo.aspx?id=${externalId}&conIva=1`;
      console.log('[DEBUG] enrichProduct URL:', fullUrl);
      await page.goto(fullUrl, {
        waitUntil: 'networkidle',
        timeout: 45000,
      });

      await page.waitForSelector('div.col-12.tg-body-f18, [id*="lblStock"], #divArticuloDescripcion', {
        timeout: 5000,
      }).catch(() => {});

      const result: EnrichedProductData = {};

      const scraped = await page.evaluate(() => {
        const data: Record<string, any> = {};

        // USD price: find price that comes right before "Precio de lista" (main product)
        const bodyText = document.body.innerText || '';
        const precioListaIndex = bodyText.indexOf('Precio de lista');
        if (precioListaIndex > 0) {
          const beforeText = bodyText.substring(0, precioListaIndex);
          // Find the last U$D price in this section (main product, not related)
          const matches = beforeText.matchAll(/U.?D[^0-9]*([0-9.,]+)/g);
          const lastMatch = Array.from(matches).pop();
          if (lastMatch) {
            data.priceRaw = 'U$D ' + lastMatch[1];
          }
        }

        // Also try to find via selector only if no price found yet
        if (!data.priceRaw) {
          const usdEls = document.querySelectorAll('div.col-12.tg-body-f18');
          for (const el of Array.from(usdEls)) {
            const text = el.textContent?.trim() || '';
            // Only use if it starts with U$D and has price (not "Comprar USD")
            if (text.startsWith('U$D') && text.match(/[\d.,]+/) && !text.includes('Comprar')) {
              data.priceRaw = text;
              break;
            }
          }
        }

        // ARS price
        const arsEls = document.querySelectorAll('div.col-12.tg-body-f10');
        Array.from(arsEls).some((el) => {
          const text = el.textContent?.trim() || '';
          if (text.startsWith('$') && !text.includes('U$D')) {
            data.priceWithIvaRaw = text;
            return true;
          }
          return false;
        });

        // Description
        const descEl = document.getElementById('divArticuloDescripcion');
        if (descEl) data.description = descEl.textContent?.trim() || '';

        // SKU
        const skuEl = document.querySelector('[id*="lblCodigo"]');
        if (skuEl) data.sku = skuEl.textContent?.trim() || '';

        // Stock
        const stockEl = document.querySelector('[id*="lblStock"]');
        if (stockEl) {
          const stockText = stockEl.textContent?.trim() || '';
          const stockMatch = stockText.match(/(\d+)/);
          data.stock = stockMatch ? parseInt(stockMatch[1], 10) : 0;
        }

        // Images
        const imageSet = new Set<string>();
        const images: string[] = [];

        const mainImg = document.getElementById('artImg') as HTMLImageElement | null;
        if (mainImg && mainImg.src && mainImg.src.includes('imagenes/')) {
          const mainSrc = mainImg.src.replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, '');
          const normalized = mainSrc.toLowerCase();
          if (!imageSet.has(normalized)) {
            imageSet.add(normalized);
            images.push(mainSrc);
          }
        }

        const artImgs = document.querySelectorAll('div.tg-img-overlay.artImg');
        artImgs.forEach((el) => {
          const src = el.getAttribute('data-src');
          if (src && src.includes('imagenes/')) {
            const clean = src.replace(/^\/+/, '');
            const normalized = clean.toLowerCase();
            if (!imageSet.has(normalized)) {
              imageSet.add(normalized);
              images.push(clean);
            }
          }
        });

        data.imageUrls = images.slice(0, 10);
        return data;
      });

      // Parse prices
      if (scraped.priceRaw) {
        const usdMatch = scraped.priceRaw.match(/U\$D\s+([\d.,]+)/);
        result.priceRaw = usdMatch ? usdMatch[1] : scraped.priceRaw;
      }
      if (scraped.priceWithIvaRaw) {
        const arsMatch = scraped.priceWithIvaRaw.match(/\$\s*([\d.,]+)/);
        result.priceWithIvaRaw = arsMatch ? arsMatch[1] : scraped.priceWithIvaRaw;
      }

      result.description = scraped.description;
      result.sku = scraped.sku;
      result.stock = scraped.stock;
      result.imageUrls = scraped.imageUrls;

      console.log(
        `[PlaywrightSingleton] ${externalId}: enriched ` +
        `| price=${result.priceRaw ?? 'N/A'} USD` +
        ` | desc=${result.description?.length ?? 0}ch`
      );

      // Reset failure counter on success
      this.resetFailureCount();
      return result;
    } catch (error: any) {
      // Track failure and try to restart browser
      await this.checkAndRestart();
      throw error;
    } finally {
      await page.close();
    }
  }

  /**
   * Extract prices from a listing page.
   */
  async extractListingPrices(idsubrubro1: number, pageNum: number): Promise<Map<string, string>> {
    const prices = new Map<string, string>();
    const url = this.baseUrl;

    const page = await this.newPage();
    try {
      await page.goto(`${url}/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=${pageNum}&conIva=1`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      await page.waitForSelector('a[href*="articulo.aspx?id="]', { timeout: 10000 }).catch(() => {});

      // Wait for prices to render (JS-rendered content needs extra time)
      await page.waitForTimeout(3000);

      const extracted = await page.evaluate(() => {
        const results: Array<{ externalId: string; priceRaw: string; fullText: string }> = [];
        const links = document.querySelectorAll('a[href*="articulo.aspx?id="]');

        links.forEach((link) => {
          const href = link.getAttribute('href') || '';
          const idMatch = href.match(/id=(\d+)/);
          if (!idMatch) return;

          const text = link.textContent?.trim() || '';
          const priceMatch = text.match(/U\$D\s+([\d.,]+)/);
          if (priceMatch) {
            results.push({ externalId: idMatch[1], priceRaw: priceMatch[1], fullText: text });
          }
        });

        return results;
      });

      // Debug: log sample texts that didn't match (first 3)
      const debugTexts = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*=\"articulo.aspx?id=\"]');
        const samples: string[] = [];
        links.forEach((link, i) => {
          if (i < 3) {
            const text = link.textContent?.trim() || '';
            const id = link.getAttribute('href')?.match(/id=(\d+)/)?.[1];
            samples.push('[' + id + '] ' + text.substring(0, 80));
          }
        });
        return samples;
      });
      if (extracted.length === 0 && debugTexts.length > 0) {
        console.log('[DEBUG] No prices found. Sample texts: ' + debugTexts.join(' | '));
      }

      for (const item of extracted) {
        prices.set(item.externalId, item.priceRaw);
      }

      console.log(`[PlaywrightSingleton] Listing prices page ${pageNum}: ${prices.size} extracted`);
      
      // Reset failure counter on success
      this.resetFailureCount();
    } catch (error: any) {
      // Track failure and try to restart browser
      await this.checkAndRestart();
      throw error;
    } finally {
      await page.close();
    }

    return prices;
  }
}

export const playwrightSingleton = PlaywrightSingleton.getInstance();