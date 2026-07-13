"use strict";
/**
 * HTTP client for supplier scraping.
 *
 * Replaces Playwright/Chromium with axios + cheerio + tough-cookie.
 * Maintains a cookie jar for session persistence across requests (login→scrape).
 *
 * Design:
 *   - Singleton axios instance per module (or per request when isolated).
 *   - Cookie jar preserves the ASP.NET session across GET/POST requests.
 *   - Configurable delay between requests to avoid overwhelming the supplier.
 *   - Retry logic with exponential backoff for transient failures.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHttpClient = createHttpClient;
exports.delay = delay;
exports.getRequestDelay = getRequestDelay;
exports.safeGet = safeGet;
exports.safePost = safePost;
const axios_1 = __importDefault(require("axios"));
const tough = __importStar(require("tough-cookie"));
const axios_cookiejar_support_1 = require("axios-cookiejar-support");
const config_1 = require("./config");
// ============================================================================
// DEFAULT CONFIG
// ============================================================================
const DEFAULT_TIMEOUT = 30000; // 30s
const DEFAULT_DELAY_MS = 500; // 500ms between requests
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
// ============================================================================
// COOKIE JAR + AXIOS INSTANCE
// ============================================================================
/**
 * Create an axios instance with cookie jar support.
 * Each scraper run typically creates one instance so the login session
 * is shared across pre-check and category scraping.
 */
function createHttpClient(config) {
    const cfg = config || (0, config_1.getScraperConfig)();
    const cookieJar = new tough.CookieJar();
    const instance = axios_1.default.create({
        baseURL: cfg.baseUrl,
        timeout: DEFAULT_TIMEOUT,
        withCredentials: true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
            'Cache-Control': 'no-cache',
        },
        maxRedirects: 5,
        validateStatus: (status) => status < 400, // Treat redirects as errors we handle
    });
    // Wrap with cookie jar support
    const wrapped = (0, axios_cookiejar_support_1.wrapper)(instance);
    wrapped.defaults.jar = cookieJar;
    return wrapped;
}
// ============================================================================
// HELPERS
// ============================================================================
/**
 * Delay helper — returns a promise that resolves after `ms`.
 */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Get the configured delay in ms.
 */
function getRequestDelay() {
    return parseInt(process.env.SUPPLIER_DELAY_MS || String(DEFAULT_DELAY_MS), 10);
}
/**
 * Safe GET request with retry logic.
 * Returns the response data (string) or throws after exhausting retries.
 * @param delayMs - Override the default delay (e.g. 100ms for lightweight pre-checks)
 */
async function safeGet(client, urlOrPath, retries = MAX_RETRIES, delayMs) {
    let lastError = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await delay(delayMs ?? getRequestDelay());
            const response = await client.get(urlOrPath, {
                responseType: 'text',
                transformResponse: [(data) => data], // Raw HTML, no JSON parsing
            });
            return response.data;
        }
        catch (error) {
            lastError = error;
            console.log(`[HTTP] GET ${urlOrPath} failed (attempt ${attempt}/${retries}): ${error.message}`);
            if (attempt < retries) {
                await delay(RETRY_DELAY_MS * attempt); // Exponential backoff
            }
        }
    }
    throw lastError || new Error(`GET ${urlOrPath} failed after ${retries} retries`);
}
/**
 * Safe POST request with retry logic.
 * Returns the response data (string) or throws after exhausting retries.
 */
async function safePost(client, urlOrPath, body, retries = MAX_RETRIES) {
    let lastError = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await delay(getRequestDelay());
            const response = await client.post(urlOrPath, new URLSearchParams(body), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                responseType: 'text',
                transformResponse: [(data) => data],
            });
            return response.data;
        }
        catch (error) {
            lastError = error;
            console.log(`[HTTP] POST ${urlOrPath} failed (attempt ${attempt}/${retries}): ${error.message}`);
            if (attempt < retries) {
                await delay(RETRY_DELAY_MS * attempt);
            }
        }
    }
    throw lastError || new Error(`POST ${urlOrPath} failed after ${retries} retries`);
}
