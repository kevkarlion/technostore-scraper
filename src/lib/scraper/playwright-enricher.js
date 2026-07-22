"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaywrightEnricher = void 0;
const playwright_1 = require("playwright");
/**
 * PlaywrightEnricher — navigates to each product's detail page and scrapes
 * the rendered DOM for prices, description, SKU, stock, and images.
 *
 * The supplier site (Cappelletti/jotakp) only renders price HTML when:
 *   1. The user is logged in (ASP.NET session with auth)
 *   2. A sucursal (branch) is selected in the session
 *
 * HTTP-only scraping can't get prices because the server strips price
 * elements from the HTML response. Playwright runs a real browser that
 * maintains the full session, so prices appear in the rendered DOM.
 *
 * Flow:
 *   1. Login via Playwright (fills login form directly)
 *   2. Select branch (Cipolletti, Id=1)
 *   3. For each product: navigate to articulo.aspx?id=X, scrape DOM
 */
class PlaywrightEnricher {
    constructor() {
        this.browser = null;
        this.context = null;
        this.initialized = false;
        this.baseUrl = '';
    }
    /**
     * Launch the browser. Call once before any other method.
     */
    async launch() {
        this.browser = await playwright_1.chromium.launch({ headless: true });
        this.context = await this.browser.newContext();
    }
    /**
     * Inject cookies from an external HTTP session (e.g., axios tough-cookie jar).
     * Use this if you already have an authenticated session.
     */
    async injectCookies(cookies) {
        if (!this.context)
            throw new Error('Browser not launched');
        await this.context.addCookies(cookies);
    }
    /**
     * Initialize the session: login via the actual login page, then select branch.
     * This is more reliable than injecting cookies because it lets ASP.NET
     * establish the session properly via its own forms and page lifecycle.
     *
     * Must be called once before enrichProduct().
     */
    async initSession(baseUrl, credentials) {
        if (!this.context || this.initialized)
            return;
        this.baseUrl = baseUrl;
        const page = await this.context.newPage();
        try {
            // Navigate to login page
            await page.goto(`${baseUrl}/loginext.aspx`, { waitUntil: 'networkidle', timeout: 20000 });
            if (credentials) {
                // Fill login form and submit
                await page.fill('#TxtEmail', credentials.email);
                await page.fill('#TxtPass1', credentials.password);
                // Click login button and wait for navigation
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => { }),
                    page.click('#BtnIngresar'),
                ]);
                console.log('[Playwright] Login submitted');
            }
            // Navigate to the site to establish session context
            await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 });
            // Select branch (Cipolletti, Id=1) via PageMethod
            const branchOk = await page.evaluate(async () => {
                try {
                    if (typeof window.PageMethods !== 'undefined') {
                        // Use the proper ASP.NET PageMethods
                        return await new Promise((resolve) => {
                            window.PageMethods.SeleccionarSucursal(1, (response) => {
                                // Simulate OnSuccessSelSuc callback
                                const el = document.getElementById('varIdDeposito');
                                if (el)
                                    el.value = response.IdDepositoDefecto;
                                resolve(true);
                            }, () => resolve(false));
                        });
                    }
                    // Fallback: direct fetch
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
                console.log('[Playwright] Session initialized: login OK, branch Cipolletti selected');
            }
            else {
                console.error('[Playwright] Failed to select branch');
            }
        }
        finally {
            await page.close();
        }
    }
    /**
     * Enrich a product by navigating to its detail page and scraping the DOM.
     *
     * Detail page structure (when logged in with branch selected):
     *   div.col-12.tg-body-f18        → "U$D 169,37"     (USD price, pre-IVA)
     *   div.col-12.tg-body-f10.pt-0   → "$ 255.748,70"   (ARS price)
     *   div#divArticuloDescripcion    → description text
     *   span[id*="lblCodigo"]         → SKU
     *   span[id*="lblStock"]          → stock info
     *   div.tg-img-overlay.artImg     → images (data-src attribute)
     */
    async enrichProduct(externalId, baseUrl) {
        if (!this.context)
            throw new Error('Browser not launched');
        const url = baseUrl || this.baseUrl;
        if (!url)
            throw new Error('baseUrl required — call initSession first');
        // Initialize session on first call
        if (!this.initialized) {
            await this.initSession(url);
        }
        const page = await this.context.newPage();
        try {
            await page.goto(`${url}/articulo.aspx?id=${externalId}`, {
                waitUntil: 'networkidle',
                timeout: 20000,
            });
            // Wait for price element to appear (smart wait instead of hardcoded 1.5s)
            await page.waitForSelector('div.col-12.tg-body-f18, [id*="lblStock"], #divArticuloDescripcion', {
                timeout: 5000,
            }).catch(() => { }); // Element might not exist — that's ok
            const result = {};
            // Scrape all data from the rendered DOM
            // NOTE: no inner functions — Playwright's transpiler generates __name refs that break
            const scraped = await page.evaluate(() => {
                const data = {};
                // USD price: div.col-12.tg-body-f18 → "U$D 169,37"
                const usdEl = document.querySelector('div.col-12.tg-body-f18');
                if (usdEl) {
                    data.priceRaw = usdEl.textContent?.trim() || '';
                }
                else {
                    // Fallback: look for any element with price text
                    const priceText = document.body.innerText.match(/U\$D\s*[\d.,]+/);
                    if (priceText) {
                        console.log('[Playwright] Fallback price found:', priceText[0]);
                        data.priceRaw = priceText[0];
                    }
                }
                // ARS price: div.col-12.tg-body-f10.pt-0 → "$ 255.748,70"
                const arsEls = document.querySelectorAll('div.col-12.tg-body-f10');
                Array.from(arsEls).some((el) => {
                    const text = el.textContent?.trim() || '';
                    if (text.startsWith('$') && !text.includes('U$D')) {
                        data.priceWithIvaRaw = text;
                        return true; // break
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
                // Images — main image + thumbnails (deduplicated, normalized)
                const imageSet = new Set();
                const images = [];
                // Main image: img#artImg src="imagenes/000029481.PNG"
                const mainImg = document.getElementById('artImg');
                if (mainImg && mainImg.src && mainImg.src.includes('imagenes/')) {
                    const mainSrc = mainImg.src.replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, '');
                    const normalized = mainSrc.toLowerCase();
                    if (!imageSet.has(normalized)) {
                        imageSet.add(normalized);
                        images.push(mainSrc);
                    }
                }
                // Thumbnails: div.tg-img-overlay.artImg data-src="imagenes/..."
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
            // Parse USD price: "U$D 169,37" → "169,37"
            if (scraped.priceRaw) {
                const usdMatch = scraped.priceRaw.match(/U\$D\s+([\d.,]+)/);
                result.priceRaw = usdMatch ? usdMatch[1] : scraped.priceRaw;
            }
            // Parse ARS price: "$ 255.748,70" → "255.748,70"
            if (scraped.priceWithIvaRaw) {
                const arsMatch = scraped.priceWithIvaRaw.match(/\$\s*([\d.,]+)/);
                result.priceWithIvaRaw = arsMatch ? arsMatch[1] : scraped.priceWithIvaRaw;
            }
            result.description = scraped.description;
            result.sku = scraped.sku;
            result.stock = scraped.stock;
            result.imageUrls = scraped.imageUrls;
            console.log(`[Playwright] ${externalId}: enriched ` +
                `| price=${result.priceRaw ?? 'N/A'} USD` +
                `${result.priceWithIvaRaw ? ` / $${result.priceWithIvaRaw} ARS` : ''}` +
                ` | desc=${result.description?.length ?? 0}ch` +
                ` | sku=${result.sku ?? 'N/A'}` +
                ` | stock=${result.stock ?? 'N/A'}` +
                ` | images=${result.imageUrls?.length ?? 0}`);
            return result;
        }
        finally {
            await page.close();
        }
    }
    /**
     * Extract prices from a rendered listing page.
     *
     * The supplier site renders prices via JavaScript, so HTTP-only scraping
     * can't see them. This method navigates to the listing page with Playwright,
     * waits for rendering, and extracts the U$D price from each product link.
     *
     * This is the SAME logic used by playwright-listing — reliable because the
     * price is directly in the link text ("U$D 76,21"), no fragile selectors.
     */
    async extractListingPrices(idsubrubro1, pageNum) {
        if (!this.context)
            throw new Error('Browser not launched');
        const url = this.baseUrl;
        if (!url)
            throw new Error('baseUrl required — call initSession first');
        const prices = new Map();
        const page = await this.context.newPage();
        try {
            await page.goto(`${url}/buscar.aspx?idsubrubro1=${idsubrubro1}&pag=${pageNum}&conIva=1`, {
                waitUntil: 'networkidle',
                timeout: 20000,
            });
            await page.waitForSelector('a[href*="articulo.aspx?id="]', { timeout: 10000 }).catch(() => { });
            const extracted = await page.evaluate(() => {
                const results = [];
                const links = document.querySelectorAll('a[href*="articulo.aspx?id="]');
                links.forEach((link) => {
                    const href = link.getAttribute('href') || '';
                    const idMatch = href.match(/id=(\d+)/);
                    if (!idMatch)
                        return;
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
            console.log(`[Playwright] Listing prices extracted: page ${pageNum}, ${prices.size} prices`);
        }
        finally {
            await page.close();
        }
        return prices;
    }
    /**
     * Close the browser and clean up resources.
     */
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.context = null;
            this.initialized = false;
        }
    }
}
exports.PlaywrightEnricher = PlaywrightEnricher;
