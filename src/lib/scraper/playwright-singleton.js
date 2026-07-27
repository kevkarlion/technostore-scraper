"use strict";
/**
 * Playwright Singleton — shared browser instance across all scraper services.
 *
 * Railway has strict PID limits. Using a single browser instance instead of
 * launching multiple browsers reduces resource usage significantly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.playwrightSingleton = void 0;
const playwright_1 = require("playwright");
const PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/home/kriq/.cache/ms-playwright';
class PlaywrightSingleton {
    constructor() {
        this.browser = null;
        this.context = null;
        this.initialized = false;
        this.baseUrl = '';
        this.launchPromise = null;
        this.initPromise = null;
        // Failure tracking for auto-restart
        this.failureCount = 0;
        this.lastFailureTime = 0;
        this.FAILURE_THRESHOLD = 3; // Restart after 3 consecutive failures
        this.FAILURE_WINDOW_MS = 60000; // Within 1 minute
    }
    static getInstance() {
        if (!PlaywrightSingleton.instance) {
            PlaywrightSingleton.instance = new PlaywrightSingleton();
        }
        return PlaywrightSingleton.instance;
    }
    async launch() {
        // Already launched
        if (this.browser)
            return;
        // Prevent concurrent launches
        if (this.launchPromise) {
            await this.launchPromise;
            return;
        }
        this.launchPromise = this._doLaunch();
        await this.launchPromise;
        this.launchPromise = null;
    }
    async _doLaunch() {
        if (this.browser)
            return;
        const chromiumPath = `${PLAYWRIGHT_BROWSERS_PATH}/chromium-1228/chrome-linux64/chrome`;
        console.log('[PlaywrightSingleton] Launching browser:', chromiumPath);
        this.browser = await playwright_1.chromium.launch({
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
    async initSession(baseUrl, credentials) {
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
    async _doInitSession(baseUrl, credentials) {
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
                    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => { }),
                    page.click('#BtnIngresar'),
                ]);
                console.log('[PlaywrightSingleton] Login submitted');
            }
            // Navigate to site to establish session
            await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 });
            // Select branch (Cipolletti, Id=1)
            const branchOk = await page.evaluate(async () => {
                try {
                    if (typeof window.PageMethods !== 'undefined') {
                        return await new Promise((resolve) => {
                            window.PageMethods.SeleccionarSucursal(1, (response) => {
                                const el = document.getElementById('varIdDeposito');
                                if (el)
                                    el.value = response.IdDepositoDefecto;
                                resolve(true);
                            }, () => resolve(false));
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
                }
                catch {
                    return false;
                }
            });
            if (branchOk) {
                this.initialized = true;
                console.log('[PlaywrightSingleton] Session initialized: login OK, branch Cipolletti selected');
            }
            else {
                console.error('[PlaywrightSingleton] Failed to select branch');
            }
        }
        finally {
            await page.close();
        }
    }
    async newPage() {
        if (!this.context)
            throw new Error('Browser not launched');
        return this.context.newPage();
    }
    isInitialized() {
        return this.initialized;
    }
    getBaseUrl() {
        return this.baseUrl;
    }
    async close() {
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
    async checkAndRestart() {
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
    resetFailureCount() {
        this.failureCount = 0;
    }
    // ============================================================================
    // ENRICHMENT METHODS (delegated from PlaywrightEnricher)
    // ============================================================================
    /**
     * Enrich a product by navigating to its detail page.
     */
    async enrichProduct(externalId, baseUrl) {
        const url = baseUrl || this.baseUrl;
        if (!url)
            throw new Error('baseUrl required — call initSession first');
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
            }).catch(() => { });
            const result = {};
            const scraped = await page.evaluate(() => {
                const data = {};
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
                if (descEl)
                    data.description = descEl.textContent?.trim() || '';
                // SKU
                const skuEl = document.querySelector('[id*="lblCodigo"]');
                if (skuEl)
                    data.sku = skuEl.textContent?.trim() || '';
                // Stock
                const stockEl = document.querySelector('[id*="lblStock"]');
                if (stockEl) {
                    const stockText = stockEl.textContent?.trim() || '';
                    const stockMatch = stockText.match(/(\d+)/);
                    data.stock = stockMatch ? parseInt(stockMatch[1], 10) : 0;
                }
                // Images
                const imageSet = new Set();
                const images = [];
                const mainImg = document.getElementById('artImg');
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
            console.log(`[PlaywrightSingleton] ${externalId}: enriched ` +
                `| price=${result.priceRaw ?? 'N/A'} USD` +
                ` | desc=${result.description?.length ?? 0}ch`);
            // Reset failure counter on success
            this.resetFailureCount();
            return result;
        }
        catch (error) {
            // Track failure and try to restart browser
            await this.checkAndRestart();
            throw error;
        }
        finally {
            await page.close();
        }
    }
    /**
     * Extract prices from a listing page.
     */
    async extractListingPrices(idsubrubro1, pageNum) {
        const prices = new Map();
        const url = this.baseUrl;
        const page = await this.newPage();
        try {
            await page.goto(`${url}/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=${pageNum}&conIva=1`, {
                waitUntil: 'networkidle',
                timeout: 30000,
            });
            await page.waitForSelector('a[href*="articulo.aspx?id="]', { timeout: 10000 }).catch(() => { });
            // Wait for prices to render (JS-rendered content needs extra time)
            await page.waitForTimeout(3000);
            const extracted = await page.evaluate(() => {
                const results = [];
                const links = document.querySelectorAll('a[href*="articulo.aspx?id="]');
                links.forEach((link) => {
                    const href = link.getAttribute('href') || '';
                    const idMatch = href.match(/id=(\d+)/);
                    if (!idMatch)
                        return;
                    const text = link.textContent?.trim() || '';
                    // Debug: log what we're seeing
                    if (text.includes('Comprar USD') || text.includes('U$D')) {
                        console.log('[DEBUG] Found link text:', text.substring(0, 100));
                    }
                    const priceMatch = text.match(/U\$D\s+([\d.,]+)/);
                    if (priceMatch) {
                        results.push({ externalId: idMatch[1], priceRaw: priceMatch[1], fullText: text });
                    }
                });
                return results;
            });
            for (const item of extracted) {
                prices.set(item.externalId, item.priceRaw);
            }
            console.log(`[PlaywrightSingleton] Listing prices page ${pageNum}: ${prices.size} extracted`);
            // Reset failure counter on success
            this.resetFailureCount();
        }
        catch (error) {
            // Track failure and try to restart browser
            await this.checkAndRestart();
            throw error;
        }
        finally {
            await page.close();
        }
        return prices;
    }
}
exports.playwrightSingleton = PlaywrightSingleton.getInstance();
