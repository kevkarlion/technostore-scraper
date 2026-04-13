/**
 * Raw product data extracted from the supplier website
 * This represents the unprocessed data before transformation
 */
export interface RawProduct {
  /** Product ID from the supplier website */
  externalId: string;
  /** Product name/title */
  name: string;
  /** Product description */
  description?: string;
  /** Product price as string (may include currency symbols, commas) */
  priceRaw?: string;
  /** Product price with IVA (tax) */
  priceWithIvaRaw?: string;
  /** Product SKU */
  sku?: string;
  /** Stock quantity as string (may include text like "in stock", "out of stock") */
  stockRaw?: string;
  /** Stock quantity as number (from detail page) */
  stock?: number;
  /** Image URLs found on the product */
  imageUrls: string[];
  /** Product categories/breadcrumbs */
  categories: string[];
  /** URL to the product detail page */
  productUrl?: string;
  /** Raw HTML element for debugging */
  rawElement?: unknown;
}

/**
 * Category configuration for scraping multiple categories
 */
export interface ScraperCategory {
  id: string;
  name: string;
  idsubrubro1: number;
  parentId: string | null;
  parent?: string;
}

/**
 * Selectors configuration for the supplier website
 */
export interface ScraperSelectors {
  login: {
    formSelector: string;
    emailInputSelector: string;
    passwordInputSelector: string;
    submitButtonSelector: string;
  };
  productList: {
    containerSelector: string;
    itemSelector: string;
    nextPageSelector: string;
  };
  product: {
    nameSelector: string;
    priceSelector: string;
    descriptionSelector?: string;
    imageSelector: string;
    skuSelector?: string;
    stockSelector?: string;
    linkSelector: string;
  };
  pagination: {
    pageParam: string;
    maxPages?: number;
  };
}

/**
 * Configuration for the scraper
 */
export interface ScraperConfig {
  supplier: string;
  baseUrl: string;
  loginUrl: string;
  email: string;
  password: string;
  delayMs: number;
  selectors: ScraperSelectors;
}

/**
 * Result of a scraper execution
 */
export interface ScraperResult {
  success: boolean;
  created: number;
  updated: number;
  errors: string[];
  durationMs: number;
  timestamp: Date;
}

/**
 * Scraper error types
 */
export class ScraperError extends Error {
  constructor(
    message: string,
    public code: "AUTH_FAILED" | "CONNECTION_ERROR" | "PARSE_ERROR" | "NETWORK_ERROR",
    public originalError?: unknown
  ) {
    super(message);
    this.name = "ScraperError";
  }
}

/**
 * Request to run scraper for a specific category
 */
export interface ScraperRunRequest {
  categoryId?: string;
  idsubrubro1?: number;
  source?: string;
}

/**
 * Status of a scraper run
 */
export type ScraperRunStatus = "in_progress" | "completed" | "failed" | "stale";

/**
 * Checkpoint data for resume functionality
 */
export interface CheckpointData {
  lastCategoryId: string | null;
  lastCategoryName: string | null;
  currentCategoryIndex: number;
  lastPageNumber: number;
  lastProductId: string | null;
  lastProductOffset: number;
  productsScraped: number;
  productsSaved: number;
}

/**
 * Statistics for a completed run
 */
export interface RunStats {
  productsScraped: number;
  productsSaved: number;
  durationMs: number;
}

/**
 * Data transfer object for creating a new scraper run
 */
export interface CreateScraperRunDTO {
  source?: string;
  categoryId?: string;
  idsubrubro1?: number;
  categoriesToProcess: string[];
}

/**
 * Scraper run entity
 */
export interface ScraperRun {
  _id?: any;
  runId: string;
  status: ScraperRunStatus;
  source?: string;
  categoryId?: string;
  requestedIdsubrubro1?: number;
  categoriesToProcess: string[];
  currentCategoryIndex: number;
  lastCategoryId: string | null;
  lastCategoryName: string | null;
  lastPageNumber: number;
  lastProductId: string | null;
  lastProductOffset: number;
  productsScraped: number;
  productsSaved: number;
  resumeCount: number;
  errorMessage?: string;
  startedAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  durationMs?: number;
}