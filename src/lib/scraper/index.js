"use strict";
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runIncrementalScraper = exports.preCheckCategories = exports.runScraper = exports.ScraperService = void 0;
// Re-export all scraper modules
__exportStar(require("./types"), exports);
__exportStar(require("./config"), exports);
__exportStar(require("./data-transformer"), exports);
__exportStar(require("./image-downloader"), exports);
var scraper_service_1 = require("./scraper.service");
Object.defineProperty(exports, "ScraperService", { enumerable: true, get: function () { return scraper_service_1.ScraperService; } });
Object.defineProperty(exports, "runScraper", { enumerable: true, get: function () { return scraper_service_1.runScraper; } });
var incremental_scraper_service_1 = require("./incremental-scraper.service");
Object.defineProperty(exports, "preCheckCategories", { enumerable: true, get: function () { return incremental_scraper_service_1.preCheckCategories; } });
Object.defineProperty(exports, "runIncrementalScraper", { enumerable: true, get: function () { return incremental_scraper_service_1.runIncrementalScraper; } });
