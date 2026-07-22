/**
 * Playwright Singleton — shared browser instance across all scraper services.
 * 
 * Railway has strict PID limits. Using a single browser instance instead of
 * launching multiple browsers reduces resource usage significantly.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';

const PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/home/kriq/.cache/ms-playwright';

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

    const chromiumPath = `${PLAYWRIGHT_BROWSERS_PATH}/chromium-1228/chrome-linux64/chrome`;
    console.log('[PlaywrightSingleton] Launching browser:', chromiumPath);

    this.browser = await chromium.launch({
      headless: true,
      executablePath: chromiumPath,
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
        '--single-process', // Reduce processes
        '--js-flags=--max-old-space-size=256', // Limit JS heap
      ],
    });

    this.context = await this.browser.newContext();
    console.log('[PlaywrightSingleton] Browser launched successfully');
  }

  async initSession(baseUrl: string, credentials?: { email: string; password: string }): Promise<void> {
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
    if (!this.context) throw new Error('Browser not launched');
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
      await page.goto(`${url}/articulo.aspx?id=${externalId}`, {
        waitUntil: 'networkidle',
        timeout: 20000,
      });

      await page.waitForSelector('div.col-12.tg-body-f18, [id*="lblStock"], #divArticuloDescripcion', {
        timeout: 5000,
      }).catch(() => {});

      const result: EnrichedProductData = {};

      const scraped = await page.evaluate(() => {
        const data: Record<string, any> = {};

        // USD price
        const usdEl = document.querySelector('div.col-12.tg-body-f18');
        if (usdEl) {
          data.priceRaw = usdEl.textContent?.trim() || '';
        } else {
          const priceText = document.body.innerText.match(/U\$D\s*[\d.,]+/);
          if (priceText) data.priceRaw = priceText[0];
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

      return result;
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
        timeout: 20000,
      });

      await page.waitForSelector('a[href*="articulo.aspx?id="]', { timeout: 10000 }).catch(() => {});

      const extracted = await page.evaluate(() => {
        const results: Array<{ externalId: string; priceRaw: string }> = [];
        const links = document.querySelectorAll('a[href*="articulo.aspx?id="]');

        links.forEach((link) => {
          const href = link.getAttribute('href') || '';
          const idMatch = href.match(/id=(\d+)/);
          if (!idMatch) return;

          const text = link.textContent?.trim() || '';
          const priceMatch = text.match(/U\$D\s+([\d.,]+)/);
          if (priceMatch) {
            results.push({ externalId: idMatch[1], priceRaw: priceMatch[1] });
          }
        });

        return results;
      });

      for (const item of extracted) {
        prices.set(item.externalId, item.priceRaw);
      }

      console.log(`[PlaywrightSingleton] Listing prices page ${pageNum}: ${prices.size} extracted`);
    } finally {
      await page.close();
    }

    return prices;
  }
}

export const playwrightSingleton = PlaywrightSingleton.getInstance();