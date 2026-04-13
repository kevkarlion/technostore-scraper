"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePrice = parsePrice;
exports.parseStock = parseStock;
exports.extractExternalId = extractExternalId;
exports.transformProduct = transformProduct;
exports.transformProducts = transformProducts;
/**
 * Parse price string to number
 * Handles formats like "$1,234.56", "1.234,56 €", "1234", etc.
 */
function parsePrice(priceRaw) {
    if (!priceRaw)
        return 0;
    // Remove currency symbols and whitespace
    var cleaned = priceRaw
        .replace(/[$€£¥₹]/g, "")
        .replace(/\s/g, "")
        .trim();
    // Handle European format (1.234,56) vs US format (1,234.56)
    var lastDotIndex = cleaned.lastIndexOf(".");
    var lastCommaIndex = cleaned.lastIndexOf(",");
    if (lastCommaIndex > lastDotIndex) {
        // European format: 1.234,56 -> 1234.56
        cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    }
    else {
        // US format: 1,234.56 -> remove commas
        cleaned = cleaned.replace(/,/g, "");
    }
    var parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
}
/**
 * Parse stock string to number
 */
function parseStock(stockRaw) {
    if (!stockRaw)
        return 0;
    var lower = stockRaw.toLowerCase();
    // Check for out of stock
    if (lower.includes("out of stock") || lower.includes("sin stock") || lower.includes("no disponible")) {
        return 0;
    }
    // Try to extract a number
    var match = stockRaw.match(/\d+/);
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
function extractExternalId(productUrl, fallbackName) {
    var urlMatch = productUrl.match(/\/(?:product|item|p)\/([a-zA-Z0-9-]+)/);
    if (urlMatch) {
        return urlMatch[1];
    }
    var queryMatch = productUrl.match(/[?&](?:id|product|p)=([a-zA-Z0-9-]+)/);
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
 * Transform raw product data to ScrapedProductDTO
 */
function transformProduct(raw, supplier) {
    var _a;
    console.log("[Transform] Input raw.priceRaw: ".concat(raw.priceRaw, ", type: ").concat(typeof raw.priceRaw));
    var price = raw.priceRaw !== undefined && raw.priceRaw !== ""
        ? parsePrice(raw.priceRaw)
        : 0;
    var stock = parseStock(raw.stockRaw);
    if (!raw.name || raw.name.trim().length === 0) {
        throw new Error("Product name is required");
    }
    if (price < 0) {
        throw new Error("Invalid price: ".concat(raw.priceRaw));
    }
    var scrapedProduct = {
        externalId: raw.externalId,
        supplier: supplier,
        name: raw.name.trim(),
        description: (_a = raw.description) === null || _a === void 0 ? void 0 : _a.trim(),
        price: price,
        priceRaw: raw.priceRaw,
        currency: "USD",
        stock: stock,
        sku: raw.sku,
        imageUrls: raw.imageUrls,
        categories: raw.categories,
        attributes: [],
        rawData: raw.rawElement ? { rawElement: "Available" } : undefined,
    };
    console.log("[Transform] Output priceRaw: ".concat(scrapedProduct.priceRaw));
    return scrapedProduct;
}
/**
 * Transform multiple raw products
 */
function transformProducts(rawProducts, supplier) {
    var products = [];
    var errors = [];
    for (var _i = 0, rawProducts_1 = rawProducts; _i < rawProducts_1.length; _i++) {
        var raw = rawProducts_1[_i];
        try {
            var transformed = transformProduct(raw, supplier);
            products.push(transformed);
        }
        catch (error) {
            var errorMessage = error instanceof Error ? error.message : "Unknown error";
            errors.push("Failed to transform product \"".concat(raw.name || raw.externalId, "\": ").concat(errorMessage));
        }
    }
    return { products: products, errors: errors };
}
