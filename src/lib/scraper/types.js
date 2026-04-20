"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScraperError = void 0;
/**
 * Scraper error types
 */
class ScraperError extends Error {
    constructor(message, code, originalError) {
        super(message);
        this.code = code;
        this.originalError = originalError;
        this.name = "ScraperError";
    }
}
exports.ScraperError = ScraperError;
