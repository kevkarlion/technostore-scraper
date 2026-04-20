import type { RawProduct } from "./types";

/**
 * Parse price string to number
 * Handles formats like "$1,234.56", "1.234,56 €", "1234", etc.
 */
export function parsePrice(priceRaw: string): number {
  if (!priceRaw) return 0;

  // Remove currency symbols and whitespace
  let cleaned = priceRaw
    .replace(/[$€£¥₹]/g, "")
    .replace(/\s/g, "")
    .trim();

  // Handle European format (1.234,56) vs US format (1,234.56)
  const lastDotIndex = cleaned.lastIndexOf(".");
  const lastCommaIndex = cleaned.lastIndexOf(",");

  if (lastCommaIndex > lastDotIndex) {
    // European format: 1.234,56 -> 1234.56
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    // US format: 1,234.56 -> remove commas
    cleaned = cleaned.replace(/,/g, "");
  }

  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Parse stock string to number
 */
export function parseStock(stockRaw?: string): number {
  if (!stockRaw) return 0;

  const lower = stockRaw.toLowerCase();

  // Check for out of stock
  if (lower.includes("out of stock") || lower.includes("sin stock") || lower.includes("no disponible")) {
    return 0;
  }

  // Try to extract a number
  const match = stockRaw.match(/\d+/);
  if (match) {
    return parseInt(match[0], 10);
  }

  // If it says "in stock" but no number, assume available
  if (lower.includes("in stock") || lower.includes("disponible") || lower.includes("available")) {
    return 1;
  }

  return 0;
}

/**
 * Extract product ID from URL
 */
export function extractExternalId(productUrl: string, fallbackName: string): string {
  const urlMatch = productUrl.match(/\/(?:product|item|p)\/([a-zA-Z0-9-]+)/);
  if (urlMatch) {
    return urlMatch[1];
  }

  const queryMatch = productUrl.match(/[?&](?:id|product|p)=([a-zA-Z0-9-]+)/);
  if (queryMatch) {
    return queryMatch[1];
  }

  // Fallback: slugified name
  return fallbackName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Interface for scraped product data (matches what we'll save to DB)
 */
export interface ScrapedProductDTO {
  externalId: string;
  supplier: string;
  name: string;
  description?: string;
  price: number;
  priceRaw?: string;
  currency: string;
  stock: number;
  sku?: string;
  imageUrls: string[];
  cloudinaryUrls?: string[];
  categories: string[];
  attributes: unknown[];
  rawData?: unknown;
}

/**
 * Transform raw product data to ScrapedProductDTO
 */
export function transformProduct(raw: RawProduct, supplier: string): ScrapedProductDTO {
  console.log(`[Transform] Input raw.priceRaw: ${raw.priceRaw}, type: ${typeof raw.priceRaw}`);

  const price = raw.priceRaw !== undefined && raw.priceRaw !== ""
    ? parsePrice(raw.priceRaw)
    : 0;

  const stock = parseStock(raw.stockRaw);

  if (!raw.name || raw.name.trim().length === 0) {
    throw new Error("Product name is required");
  }

  if (price < 0) {
    throw new Error(`Invalid price: ${raw.priceRaw}`);
  }

  const scrapedProduct: ScrapedProductDTO = {
    externalId: raw.externalId,
    supplier,
    name: raw.name.trim(),
    description: raw.description?.trim(),
    price,
    priceRaw: raw.priceRaw,
    currency: "USD",
    stock,
    sku: raw.sku,
    imageUrls: raw.imageUrls,
    categories: raw.categories,
    attributes: [],
    rawData: raw.rawElement ? { rawElement: "Available" } : undefined,
  };

  console.log(`[Transform] Output priceRaw: ${scrapedProduct.priceRaw}`);

  return scrapedProduct;
}

/**
 * Transform multiple raw products
 */
export function transformProducts(
  rawProducts: RawProduct[],
  supplier: string
): { products: ScrapedProductDTO[]; errors: string[] } {
  const products: ScrapedProductDTO[] = [];
  const errors: string[] = [];

  for (const raw of rawProducts) {
    try {
      const transformed = transformProduct(raw, supplier);
      products.push(transformed);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      errors.push(`Failed to transform product "${raw.name || raw.externalId}": ${errorMessage}`);
    }
  }

  return { products, errors };
}