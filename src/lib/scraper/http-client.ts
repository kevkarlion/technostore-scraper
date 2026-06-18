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

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import * as tough from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import { getScraperConfig } from './config';
import type { ScraperConfig } from './types';

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_TIMEOUT = 30_000;       // 30s
const DEFAULT_DELAY_MS = 3_000;       // 3s between requests
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2_000;

// ============================================================================
// COOKIE JAR + AXIOS INSTANCE
// ============================================================================

/**
 * Create an axios instance with cookie jar support.
 * Each scraper run typically creates one instance so the login session
 * is shared across pre-check and category scraping.
 */
export function createHttpClient(config?: ScraperConfig): AxiosInstance {
  const cfg = config || getScraperConfig();
  const cookieJar = new tough.CookieJar();

  const instance = axios.create({
    baseURL: cfg.baseUrl,
    timeout: DEFAULT_TIMEOUT,
    withCredentials: true,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
    },
    maxRedirects: 5,
    validateStatus: (status) => status < 400, // Treat redirects as errors we handle
  });

  // Wrap with cookie jar support
  const wrapped = wrapper(instance);
  (wrapped.defaults as any).jar = cookieJar;

  return wrapped;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Delay helper — returns a promise that resolves after `ms`.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get the configured delay in ms.
 */
export function getRequestDelay(): number {
  return parseInt(process.env.SUPPLIER_DELAY_MS || String(DEFAULT_DELAY_MS), 10);
}

/**
 * Safe GET request with retry logic.
 * Returns the response data (string) or throws after exhausting retries.
 */
export async function safeGet(
  client: AxiosInstance,
  urlOrPath: string,
  retries: number = MAX_RETRIES,
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await delay(getRequestDelay());
      const response = await client.get(urlOrPath, {
        responseType: 'text',
        transformResponse: [(data) => data], // Raw HTML, no JSON parsing
      });
      return response.data as string;
    } catch (error: any) {
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
export async function safePost(
  client: AxiosInstance,
  urlOrPath: string,
  body: Record<string, string>,
  retries: number = MAX_RETRIES,
): Promise<string> {
  let lastError: Error | null = null;

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
      return response.data as string;
    } catch (error: any) {
      lastError = error;
      console.log(`[HTTP] POST ${urlOrPath} failed (attempt ${attempt}/${retries}): ${error.message}`);

      if (attempt < retries) {
        await delay(RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError || new Error(`POST ${urlOrPath} failed after ${retries} retries`);
}
