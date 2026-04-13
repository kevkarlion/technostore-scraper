"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScraperService = void 0;
exports.runScraper = runScraper;
var playwright_1 = require("playwright");
var config_1 = require("./config");
var data_transformer_1 = require("./data-transformer");
var image_downloader_1 = require("./image-downloader");
var types_1 = require("./types");
var path_1 = __importDefault(require("path"));
var os_1 = __importDefault(require("os"));
var mongodb_1 = require("mongodb");
// Get DB - try global first, then direct connection
var dbInstance = null;
var mongoClient = null;
function getDb() {
    return __awaiter(this, void 0, void 0, function () {
        var MONGO_URI, DB_NAME;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    // First try global (from Express server)
                    if (global.db) {
                        return [2 /*return*/, global.db];
                    }
                    if (!!dbInstance) return [3 /*break*/, 2];
                    MONGO_URI = process.env.MONGO_URI;
                    DB_NAME = process.env.DB_NAME || "technostore";
                    if (!MONGO_URI) {
                        throw new Error("MONGO_URI is required");
                    }
                    mongoClient = new mongodb_1.MongoClient(MONGO_URI);
                    return [4 /*yield*/, mongoClient.connect()];
                case 1:
                    _a.sent();
                    dbInstance = mongoClient.db(DB_NAME);
                    _a.label = 2;
                case 2: return [2 /*return*/, dbInstance];
            }
        });
    });
}
var productRepository = {
    upsert: function (product) {
        return __awaiter(this, void 0, void 0, function () {
            var db, collection, existing, changed, _i, _a, _b, key, value;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0: return [4 /*yield*/, getDb()];
                    case 1:
                        db = _c.sent();
                        collection = db.collection('products');
                        return [4 /*yield*/, collection.findOne({ externalId: product.externalId, supplier: 'jotakp' })];
                    case 2:
                        existing = _c.sent();
                        if (!existing) return [3 /*break*/, 5];
                        changed = {};
                        for (_i = 0, _a = Object.entries(product); _i < _a.length; _i++) {
                            _b = _a[_i], key = _b[0], value = _b[1];
                            if (JSON.stringify(existing[key]) !== JSON.stringify(value)) {
                                changed[key] = value;
                            }
                        }
                        if (!(Object.keys(changed).length > 0)) return [3 /*break*/, 4];
                        return [4 /*yield*/, collection.updateOne({ _id: existing._id }, { $set: __assign(__assign({}, changed), { lastSyncedAt: new Date() }) })];
                    case 3:
                        _c.sent();
                        return [2 /*return*/, { created: false, updated: true }];
                    case 4: return [2 /*return*/, { created: false, updated: false }];
                    case 5: return [4 /*yield*/, collection.insertOne(__assign(__assign({}, product), { supplier: 'jotakp', status: 'active', createdAt: new Date(), updatedAt: new Date() }))];
                    case 6:
                        _c.sent();
                        return [2 /*return*/, { created: true, updated: false }];
                }
            });
        });
    },
    atomicUpsertByExternalId: function (product) {
        return __awaiter(this, void 0, void 0, function () {
            var db, collection, now, existing, changes, updateOps, fieldsToCompare, _i, fieldsToCompare_1, field, existingVal, newVal;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, getDb()];
                    case 1:
                        db = _a.sent();
                        collection = db.collection('products');
                        now = new Date();
                        return [4 /*yield*/, collection.findOne({ externalId: product.externalId, supplier: product.supplier || 'jotakp' })];
                    case 2:
                        existing = _a.sent();
                        if (!!existing) return [3 /*break*/, 4];
                        return [4 /*yield*/, collection.insertOne(__assign(__assign({}, product), { supplier: product.supplier || 'jotakp', status: 'active', lastSyncedAt: now, createdAt: now, updatedAt: now }))];
                    case 3:
                        _a.sent();
                        return [2 /*return*/, { created: true, updated: false, changes: ['CREATE'] }];
                    case 4:
                        changes = [];
                        updateOps = { lastSyncedAt: now, updatedAt: now };
                        fieldsToCompare = ['name', 'description', 'price', 'priceRaw', 'currency', 'stock', 'sku', 'categories', 'imageUrls'];
                        for (_i = 0, fieldsToCompare_1 = fieldsToCompare; _i < fieldsToCompare_1.length; _i++) {
                            field = fieldsToCompare_1[_i];
                            existingVal = existing[field];
                            newVal = product[field];
                            if (JSON.stringify(existingVal) !== JSON.stringify(newVal) && newVal !== undefined) {
                                updateOps[field] = newVal;
                                changes.push(field);
                            }
                        }
                        if (!(changes.length > 0)) return [3 /*break*/, 6];
                        return [4 /*yield*/, collection.updateOne({ _id: existing._id }, { $set: updateOps })];
                    case 5:
                        _a.sent();
                        return [2 /*return*/, { created: false, updated: true, changes: changes }];
                    case 6: return [2 /*return*/, { created: false, updated: false, changes: [] }];
                }
            });
        });
    },
    markDiscontinued: function (supplier, scrapedIds) {
        return __awaiter(this, void 0, void 0, function () {
            var db, result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, getDb()];
                    case 1:
                        db = _a.sent();
                        return [4 /*yield*/, db.collection('products').updateMany({ supplier: supplier, externalId: { $nin: scrapedIds }, status: 'active' }, { $set: { status: 'discontinued', discontinuedAt: new Date() } })];
                    case 2:
                        result = _a.sent();
                        return [2 /*return*/, result.modifiedCount];
                }
            });
        });
    },
    ensureIndexes: function () {
        return __awaiter(this, void 0, void 0, function () {
            var db, collection;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, getDb()];
                    case 1:
                        db = _a.sent();
                        collection = db.collection('products');
                        return [4 /*yield*/, collection.createIndex({ externalId: 1, supplier: 1 }, { unique: true })];
                    case 2:
                        _a.sent();
                        return [4 /*yield*/, collection.createIndex({ supplier: 1, status: 1 })];
                    case 3:
                        _a.sent();
                        return [4 /*yield*/, collection.createIndex({ categories: 1 })];
                    case 4:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    }
};
var scraperRunRepository = {
    create: function (run) {
        return __awaiter(this, void 0, void 0, function () {
            var db;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, getDb()];
                    case 1:
                        db = _a.sent();
                        return [4 /*yield*/, db.collection('scraper_runs').insertOne(__assign(__assign({}, run), { createdAt: new Date() }))];
                    case 2: return [2 /*return*/, _a.sent()];
                }
            });
        });
    },
    update: function (runId, updates) {
        return __awaiter(this, void 0, void 0, function () {
            var db;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, getDb()];
                    case 1:
                        db = _a.sent();
                        return [4 /*yield*/, db.collection('scraper_runs').updateOne({ runId: runId }, { $set: updates })];
                    case 2: return [2 /*return*/, _a.sent()];
                }
            });
        });
    },
    ensureIndexes: function () {
        return __awaiter(this, void 0, void 0, function () {
            var db, collection;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, getDb()];
                    case 1:
                        db = _a.sent();
                        collection = db.collection('scraper_runs');
                        return [4 /*yield*/, collection.createIndex({ runId: 1 }, { unique: true })];
                    case 2:
                        _a.sent();
                        return [4 /*yield*/, collection.createIndex({ status: 1 })];
                    case 3:
                        _a.sent();
                        return [4 /*yield*/, collection.createIndex({ createdAt: -1 })];
                    case 4:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    },
    cleanupStaleRuns: function (hoursOld) {
        return __awaiter(this, void 0, void 0, function () {
            var db, cutoff, result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, getDb()];
                    case 1:
                        db = _a.sent();
                        cutoff = new Date(Date.now() - hoursOld * 60 * 60 * 1000);
                        return [4 /*yield*/, db.collection('scraper_runs').updateMany({ status: 'in_progress', updatedAt: { $lt: cutoff } }, { $set: { status: 'stale' } })];
                    case 2:
                        result = _a.sent();
                        return [2 /*return*/, result.modifiedCount];
                }
            });
        });
    },
    findIncomplete: function () {
        return __awaiter(this, void 0, void 0, function () {
            var db;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, getDb()];
                    case 1:
                        db = _a.sent();
                        return [2 /*return*/, db.collection('scraper_runs').findOne({ status: 'in_progress' })];
                }
            });
        });
    },
    incrementResumeCount: function (runId) {
        return __awaiter(this, void 0, void 0, function () {
            var db;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, getDb()];
                    case 1:
                        db = _a.sent();
                        return [4 /*yield*/, db.collection('scraper_runs').updateOne({ runId: runId }, { $inc: { resumeCount: 1 }, $set: { updatedAt: new Date() } })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    },
    markCompleted: function (runId, stats) {
        return __awaiter(this, void 0, void 0, function () {
            var db;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, getDb()];
                    case 1:
                        db = _a.sent();
                        return [4 /*yield*/, db.collection('scraper_runs').updateOne({ runId: runId }, {
                                $set: {
                                    status: 'completed',
                                    completedAt: new Date(),
                                    productsScraped: stats.productsScraped,
                                    productsSaved: stats.productsSaved,
                                    durationMs: stats.durationMs,
                                    updatedAt: new Date()
                                }
                            })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    },
    markFailed: function (runId, error) {
        return __awaiter(this, void 0, void 0, function () {
            var db;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, getDb()];
                    case 1:
                        db = _a.sent();
                        return [4 /*yield*/, db.collection('scraper_runs').updateOne({ runId: runId }, { $set: { status: 'failed', errorMessage: error, updatedAt: new Date() } })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    },
    updateCheckpoint: function (runId, checkpoint) {
        return __awaiter(this, void 0, void 0, function () {
            var db;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, getDb()];
                    case 1:
                        db = _a.sent();
                        return [4 /*yield*/, db.collection('scraper_runs').updateOne({ runId: runId }, { $set: __assign(__assign({}, checkpoint), { updatedAt: new Date() }) })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    }
};
// Find playwright chromium executable in various locations
function getChromiumExecutable() {
    return __awaiter(this, void 0, void 0, function () {
        var fs, execSync, possiblePaths, _i, possiblePaths_1, p, downloadDir, newPaths, _a, newPaths_1, p;
        return __generator(this, function (_b) {
            fs = require("fs");
            execSync = require("child_process").execSync;
            possiblePaths = [
                // Vercel cache
                "/vercel/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome",
                "/vercel/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell",
                // Vercel sandbox user
                "/home/sbx_user1051/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome",
                "/home/sbx_user1051/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell",
                // HOME fallback
                path_1.default.join(os_1.default.homedir() || "/root", ".cache", "ms-playwright", "chromium-1208", "chrome-linux64", "chrome"),
            ];
            console.log("[Scraper] Looking for chromium...");
            for (_i = 0, possiblePaths_1 = possiblePaths; _i < possiblePaths_1.length; _i++) {
                p = possiblePaths_1[_i];
                try {
                    console.log("[Scraper] Checking:", p);
                    if (p && fs.existsSync(p)) {
                        console.log("[Scraper] Found chromium at:", p);
                        return [2 /*return*/, p];
                    }
                }
                catch (e) {
                    console.log("[Scraper] Error checking path:", e);
                }
            }
            // Try download to /tmp
            console.log("[Scraper] No chromium found in cache, downloading at runtime...");
            try {
                downloadDir = "/tmp/playwright-browsers";
                try {
                    fs.mkdirSync(downloadDir, { recursive: true });
                }
                catch (_c) { }
                execSync("npx playwright install chromium", {
                    stdio: "inherit",
                    env: __assign(__assign({}, process.env), { PLAYWRIGHT_BROWSERS_PATH: downloadDir }),
                    cwd: "/tmp"
                });
                newPaths = [
                    path_1.default.join(downloadDir, "ms-playwright", "chromium-1208", "chrome-linux64", "chrome"),
                    path_1.default.join(downloadDir, "chromium-1208", "chrome-linux64", "chrome"),
                ];
                for (_a = 0, newPaths_1 = newPaths; _a < newPaths_1.length; _a++) {
                    p = newPaths_1[_a];
                    if (p && fs.existsSync(p)) {
                        console.log("[Scraper] Downloaded chromium found at:", p);
                        return [2 /*return*/, p];
                    }
                }
            }
            catch (e) {
                console.log("[Scraper] Failed to download chromium:", e);
            }
            return [2 /*return*/, undefined];
        });
    });
}
/**
 * Retry configuration
 */
var MAX_RETRIES = 3;
var RETRY_DELAY_MS = 3000;
var PAGE_NAVIGATION_TIMEOUT = 45000; // 45 segundos para páginas complejas
/**
 * Maximum number of parallel pages for detail scraping
 */
var MAX_PARALLEL_PAGES = 3;
/**
 * Track open pages for cleanup
 */
var openPages = [];
var ScraperService = /** @class */ (function () {
    function ScraperService(config, request) {
        this.browser = null;
        this.context = null;
        this.currentRun = null;
        this.currentCategoryIndex = 0;
        this.currentPageNum = 1;
        this.productsScrapedCount = 0;
        this.productsSavedCount = 0;
        this.config = config || (0, config_1.getScraperConfig)();
        this.request = request || {};
    }
    // ============================================================================
    // HELPER FUNCTIONS - Safe Browser/Page Management
    // ============================================================================
    /**
     * Register a page for tracking (to close later)
     */
    ScraperService.prototype.trackPage = function (page) {
        var _a;
        openPages.push(page);
        // Clean up old closed pages
        while (openPages.length > 0 && ((_a = openPages[0]) === null || _a === void 0 ? void 0 : _a.isClosed())) {
            openPages.shift();
        }
    };
    /**
     * Close all tracked pages
     */
    ScraperService.prototype.closeTrackedPages = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _i, openPages_1, page, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _i = 0, openPages_1 = openPages;
                        _b.label = 1;
                    case 1:
                        if (!(_i < openPages_1.length)) return [3 /*break*/, 7];
                        page = openPages_1[_i];
                        _b.label = 2;
                    case 2:
                        _b.trys.push([2, 5, , 6]);
                        if (!!page.isClosed()) return [3 /*break*/, 4];
                        return [4 /*yield*/, page.close()];
                    case 3:
                        _b.sent();
                        _b.label = 4;
                    case 4: return [3 /*break*/, 6];
                    case 5:
                        _a = _b.sent();
                        return [3 /*break*/, 6];
                    case 6:
                        _i++;
                        return [3 /*break*/, 1];
                    case 7:
                        openPages.length = 0;
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Create or reuse a page from the context
     * Includes browser connection check and auto-reconnect
     */
    ScraperService.prototype.getPage = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, _b, validPages, _i, openPages_2, page_1, page;
            var _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        if (!(!this.browser || !this.browser.isConnected())) return [3 /*break*/, 2];
                        console.log("[Scraper] Browser disconnected in getPage, reconnecting...");
                        return [4 /*yield*/, this.reconnectBrowser()];
                    case 1:
                        _d.sent();
                        _d.label = 2;
                    case 2:
                        if (!(!this.context || !((_c = this.context.browser()) === null || _c === void 0 ? void 0 : _c.isConnected()))) return [3 /*break*/, 9];
                        _d.label = 3;
                    case 3:
                        _d.trys.push([3, 6, , 7]);
                        if (!this.context) return [3 /*break*/, 5];
                        return [4 /*yield*/, this.context.close()];
                    case 4:
                        _d.sent();
                        _d.label = 5;
                    case 5: return [3 /*break*/, 7];
                    case 6:
                        _a = _d.sent();
                        return [3 /*break*/, 7];
                    case 7:
                        _b = this;
                        return [4 /*yield*/, this.browser.newContext()];
                    case 8:
                        _b.context = _d.sent();
                        _d.label = 9;
                    case 9:
                        validPages = [];
                        for (_i = 0, openPages_2 = openPages; _i < openPages_2.length; _i++) {
                            page_1 = openPages_2[_i];
                            try {
                                if (!page_1.isClosed()) {
                                    validPages.push(page_1);
                                }
                            }
                            catch ( /* ignore */_e) { /* ignore */ }
                        }
                        openPages.length = 0;
                        openPages.push.apply(openPages, validPages);
                        return [4 /*yield*/, this.context.newPage()];
                    case 10:
                        page = _d.sent();
                        this.trackPage(page);
                        return [2 /*return*/, page];
                }
            });
        });
    };
    /**
     * Safe page navigation with retry logic
     */
    ScraperService.prototype.safeGoto = function (page_2, url_1) {
        return __awaiter(this, arguments, void 0, function (page, url, retries) {
            var attempt, error_1, _a;
            if (retries === void 0) { retries = MAX_RETRIES; }
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        attempt = 1;
                        _b.label = 1;
                    case 1:
                        if (!(attempt <= retries)) return [3 /*break*/, 13];
                        _b.label = 2;
                    case 2:
                        _b.trys.push([2, 6, , 12]);
                        if (!(!page || page.isClosed())) return [3 /*break*/, 4];
                        return [4 /*yield*/, this.getPage()];
                    case 3:
                        page = _b.sent();
                        _b.label = 4;
                    case 4: return [4 /*yield*/, page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_NAVIGATION_TIMEOUT })];
                    case 5:
                        _b.sent();
                        return [2 /*return*/, true];
                    case 6:
                        error_1 = _b.sent();
                        console.log("[Scraper] Error navigating (attempt ".concat(attempt, "/").concat(retries, "):"), error_1);
                        if (!(attempt < retries)) return [3 /*break*/, 11];
                        return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, RETRY_DELAY_MS); })];
                    case 7:
                        _b.sent();
                        _b.label = 8;
                    case 8:
                        _b.trys.push([8, 10, , 11]);
                        return [4 /*yield*/, this.getPage()];
                    case 9:
                        page = _b.sent();
                        return [3 /*break*/, 11];
                    case 10:
                        _a = _b.sent();
                        return [3 /*break*/, 11];
                    case 11: return [3 /*break*/, 12];
                    case 12:
                        attempt++;
                        return [3 /*break*/, 1];
                    case 13: return [2 /*return*/, false];
                }
            });
        });
    };
    /**
     * Safe page content retrieval with retry
     */
    ScraperService.prototype.safeContent = function (page_2) {
        return __awaiter(this, arguments, void 0, function (page, retries) {
            var attempt, error_2;
            if (retries === void 0) { retries = MAX_RETRIES; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        attempt = 1;
                        _a.label = 1;
                    case 1:
                        if (!(attempt <= retries)) return [3 /*break*/, 8];
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, , 7]);
                        if (!page || page.isClosed()) {
                            return [2 /*return*/, null];
                        }
                        return [4 /*yield*/, page.content()];
                    case 3: return [2 /*return*/, _a.sent()];
                    case 4:
                        error_2 = _a.sent();
                        if (!(attempt < retries)) return [3 /*break*/, 6];
                        return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, RETRY_DELAY_MS); })];
                    case 5:
                        _a.sent();
                        _a.label = 6;
                    case 6: return [3 /*break*/, 7];
                    case 7:
                        attempt++;
                        return [3 /*break*/, 1];
                    case 8: return [2 /*return*/, null];
                }
            });
        });
    };
    // ============================================================================
    // BROWSER LIFECYCLE
    // ============================================================================
    /**
     * Initialize the browser instance
     */
    ScraperService.prototype.initBrowser = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, chromiumPath, e_1, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        if (!(!this.browser || !this.browser.isConnected())) return [3 /*break*/, 10];
                        if (!this.browser) return [3 /*break*/, 4];
                        _c.label = 1;
                    case 1:
                        _c.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, this.browser.close()];
                    case 2:
                        _c.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        _a = _c.sent();
                        return [3 /*break*/, 4];
                    case 4:
                        chromiumPath = void 0;
                        _c.label = 5;
                    case 5:
                        _c.trys.push([5, 7, , 8]);
                        return [4 /*yield*/, getChromiumExecutable()];
                    case 6:
                        chromiumPath = _c.sent();
                        return [3 /*break*/, 8];
                    case 7:
                        e_1 = _c.sent();
                        console.log("[Scraper] Error getting chromium:", e_1);
                        return [3 /*break*/, 8];
                    case 8:
                        _b = this;
                        return [4 /*yield*/, playwright_1.chromium.launch(__assign({ headless: true, args: [
                                    "--no-sandbox",
                                    "--disable-setuid-sandbox",
                                    "--disable-blink-features=AutomationControlled",
                                    "--disable-dev-shm-usage",
                                ] }, (chromiumPath ? { executablePath: chromiumPath } : {})))];
                    case 9:
                        _b.browser = _c.sent();
                        _c.label = 10;
                    case 10: return [2 /*return*/, this.browser];
                }
            });
        });
    };
    /**
     * Reinitialize browser and re-login
     */
    ScraperService.prototype.reconnectBrowser = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, _b, page;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0: 
                    // Close all tracked pages and context
                    return [4 /*yield*/, this.closeTrackedPages()];
                    case 1:
                        // Close all tracked pages and context
                        _c.sent();
                        _c.label = 2;
                    case 2:
                        _c.trys.push([2, 5, , 6]);
                        if (!this.context) return [3 /*break*/, 4];
                        return [4 /*yield*/, this.context.close()];
                    case 3:
                        _c.sent();
                        _c.label = 4;
                    case 4: return [3 /*break*/, 6];
                    case 5:
                        _a = _c.sent();
                        return [3 /*break*/, 6];
                    case 6:
                        this.context = null;
                        return [4 /*yield*/, this.closeBrowser()];
                    case 7:
                        _c.sent();
                        // Create fresh browser and page
                        return [4 /*yield*/, this.initBrowser()];
                    case 8:
                        // Create fresh browser and page
                        _c.sent();
                        _b = this;
                        return [4 /*yield*/, this.browser.newContext()];
                    case 9:
                        _b.context = _c.sent();
                        return [4 /*yield*/, this.context.newPage()];
                    case 10:
                        page = _c.sent();
                        this.trackPage(page);
                        // Re-login
                        console.log("[Scraper] Re-logging in after reconnect...");
                        return [4 /*yield*/, this.login(page)];
                    case 11:
                        _c.sent();
                        return [4 /*yield*/, this.delay()];
                    case 12:
                        _c.sent();
                        return [2 /*return*/, page];
                }
            });
        });
    };
    /**
     * Ensure browser is connected, reconnect if needed
     * Returns a valid page to use
     */
    ScraperService.prototype.ensureBrowserConnected = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, _b, loginPage, page, error_3;
            var _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        _d.trys.push([0, 15, , 17]);
                        if (!(!this.browser || !this.browser.isConnected())) return [3 /*break*/, 2];
                        console.log("[Scraper] Browser not connected, reconnecting...");
                        return [4 /*yield*/, this.reconnectBrowser()];
                    case 1: return [2 /*return*/, _d.sent()];
                    case 2:
                        if (!(!this.context || !((_c = this.context.browser()) === null || _c === void 0 ? void 0 : _c.isConnected()))) return [3 /*break*/, 13];
                        console.log("[Scraper] Context not valid, recreating...");
                        return [4 /*yield*/, this.closeTrackedPages()];
                    case 3:
                        _d.sent();
                        _d.label = 4;
                    case 4:
                        _d.trys.push([4, 7, , 8]);
                        if (!this.context) return [3 /*break*/, 6];
                        return [4 /*yield*/, this.context.close()];
                    case 5:
                        _d.sent();
                        _d.label = 6;
                    case 6: return [3 /*break*/, 8];
                    case 7:
                        _a = _d.sent();
                        return [3 /*break*/, 8];
                    case 8:
                        _b = this;
                        return [4 /*yield*/, this.browser.newContext()];
                    case 9:
                        _b.context = _d.sent();
                        return [4 /*yield*/, this.context.newPage()];
                    case 10:
                        loginPage = _d.sent();
                        return [4 /*yield*/, this.login(loginPage)];
                    case 11:
                        _d.sent();
                        return [4 /*yield*/, loginPage.close()];
                    case 12:
                        _d.sent();
                        _d.label = 13;
                    case 13: return [4 /*yield*/, this.context.newPage()];
                    case 14:
                        page = _d.sent();
                        this.trackPage(page);
                        return [2 /*return*/, page];
                    case 15:
                        error_3 = _d.sent();
                        console.log("[Scraper] Error checking browser, reconnecting...", error_3);
                        return [4 /*yield*/, this.reconnectBrowser()];
                    case 16: return [2 /*return*/, _d.sent()];
                    case 17: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Close the browser instance
     */
    ScraperService.prototype.closeBrowser = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (!this.browser) return [3 /*break*/, 5];
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, this.browser.close()];
                    case 2:
                        _b.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        _a = _b.sent();
                        return [3 /*break*/, 4];
                    case 4:
                        this.browser = null;
                        _b.label = 5;
                    case 5:
                        this.context = null;
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Wait for a specified delay
     */
    ScraperService.prototype.delay = function (ms) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (resolve) {
                        setTimeout(resolve, ms !== null && ms !== void 0 ? ms : _this.config.delayMs);
                    })];
            });
        });
    };
    /**
     * Short delay for between operations
     */
    ScraperService.prototype.shortDelay = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: 
                    // Delay reduced to minimum - most time is network wait anyway
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 50); })];
                    case 1:
                        // Delay reduced to minimum - most time is network wait anyway
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Login to the supplier website
     */
    ScraperService.prototype.login = function (page) {
        return __awaiter(this, void 0, void 0, function () {
            var selectors, currentUrl, branchSelectors, _i, branchSelectors_1, selector, branchSelect, _a, branchLinkSelectors, _b, branchLinkSelectors_1, selector, branchLink, _c, error_4, message;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        _d.trys.push([0, 26, , 27]);
                        return [4 /*yield*/, page.goto(this.config.loginUrl, { waitUntil: "networkidle" })];
                    case 1:
                        _d.sent();
                        selectors = this.config.selectors.login;
                        // Fill in the login form
                        return [4 /*yield*/, page.fill(selectors.emailInputSelector, this.config.email)];
                    case 2:
                        // Fill in the login form
                        _d.sent();
                        return [4 /*yield*/, page.fill(selectors.passwordInputSelector, this.config.password)];
                    case 3:
                        _d.sent();
                        // Click submit
                        return [4 /*yield*/, page.click(selectors.submitButtonSelector)];
                    case 4:
                        // Click submit
                        _d.sent();
                        // Wait for navigation after login
                        return [4 /*yield*/, page.waitForLoadState("networkidle")];
                    case 5:
                        // Wait for navigation after login
                        _d.sent();
                        currentUrl = page.url();
                        if (currentUrl.includes("login") && !currentUrl.includes("logged")) {
                            throw new Error("Login failed - still on login page");
                        }
                        console.log("[Scraper] Successfully logged in as ".concat(this.config.email));
                        // Wait for the branch/sucursal selection modal to appear
                        return [4 /*yield*/, this.delay()];
                    case 6:
                        // Wait for the branch/sucursal selection modal to appear
                        _d.sent();
                        branchSelectors = [
                            "#ContentPlaceHolder1_ddlSucursal",
                            "#ddlSucursal",
                            "select[id*='Sucursal']",
                            ".sucursal-select",
                        ];
                        _i = 0, branchSelectors_1 = branchSelectors;
                        _d.label = 7;
                    case 7:
                        if (!(_i < branchSelectors_1.length)) return [3 /*break*/, 15];
                        selector = branchSelectors_1[_i];
                        _d.label = 8;
                    case 8:
                        _d.trys.push([8, 13, , 14]);
                        branchSelect = page.locator(selector);
                        return [4 /*yield*/, branchSelect.count()];
                    case 9:
                        if (!((_d.sent()) > 0)) return [3 /*break*/, 12];
                        // Select the first option (or a specific branch like "Cipolletti")
                        return [4 /*yield*/, branchSelect.selectOption({ index: 1 })];
                    case 10:
                        // Select the first option (or a specific branch like "Cipolletti")
                        _d.sent();
                        return [4 /*yield*/, page.waitForLoadState("networkidle")];
                    case 11:
                        _d.sent();
                        console.log("[Scraper] Selected branch/sucursal");
                        return [3 /*break*/, 15];
                    case 12: return [3 /*break*/, 14];
                    case 13:
                        _a = _d.sent();
                        return [3 /*break*/, 14];
                    case 14:
                        _i++;
                        return [3 /*break*/, 7];
                    case 15:
                        branchLinkSelectors = [
                            "a:has-text('Cipolletti')",
                            "a:has-text('Neuquen')",
                            ".branch-option",
                        ];
                        _b = 0, branchLinkSelectors_1 = branchLinkSelectors;
                        _d.label = 16;
                    case 16:
                        if (!(_b < branchLinkSelectors_1.length)) return [3 /*break*/, 24];
                        selector = branchLinkSelectors_1[_b];
                        _d.label = 17;
                    case 17:
                        _d.trys.push([17, 22, , 23]);
                        branchLink = page.locator(selector).first();
                        return [4 /*yield*/, branchLink.count()];
                    case 18:
                        if (!((_d.sent()) > 0)) return [3 /*break*/, 21];
                        return [4 /*yield*/, branchLink.click()];
                    case 19:
                        _d.sent();
                        return [4 /*yield*/, page.waitForLoadState("networkidle")];
                    case 20:
                        _d.sent();
                        console.log("[Scraper] Clicked on branch");
                        return [3 /*break*/, 24];
                    case 21: return [3 /*break*/, 23];
                    case 22:
                        _c = _d.sent();
                        return [3 /*break*/, 23];
                    case 23:
                        _b++;
                        return [3 /*break*/, 16];
                    case 24: return [4 /*yield*/, this.delay()];
                    case 25:
                        _d.sent();
                        return [3 /*break*/, 27];
                    case 26:
                        error_4 = _d.sent();
                        message = error_4 instanceof Error ? error_4.message : "Unknown error";
                        throw new types_1.ScraperError("Login failed: ".concat(message), "AUTH_FAILED", error_4);
                    case 27: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Scrape products from a single page (Jotakp specific)
     * Products are links with format: "Name U$D 98,75+ IVA ..."
     */
    ScraperService.prototype.scrapePage = function (page) {
        return __awaiter(this, void 0, void 0, function () {
            var selectors, products, items, _i, items_1, item, fullText, href, idMatch, externalId, priceRaw, innerHTML, usdPriceMatch, e_2, priceMatch, priceWithIvaMatch, name_1, imageUrls, imgElement, imgCount, src, dataSrc, dataOriginal, style, bgMatch, bgUrl, articleImgDiv, divCount, articleImgStyle, bgMatch, bgUrl, _a, rawProduct, error_5;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        selectors = this.config.selectors.productList;
                        products = [];
                        return [4 /*yield*/, page.locator(selectors.itemSelector).all()];
                    case 1:
                        items = _b.sent();
                        console.log("[Scraper] Found ".concat(items.length, " product links to scrape"));
                        _i = 0, items_1 = items;
                        _b.label = 2;
                    case 2:
                        if (!(_i < items_1.length)) return [3 /*break*/, 26];
                        item = items_1[_i];
                        _b.label = 3;
                    case 3:
                        _b.trys.push([3, 24, , 25]);
                        return [4 /*yield*/, item.textContent()];
                    case 4:
                        fullText = _b.sent();
                        return [4 /*yield*/, item.getAttribute("href")];
                    case 5:
                        href = _b.sent();
                        if (!fullText || !href)
                            return [3 /*break*/, 25];
                        idMatch = href.match(/id=(\d+)/);
                        externalId = idMatch ? idMatch[1] : href;
                        priceRaw = void 0;
                        _b.label = 6;
                    case 6:
                        _b.trys.push([6, 9, , 10]);
                        // Wait for prices to be loaded (they're dynamic content)
                        return [4 /*yield*/, item.locator("div:has-text('U$D')").first().waitFor({ state: "visible", timeout: 5000 }).catch(function () { })];
                    case 7:
                        // Wait for prices to be loaded (they're dynamic content)
                        _b.sent();
                        return [4 /*yield*/, item.evaluate(function (el) { return el.innerHTML; })];
                    case 8:
                        innerHTML = _b.sent();
                        usdPriceMatch = innerHTML.match(/U\$D\s+([\d.,]+)/);
                        if (usdPriceMatch) {
                            priceRaw = usdPriceMatch[1];
                        }
                        return [3 /*break*/, 10];
                    case 9:
                        e_2 = _b.sent();
                        return [3 /*break*/, 10];
                    case 10:
                        // Fallback: try textContent if innerHTML didn't have price
                        if (!priceRaw && fullText) {
                            priceMatch = fullText.match(/U\$D\s+([\d.,]+)/);
                            priceRaw = priceMatch ? priceMatch[1] : undefined;
                        }
                        priceWithIvaMatch = fullText.match(/\$?([\d.]+),([\d.]+)\+ IVA/);
                        name_1 = fullText.replace(/U\$D[\s\d.,+IVA%]+$/, "").trim();
                        // Skip if no meaningful name
                        if (!name_1 || name_1.length < 3)
                            return [3 /*break*/, 25];
                        imageUrls = [];
                        _b.label = 11;
                    case 11:
                        _b.trys.push([11, 22, , 23]);
                        imgElement = item.locator("img").first();
                        return [4 /*yield*/, imgElement.count()];
                    case 12:
                        imgCount = _b.sent();
                        if (!(imgCount > 0)) return [3 /*break*/, 16];
                        return [4 /*yield*/, imgElement.getAttribute("src")];
                    case 13:
                        src = _b.sent();
                        return [4 /*yield*/, imgElement.getAttribute("data-src")];
                    case 14:
                        dataSrc = _b.sent();
                        return [4 /*yield*/, imgElement.getAttribute("data-original")];
                    case 15:
                        dataOriginal = _b.sent();
                        if (src && (src.startsWith("http") || src.startsWith("/"))) {
                            imageUrls.push(src);
                        }
                        else if (dataSrc && (dataSrc.startsWith("http") || dataSrc.startsWith("/"))) {
                            imageUrls.push(dataSrc);
                        }
                        else if (dataOriginal && (dataOriginal.startsWith("http") || dataOriginal.startsWith("/"))) {
                            imageUrls.push(dataOriginal);
                        }
                        _b.label = 16;
                    case 16:
                        if (!(imageUrls.length === 0)) return [3 /*break*/, 18];
                        return [4 /*yield*/, item.locator("[style*='background-image']").first().getAttribute("style")];
                    case 17:
                        style = _b.sent();
                        if (style) {
                            bgMatch = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
                            if (bgMatch && bgMatch[1]) {
                                bgUrl = bgMatch[1];
                                if (bgUrl.startsWith("http") || bgUrl.startsWith("/") || bgUrl.startsWith("imagenes")) {
                                    imageUrls.push(bgUrl);
                                }
                            }
                        }
                        _b.label = 18;
                    case 18:
                        if (!(imageUrls.length === 0)) return [3 /*break*/, 21];
                        articleImgDiv = item.locator("div.tg-article-img, div.w-100.tg-article-img, [class*='tg-article-img']").first();
                        return [4 /*yield*/, articleImgDiv.count()];
                    case 19:
                        divCount = _b.sent();
                        if (!(divCount > 0)) return [3 /*break*/, 21];
                        return [4 /*yield*/, articleImgDiv.getAttribute("style")];
                    case 20:
                        articleImgStyle = _b.sent();
                        if (articleImgStyle) {
                            bgMatch = articleImgStyle.match(/url\(['"]?([^'")\s]+)['"]?\)/);
                            if (bgMatch && bgMatch[1]) {
                                bgUrl = bgMatch[1];
                                // NO convertir a HD - dejar la miniatura tal cual
                                // La página de detalle tendrá las imágenes HD reales
                                if (bgUrl.startsWith("http") || bgUrl.startsWith("/") || bgUrl.startsWith("imagenes")) {
                                    imageUrls.push(bgUrl);
                                }
                            }
                        }
                        _b.label = 21;
                    case 21: return [3 /*break*/, 23];
                    case 22:
                        _a = _b.sent();
                        return [3 /*break*/, 23];
                    case 23:
                        rawProduct = {
                            externalId: externalId,
                            name: name_1.substring(0, 200), // Limit name length
                            priceRaw: priceRaw,
                            priceWithIvaRaw: priceWithIvaMatch ? "".concat(priceWithIvaMatch[1], ",").concat(priceWithIvaMatch[2]) : undefined,
                            imageUrls: imageUrls,
                            categories: [],
                            productUrl: href.startsWith("http") ? href : "".concat(this.config.baseUrl, "/").concat(href),
                            rawElement: undefined,
                        };
                        products.push(rawProduct);
                        return [3 /*break*/, 25];
                    case 24:
                        error_5 = _b.sent();
                        console.error("[Scraper] Error parsing product item:", error_5);
                        return [3 /*break*/, 25];
                    case 25:
                        _i++;
                        return [3 /*break*/, 2];
                    case 26:
                        console.log("[Scraper] Found ".concat(products.length, " products on page"));
                        return [2 /*return*/, products];
                }
            });
        });
    };
    /**
     * Scrape detailed product information from individual product pages
     * Uses safe navigation and content retrieval
     */
    ScraperService.prototype.scrapeProductDetail = function (page, productUrl) {
        return __awaiter(this, void 0, void 0, function () {
            var fullUrl, navSuccess, detail, content, thumbnailDivs, thumbnailUrls, _i, thumbnailDivs_1, div, dataSrc, fullUrl_1, mainImg, src, fullUrl_2, _a, imageSelectors, _b, imageSelectors_1, selector, img, src, dataSrc, dataOriginal, _c, descSelectors, _d, descSelectors_1, selector, desc, text, _e, stockSelectors, _f, stockSelectors_1, selector, stock, text, stockMatch, _g, error_6;
            return __generator(this, function (_h) {
                switch (_h.label) {
                    case 0:
                        _h.trys.push([0, 40, , 41]);
                        fullUrl = productUrl.startsWith("http")
                            ? productUrl
                            : "".concat(this.config.baseUrl, "/").concat(productUrl);
                        return [4 /*yield*/, this.safeGoto(page, fullUrl)];
                    case 1:
                        navSuccess = _h.sent();
                        if (!navSuccess) {
                            console.log("[Scraper] Failed to navigate to product detail: ".concat(productUrl));
                            return [2 /*return*/, null];
                        }
                        return [4 /*yield*/, this.shortDelay()];
                    case 2:
                        _h.sent();
                        detail = {};
                        return [4 /*yield*/, this.safeContent(page)];
                    case 3:
                        content = _h.sent();
                        if (!content) {
                            console.log("[Scraper] Failed to get content for: ".concat(productUrl));
                            return [2 /*return*/, detail]; // Return empty detail, not null - we still have the product URL
                        }
                        return [4 /*yield*/, page.locator("div.tg-img-overlay.artImg").all()];
                    case 4:
                        thumbnailDivs = _h.sent();
                        thumbnailUrls = [];
                        _i = 0, thumbnailDivs_1 = thumbnailDivs;
                        _h.label = 5;
                    case 5:
                        if (!(_i < thumbnailDivs_1.length)) return [3 /*break*/, 8];
                        div = thumbnailDivs_1[_i];
                        return [4 /*yield*/, div.getAttribute("data-src")];
                    case 6:
                        dataSrc = _h.sent();
                        if (dataSrc && dataSrc.includes("imagenes/") && !dataSrc.includes("/min/")) {
                            fullUrl_1 = dataSrc.startsWith("http")
                                ? dataSrc
                                : "".concat(this.config.baseUrl, "/").concat(dataSrc);
                            thumbnailUrls.push(fullUrl_1);
                        }
                        _h.label = 7;
                    case 7:
                        _i++;
                        return [3 /*break*/, 5];
                    case 8:
                        _h.trys.push([8, 12, , 13]);
                        mainImg = page.locator("img.img-fluid").first();
                        return [4 /*yield*/, mainImg.count()];
                    case 9:
                        if (!((_h.sent()) > 0)) return [3 /*break*/, 11];
                        return [4 /*yield*/, mainImg.getAttribute("src")];
                    case 10:
                        src = _h.sent();
                        if (src && src.includes("imagenes/") && !src.includes("/min/")) {
                            fullUrl_2 = src.startsWith("http")
                                ? src
                                : "".concat(this.config.baseUrl, "/").concat(src);
                            // Add if not already in thumbnailUrls
                            if (!thumbnailUrls.includes(fullUrl_2)) {
                                thumbnailUrls.unshift(fullUrl_2); // Add at beginning (main image first)
                            }
                        }
                        _h.label = 11;
                    case 11: return [3 /*break*/, 13];
                    case 12:
                        _a = _h.sent();
                        return [3 /*break*/, 13];
                    case 13:
                        if (thumbnailUrls.length > 0) {
                            detail.imageUrls = thumbnailUrls;
                        }
                        if (!(!detail.imageUrls || detail.imageUrls.length === 0)) return [3 /*break*/, 23];
                        imageSelectors = [
                            "#ContentPlaceHolder1_imgArticulo",
                            "img[id*='img']",
                            ".product-image img",
                            "#product-image img",
                            ".principal-image img",
                            "img.product-img",
                            "img[itemprop='image']",
                            "img.main-image",
                        ];
                        _b = 0, imageSelectors_1 = imageSelectors;
                        _h.label = 14;
                    case 14:
                        if (!(_b < imageSelectors_1.length)) return [3 /*break*/, 23];
                        selector = imageSelectors_1[_b];
                        _h.label = 15;
                    case 15:
                        _h.trys.push([15, 21, , 22]);
                        img = page.locator(selector).first();
                        return [4 /*yield*/, img.count()];
                    case 16:
                        if (!((_h.sent()) > 0)) return [3 /*break*/, 20];
                        return [4 /*yield*/, img.getAttribute("src")];
                    case 17:
                        src = _h.sent();
                        return [4 /*yield*/, img.getAttribute("data-src")];
                    case 18:
                        dataSrc = _h.sent();
                        return [4 /*yield*/, img.getAttribute("data-original")];
                    case 19:
                        dataOriginal = _h.sent();
                        if (src && (src.startsWith("http") || src.startsWith("/"))) {
                            detail.imageUrls = [src.startsWith("http") ? src : "".concat(this.config.baseUrl).concat(src)];
                            return [3 /*break*/, 23];
                        }
                        else if (dataSrc && (dataSrc.startsWith("http") || dataSrc.startsWith("/"))) {
                            detail.imageUrls = [dataSrc.startsWith("http") ? dataSrc : "".concat(this.config.baseUrl).concat(dataSrc)];
                            return [3 /*break*/, 23];
                        }
                        else if (dataOriginal && (dataOriginal.startsWith("http") || dataOriginal.startsWith("/"))) {
                            detail.imageUrls = [dataOriginal.startsWith("http") ? dataOriginal : "".concat(this.config.baseUrl).concat(dataOriginal)];
                            return [3 /*break*/, 23];
                        }
                        _h.label = 20;
                    case 20: return [3 /*break*/, 22];
                    case 21:
                        _c = _h.sent();
                        return [3 /*break*/, 22];
                    case 22:
                        _b++;
                        return [3 /*break*/, 14];
                    case 23:
                        descSelectors = [
                            "#ContentPlaceHolder1_lblDescripcion",
                            "[id*='lblDescripcion']",
                            "div[id*='Descripcion']",
                            "div[class*='Descripcion']",
                            ".product-description",
                            "#product-description",
                            ".description",
                            "[itemprop='description']",
                        ];
                        _d = 0, descSelectors_1 = descSelectors;
                        _h.label = 24;
                    case 24:
                        if (!(_d < descSelectors_1.length)) return [3 /*break*/, 31];
                        selector = descSelectors_1[_d];
                        _h.label = 25;
                    case 25:
                        _h.trys.push([25, 29, , 30]);
                        desc = page.locator(selector).first();
                        return [4 /*yield*/, desc.count()];
                    case 26:
                        if (!((_h.sent()) > 0)) return [3 /*break*/, 28];
                        return [4 /*yield*/, desc.textContent()];
                    case 27:
                        text = _h.sent();
                        // Make sure it's the actual description content, not empty or too short
                        if (text && text.trim().length > 10 && !text.includes("guardarArtDescripcionBD")) {
                            detail.description = text.trim();
                            console.log("[ScrapeDetail] Found description with selector \"".concat(selector, "\": ").concat(text.substring(0, 100), "..."));
                            return [3 /*break*/, 31];
                        }
                        _h.label = 28;
                    case 28: return [3 /*break*/, 30];
                    case 29:
                        _e = _h.sent();
                        return [3 /*break*/, 30];
                    case 30:
                        _d++;
                        return [3 /*break*/, 24];
                    case 31:
                        stockSelectors = [
                            "#ContentPlaceHolder1_lblStock",
                            "#lblStock",
                            ".stock",
                            "#stock",
                            "[itemprop='availability']",
                            ".product-stock",
                            ".stock-info",
                            "span:has-text('Stock')",
                        ];
                        _f = 0, stockSelectors_1 = stockSelectors;
                        _h.label = 32;
                    case 32:
                        if (!(_f < stockSelectors_1.length)) return [3 /*break*/, 39];
                        selector = stockSelectors_1[_f];
                        _h.label = 33;
                    case 33:
                        _h.trys.push([33, 37, , 38]);
                        stock = page.locator(selector).first();
                        return [4 /*yield*/, stock.count()];
                    case 34:
                        if (!((_h.sent()) > 0)) return [3 /*break*/, 36];
                        return [4 /*yield*/, stock.textContent()];
                    case 35:
                        text = _h.sent();
                        if (text) {
                            // Check if it says "Sin stock" or "Sin Stock" = no stock
                            if (text.toLowerCase().includes("sin stock")) {
                                detail.stock = 0;
                                return [3 /*break*/, 39];
                            }
                            // Check for "consultar" or similar = no stock
                            if (text.toLowerCase().includes("consultar") || text.toLowerCase().includes("sin disponibilidad")) {
                                detail.stock = 0;
                                return [3 /*break*/, 39];
                            }
                            stockMatch = text.match(/(\d+)/);
                            if (stockMatch) {
                                detail.stock = parseInt(stockMatch[1], 10);
                                return [3 /*break*/, 39];
                            }
                        }
                        _h.label = 36;
                    case 36: return [3 /*break*/, 38];
                    case 37:
                        _g = _h.sent();
                        return [3 /*break*/, 38];
                    case 38:
                        _f++;
                        return [3 /*break*/, 32];
                    case 39: return [2 /*return*/, detail];
                    case 40:
                        error_6 = _h.sent();
                        console.error("[Scraper] Error scraping product detail: ".concat(productUrl), error_6);
                        return [2 /*return*/, null];
                    case 41: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Scrape all products from multiple categories with detail pages and pagination
     * Can filter by specific category or idsubrubro1
     * Supports resume from checkpoint
     */
    ScraperService.prototype.scrapeProducts = function (page, categoriesToProcess) {
        return __awaiter(this, void 0, void 0, function () {
            var allProducts, seenExternalIds, catIndex, category, error_7, pageNum, hasNextPage, pageProducts, productsWithDetails, _i, productsWithDetails_1, product, paginationPage, nextPageNum, navSuccess, content, productMatches, productCount, _a, e_3, error_8;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        allProducts = [];
                        seenExternalIds = new Set();
                        console.log("[Scraper] Will scrape ".concat(categoriesToProcess.length, " category(ies)"));
                        catIndex = 0;
                        _b.label = 1;
                    case 1:
                        if (!(catIndex < categoriesToProcess.length)) return [3 /*break*/, 36];
                        category = categoriesToProcess[catIndex];
                        _b.label = 2;
                    case 2:
                        _b.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, this.ensureBrowserConnected()];
                    case 3:
                        page = _b.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        error_7 = _b.sent();
                        console.error("[Scraper] Failed to reconnect browser for category ".concat(category.name, ":"), error_7);
                        return [3 /*break*/, 35];
                    case 5:
                        // Update current category index for checkpoint
                        this.currentCategoryIndex = catIndex;
                        console.log("[Scraper] Scraping category: ".concat(category.name, " (id=").concat(category.idsubrubro1, ")"));
                        _b.label = 6;
                    case 6:
                        _b.trys.push([6, 33, , 35]);
                        pageNum = 1;
                        this.currentPageNum = 1;
                        hasNextPage = true;
                        return [4 /*yield*/, page.goto("".concat(this.config.baseUrl, "/buscar.aspx?idsubrubro1=").concat(category.idsubrubro1, "&pag=").concat(pageNum), { waitUntil: "networkidle" })];
                    case 7:
                        _b.sent();
                        // Wait for dynamic content (prices) to load
                        return [4 /*yield*/, page.waitForSelector("div:has-text('U$D')", { timeout: 10000 }).catch(function () { })];
                    case 8:
                        // Wait for dynamic content (prices) to load
                        _b.sent();
                        // Additional small wait to ensure DOM is stable
                        return [4 /*yield*/, this.delay(500)];
                    case 9:
                        // Additional small wait to ensure DOM is stable
                        _b.sent();
                        _b.label = 10;
                    case 10:
                        if (!hasNextPage) return [3 /*break*/, 31];
                        console.log("[Scraper] Scraping ".concat(category.name, " - page ").concat(pageNum));
                        // Save checkpoint before scraping page
                        return [4 /*yield*/, this.saveCheckpoint(category, pageNum)];
                    case 11:
                        // Save checkpoint before scraping page
                        _b.sent();
                        return [4 /*yield*/, this.scrapePage(page)];
                    case 12:
                        pageProducts = _b.sent();
                        console.log("[Scraper] Found ".concat(pageProducts.length, " products on page ").concat(pageNum));
                        return [4 /*yield*/, this.scrapeProductsInParallel(pageProducts)];
                    case 13:
                        productsWithDetails = _b.sent();
                        // Add category to each product
                        for (_i = 0, productsWithDetails_1 = productsWithDetails; _i < productsWithDetails_1.length; _i++) {
                            product = productsWithDetails_1[_i];
                            // Skip if we've already seen this externalId (from previous page)
                            if (seenExternalIds.has(product.externalId)) {
                                console.log("[Scraper] Skipping duplicate: ".concat(product.externalId));
                                continue;
                            }
                            seenExternalIds.add(product.externalId);
                            product.categories = [category.id];
                            allProducts.push(product);
                            this.productsScrapedCount++;
                        }
                        console.log("[Scraper] Processed ".concat(productsWithDetails.length, " products with details"));
                        _b.label = 14;
                    case 14:
                        _b.trys.push([14, 29, , 30]);
                        return [4 /*yield*/, this.getPage()];
                    case 15:
                        paginationPage = _b.sent();
                        nextPageNum = pageNum + 1;
                        console.log("[Scraper] Checking for page ".concat(nextPageNum, "..."));
                        return [4 /*yield*/, this.safeGoto(paginationPage, "".concat(this.config.baseUrl, "/buscar.aspx?idsubrubro1=").concat(category.idsubrubro1, "&pag=").concat(nextPageNum))];
                    case 16:
                        navSuccess = _b.sent();
                        if (!!navSuccess) return [3 /*break*/, 17];
                        hasNextPage = false;
                        console.log("[Scraper] Navigation failed, no more pages in ".concat(category.name));
                        return [3 /*break*/, 25];
                    case 17: 
                    // Wait a bit for page to render
                    return [4 /*yield*/, this.shortDelay()];
                    case 18:
                        // Wait a bit for page to render
                        _b.sent();
                        return [4 /*yield*/, this.shortDelay()];
                    case 19:
                        _b.sent(); // Extra wait for slow pages
                        return [4 /*yield*/, this.safeContent(paginationPage)];
                    case 20:
                        content = _b.sent();
                        if (!(content && content.includes('articulo.aspx?id='))) return [3 /*break*/, 24];
                        productMatches = content.match(/articulo\.aspx\?id=\d+/g);
                        productCount = productMatches ? new Set(productMatches).size : 0;
                        console.log("[Scraper] Page ".concat(nextPageNum, " has ").concat(productCount, " products"));
                        if (!(productCount > 0)) return [3 /*break*/, 22];
                        pageNum = nextPageNum;
                        this.currentPageNum = pageNum;
                        console.log("[Scraper] Moving to page ".concat(pageNum, "..."));
                        // Navigate main page to the next page
                        return [4 /*yield*/, this.safeGoto(page, "".concat(this.config.baseUrl, "/buscar.aspx?idsubrubro1=").concat(category.idsubrubro1, "&pag=").concat(pageNum))];
                    case 21:
                        // Navigate main page to the next page
                        _b.sent();
                        return [3 /*break*/, 23];
                    case 22:
                        hasNextPage = false;
                        console.log("[Scraper] No more pages in ".concat(category.name, " (page ").concat(nextPageNum, " is empty)"));
                        _b.label = 23;
                    case 23: return [3 /*break*/, 25];
                    case 24:
                        hasNextPage = false;
                        console.log("[Scraper] No more pages in ".concat(category.name));
                        _b.label = 25;
                    case 25:
                        _b.trys.push([25, 27, , 28]);
                        return [4 /*yield*/, paginationPage.close()];
                    case 26:
                        _b.sent();
                        return [3 /*break*/, 28];
                    case 27:
                        _a = _b.sent();
                        return [3 /*break*/, 28];
                    case 28: return [3 /*break*/, 30];
                    case 29:
                        e_3 = _b.sent();
                        hasNextPage = false;
                        console.log("[Scraper] Error checking next page: ".concat(e_3));
                        console.log("[Scraper] No more pages in ".concat(category.name));
                        return [3 /*break*/, 30];
                    case 30: return [3 /*break*/, 10];
                    case 31: 
                    // Save checkpoint after completing category
                    return [4 /*yield*/, this.saveCheckpoint(category, pageNum)];
                    case 32:
                        // Save checkpoint after completing category
                        _b.sent();
                        return [3 /*break*/, 35];
                    case 33:
                        error_8 = _b.sent();
                        console.error("[Scraper] Error scraping category ".concat(category.name, ":"), error_8);
                        // Save checkpoint on error
                        return [4 /*yield*/, this.saveCheckpoint(category, 1)];
                    case 34:
                        // Save checkpoint on error
                        _b.sent();
                        return [3 /*break*/, 35];
                    case 35:
                        catIndex++;
                        return [3 /*break*/, 1];
                    case 36:
                        console.log("[Scraper] Total products scraped: ".concat(allProducts.length));
                        return [2 /*return*/, allProducts];
                }
            });
        });
    };
    /**
     * Scrape multiple product details in PARALLEL for faster processing
     * Uses batch processing with MAX_PARALLEL_PAGES concurrent requests
     */
    ScraperService.prototype.scrapeProductsInParallel = function (pageProducts) {
        return __awaiter(this, void 0, void 0, function () {
            var results, productsWithUrl, i, batch, batchPromises, batchResults, productsWithoutUrl;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        results = [];
                        productsWithUrl = pageProducts.filter(function (p) { return p.productUrl; });
                        i = 0;
                        _a.label = 1;
                    case 1:
                        if (!(i < productsWithUrl.length)) return [3 /*break*/, 5];
                        batch = productsWithUrl.slice(i, i + MAX_PARALLEL_PAGES);
                        batchPromises = batch.map(function (product) { return __awaiter(_this, void 0, void 0, function () {
                            var detailPage, detail, _a, error_9;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        _b.trys.push([0, 7, , 8]);
                                        return [4 /*yield*/, this.getPage()];
                                    case 1:
                                        detailPage = _b.sent();
                                        return [4 /*yield*/, this.scrapeProductDetail(detailPage, product.productUrl)];
                                    case 2:
                                        detail = _b.sent();
                                        _b.label = 3;
                                    case 3:
                                        _b.trys.push([3, 5, , 6]);
                                        return [4 /*yield*/, detailPage.close()];
                                    case 4:
                                        _b.sent();
                                        return [3 /*break*/, 6];
                                    case 5:
                                        _a = _b.sent();
                                        return [3 /*break*/, 6];
                                    case 6:
                                        // Merge detail into product
                                        if (detail) {
                                            if (detail.imageUrls && detail.imageUrls.length > 0) {
                                                product.imageUrls = detail.imageUrls;
                                            }
                                            if (detail.description) {
                                                product.description = detail.description;
                                            }
                                            if (detail.stock !== undefined) {
                                                product.stock = detail.stock;
                                            }
                                        }
                                        return [2 /*return*/, product];
                                    case 7:
                                        error_9 = _b.sent();
                                        console.error("[Scraper] Error scraping ".concat(product.productUrl, ":"), error_9);
                                        return [2 /*return*/, product]; // Return product even if detail failed
                                    case 8: return [2 /*return*/];
                                }
                            });
                        }); });
                        return [4 /*yield*/, Promise.all(batchPromises)];
                    case 2:
                        batchResults = _a.sent();
                        results.push.apply(results, batchResults);
                        // Small delay between batches
                        return [4 /*yield*/, this.shortDelay()];
                    case 3:
                        // Small delay between batches
                        _a.sent();
                        _a.label = 4;
                    case 4:
                        i += MAX_PARALLEL_PAGES;
                        return [3 /*break*/, 1];
                    case 5:
                        productsWithoutUrl = pageProducts.filter(function (p) { return !p.productUrl; });
                        results.push.apply(results, productsWithoutUrl);
                        return [2 /*return*/, results];
                }
            });
        });
    };
    /**
     * Run the complete scraping pipeline
     * Includes checkpoint system for resume on crash
     */
    ScraperService.prototype.run = function () {
        return __awaiter(this, void 0, void 0, function () {
            var startTime, result, page, cleanedCount, incompleteRun, jotakpCategories_1, validCategories, categoriesToProcess, _a, browser, context, rawProducts, _b, products, errors, _i, products_1, p, i, product, cloudUrls, imageError_1, seenExternalIds, created, updated, unchanged, _c, products_2, product, result_1, dbError_1, errorMsg, discontinuedCount, category, categoryId, db, productsCollection, existingProducts, existingIds, scrapedIds_1, disappearedIds, result_2, error_10, message, scraperError;
            var _d;
            var _this = this;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        startTime = Date.now();
                        result = {
                            success: false,
                            created: 0,
                            updated: 0,
                            errors: [],
                            durationMs: 0,
                            timestamp: new Date(),
                        };
                        page = null;
                        _e.label = 1;
                    case 1:
                        _e.trys.push([1, 43, 47, 51]);
                        // Ensure indexes exist
                        return [4 /*yield*/, scraperRunRepository.ensureIndexes()];
                    case 2:
                        // Ensure indexes exist
                        _e.sent();
                        // Step 0: Clean up stale runs (older than 24 hours)
                        console.log("[Scraper] Cleaning up stale runs...");
                        return [4 /*yield*/, scraperRunRepository.cleanupStaleRuns(24)];
                    case 3:
                        cleanedCount = _e.sent();
                        if (cleanedCount > 0) {
                            console.log("[Scraper] Marked ".concat(cleanedCount, " stale run(s) as stale"));
                        }
                        return [4 /*yield*/, scraperRunRepository.findIncomplete()];
                    case 4:
                        incompleteRun = _e.sent();
                        return [4 /*yield*/, Promise.resolve().then(function () { return __importStar(require("./config")); })];
                    case 5:
                        jotakpCategories_1 = (_e.sent()).jotakpCategories;
                        validCategories = jotakpCategories_1.filter(function (c) { return c.idsubrubro1 > 0; });
                        // Filter by request
                        if (this.request.idsubrubro1 !== undefined) {
                            validCategories = validCategories.filter(function (c) { return c.idsubrubro1 === _this.request.idsubrubro1; });
                            console.log("[Scraper] Filtering to idsubrubro1=".concat(this.request.idsubrubro1));
                        }
                        else if (this.request.categoryId) {
                            validCategories = validCategories.filter(function (c) { return c.id === _this.request.categoryId; });
                            console.log("[Scraper] Filtering to categoryId=".concat(this.request.categoryId));
                        }
                        categoriesToProcess = validCategories.map(function (c) { return c.id; });
                        if (!incompleteRun) return [3 /*break*/, 7];
                        console.log("[Scraper] Resuming from incomplete run ".concat(incompleteRun.runId));
                        this.currentRun = incompleteRun;
                        this.currentCategoryIndex = incompleteRun.currentCategoryIndex;
                        this.currentPageNum = incompleteRun.lastPageNumber;
                        this.productsScrapedCount = incompleteRun.productsScraped;
                        this.productsSavedCount = incompleteRun.productsSaved;
                        // Increment resume count
                        return [4 /*yield*/, scraperRunRepository.incrementResumeCount(incompleteRun.runId)];
                    case 6:
                        // Increment resume count
                        _e.sent();
                        // Update categories to process from the run
                        if (incompleteRun.categoriesToProcess.length > 0) {
                            // Filter validCategories based on what was being processed
                            validCategories = validCategories.slice(this.currentCategoryIndex);
                        }
                        return [3 /*break*/, 9];
                    case 7:
                        // Create new run
                        _a = this;
                        return [4 /*yield*/, scraperRunRepository.create({
                                source: this.request.source,
                                categoryId: this.request.categoryId,
                                idsubrubro1: this.request.idsubrubro1,
                                categoriesToProcess: categoriesToProcess,
                            })];
                    case 8:
                        // Create new run
                        _a.currentRun = _e.sent();
                        console.log("[Scraper] Created new run ".concat(this.currentRun.runId));
                        _e.label = 9;
                    case 9: return [4 /*yield*/, this.initBrowser()];
                    case 10:
                        browser = _e.sent();
                        return [4 /*yield*/, browser.newContext()];
                    case 11:
                        context = _e.sent();
                        return [4 /*yield*/, context.newPage()];
                    case 12:
                        page = _e.sent();
                        // Step 1: Login
                        console.log("[Scraper] Starting login...");
                        return [4 /*yield*/, this.login(page)];
                    case 13:
                        _e.sent();
                        // Add delay after login
                        return [4 /*yield*/, this.delay()];
                    case 14:
                        // Add delay after login
                        _e.sent();
                        // Step 2: Navigate to products page and scrape
                        console.log("[Scraper] Starting to scrape products...");
                        return [4 /*yield*/, this.scrapeProducts(page, validCategories)];
                    case 15:
                        rawProducts = _e.sent();
                        result.errors.push("Scraped ".concat(rawProducts.length, " raw products from website"));
                        if (!(rawProducts.length === 0)) return [3 /*break*/, 18];
                        result.success = true;
                        result.durationMs = Date.now() - startTime;
                        if (!this.currentRun) return [3 /*break*/, 17];
                        return [4 /*yield*/, scraperRunRepository.markCompleted(this.currentRun.runId, {
                                productsScraped: this.productsScrapedCount,
                                productsSaved: this.productsSavedCount,
                                durationMs: result.durationMs,
                            })];
                    case 16:
                        _e.sent();
                        _e.label = 17;
                    case 17: return [2 /*return*/, result];
                    case 18:
                        // Step 4: Transform products
                        console.log("[Scraper] Transforming products...");
                        _b = (0, data_transformer_1.transformProducts)(rawProducts, this.config.supplier), products = _b.products, errors = _b.errors;
                        (_d = result.errors).push.apply(_d, errors);
                        // Debug: log transformed products
                        for (_i = 0, products_1 = products; _i < products_1.length; _i++) {
                            p = products_1[_i];
                            console.log("[Scraper] Transformed product ".concat(p.externalId, ": priceRaw=").concat(p.priceRaw, ", price=").concat(p.price));
                        }
                        // Step 5: Upload images to Cloudinary for each product
                        console.log("[Scraper] Uploading images to Cloudinary...");
                        i = 0;
                        _e.label = 19;
                    case 19:
                        if (!(i < products.length)) return [3 /*break*/, 26];
                        product = products[i];
                        if (!(product.imageUrls && product.imageUrls.length > 0)) return [3 /*break*/, 23];
                        _e.label = 20;
                    case 20:
                        _e.trys.push([20, 22, , 23]);
                        return [4 /*yield*/, (0, image_downloader_1.uploadProductImages)(product.imageUrls, product.supplier, product.externalId)];
                    case 21:
                        cloudUrls = _e.sent();
                        // Use Cloudinary URLs if uploaded, otherwise keep original URLs
                        if (cloudUrls.length > 0) {
                            product.imageUrls = cloudUrls;
                        }
                        console.log("[Scraper] Uploaded ".concat(cloudUrls.length, " images for ").concat(product.name.substring(0, 30), "..."));
                        return [3 /*break*/, 23];
                    case 22:
                        imageError_1 = _e.sent();
                        console.error("[Scraper] Error uploading images for ".concat(product.externalId, ":"), imageError_1);
                        return [3 /*break*/, 23];
                    case 23: 
                    // Small delay between products to not saturate the server
                    return [4 /*yield*/, this.shortDelay()];
                    case 24:
                        // Small delay between products to not saturate the server
                        _e.sent();
                        _e.label = 25;
                    case 25:
                        i++;
                        return [3 /*break*/, 19];
                    case 26:
                        // Step 6: Save to database con control de cambios atómico (como Git)
                        console.log("[Scraper] Saving products to database (atomic upsert)...");
                        seenExternalIds = [];
                        created = 0;
                        updated = 0;
                        unchanged = 0;
                        _c = 0, products_2 = products;
                        _e.label = 27;
                    case 27:
                        if (!(_c < products_2.length)) return [3 /*break*/, 32];
                        product = products_2[_c];
                        _e.label = 28;
                    case 28:
                        _e.trys.push([28, 30, , 31]);
                        seenExternalIds.push(product.externalId);
                        console.log("[Scraper] Saving product ".concat(product.externalId, ": priceRaw=").concat(product.priceRaw, ", price=").concat(product.price));
                        return [4 /*yield*/, productRepository.atomicUpsertByExternalId(product)];
                    case 29:
                        result_1 = _e.sent();
                        if (result_1.created) {
                            created++;
                        }
                        else if (result_1.updated) {
                            updated++;
                            if (result_1.changes.length > 0) {
                                console.log("[Scraper] Updated ".concat(product.externalId, ": ").concat(result_1.changes.join(", ")));
                            }
                        }
                        else {
                            unchanged++;
                        }
                        this.productsSavedCount++;
                        return [3 /*break*/, 31];
                    case 30:
                        dbError_1 = _e.sent();
                        errorMsg = dbError_1 instanceof Error ? dbError_1.message : "Unknown error";
                        result.errors.push("Failed to save product ".concat(product.name, ": ").concat(errorMsg));
                        return [3 /*break*/, 31];
                    case 31:
                        _c++;
                        return [3 /*break*/, 27];
                    case 32:
                        discontinuedCount = 0;
                        if (!(this.request.idsubrubro1 !== undefined)) return [3 /*break*/, 37];
                        category = jotakpCategories_1.find(function (c) { return c.idsubrubro1 === _this.request.idsubrubro1; });
                        categoryId = category === null || category === void 0 ? void 0 : category.id;
                        if (!categoryId) return [3 /*break*/, 36];
                        console.log("[Scraper] Marking discontinued products for category: ".concat(categoryId));
                        return [4 /*yield*/, getDb()];
                    case 33:
                        db = _e.sent();
                        productsCollection = db.collection("products");
                        return [4 /*yield*/, productsCollection.find({
                                supplier: this.config.supplier,
                                categories: categoryId,
                                status: "active"
                            }).toArray()];
                    case 34:
                        existingProducts = _e.sent();
                        existingIds = existingProducts.map(function (p) { return p.externalId; });
                        scrapedIds_1 = seenExternalIds;
                        disappearedIds = existingIds.filter(function (id) { return !scrapedIds_1.includes(id); });
                        if (!(disappearedIds.length > 0)) return [3 /*break*/, 36];
                        return [4 /*yield*/, productsCollection.updateMany({
                                supplier: this.config.supplier,
                                externalId: { $in: disappearedIds },
                                categories: categoryId
                            }, {
                                $set: {
                                    status: "discontinued",
                                    discontinuedAt: new Date()
                                }
                            })];
                    case 35:
                        result_2 = _e.sent();
                        discontinuedCount = result_2.modifiedCount;
                        console.log("[Scraper] Marked ".concat(discontinuedCount, " products as discontinued in ").concat(categoryId));
                        _e.label = 36;
                    case 36: return [3 /*break*/, 40];
                    case 37:
                        if (!(this.request.categoryId === undefined)) return [3 /*break*/, 39];
                        // Scrapeo completo de todas las categorías
                        console.log("[Scraper] Marking discontinued products (full scrape)...");
                        return [4 /*yield*/, productRepository.markDiscontinued(this.config.supplier, seenExternalIds)];
                    case 38:
                        discontinuedCount = _e.sent();
                        return [3 /*break*/, 40];
                    case 39:
                        console.log("[Scraper] Skipping mark discontinued (category-specific scrape)");
                        _e.label = 40;
                    case 40:
                        result.created = created;
                        result.updated = updated;
                        result.errors.push("Unchanged: ".concat(unchanged, ", Discontinued: ").concat(discontinuedCount));
                        if (!this.currentRun) return [3 /*break*/, 42];
                        return [4 /*yield*/, scraperRunRepository.markCompleted(this.currentRun.runId, {
                                productsScraped: this.productsScrapedCount,
                                productsSaved: this.productsSavedCount,
                                durationMs: result.durationMs,
                            })];
                    case 41:
                        _e.sent();
                        _e.label = 42;
                    case 42:
                        result.success = true;
                        console.log("[Scraper] Completed: ".concat(created, " created, ").concat(updated, " updated, ").concat(unchanged, " unchanged, ").concat(discontinuedCount, " discontinued"));
                        return [3 /*break*/, 51];
                    case 43:
                        error_10 = _e.sent();
                        message = error_10 instanceof Error ? error_10.message : "Unknown error";
                        scraperError = error_10;
                        result.errors.push("Error: ".concat(message));
                        console.error("[Scraper] Pipeline failed:", message);
                        if (!this.currentRun) return [3 /*break*/, 46];
                        return [4 /*yield*/, scraperRunRepository.updateCheckpoint(this.currentRun.runId, {
                                currentCategoryIndex: this.currentCategoryIndex,
                                lastPageNumber: this.currentPageNum,
                                productsScraped: this.productsScrapedCount,
                                productsSaved: this.productsSavedCount,
                            })];
                    case 44:
                        _e.sent();
                        return [4 /*yield*/, scraperRunRepository.markFailed(this.currentRun.runId, message)];
                    case 45:
                        _e.sent();
                        _e.label = 46;
                    case 46:
                        // Provide more specific error codes
                        if (scraperError.code === "AUTH_FAILED") {
                            throw error_10; // Re-throw auth errors
                        }
                        return [3 /*break*/, 51];
                    case 47:
                        result.durationMs = Date.now() - startTime;
                        if (!page) return [3 /*break*/, 49];
                        return [4 /*yield*/, page.close()];
                    case 48:
                        _e.sent();
                        _e.label = 49;
                    case 49: return [4 /*yield*/, this.closeBrowser()];
                    case 50:
                        _e.sent();
                        return [7 /*endfinally*/];
                    case 51: return [2 /*return*/, result];
                }
            });
        });
    };
    /**
     * Save checkpoint for current progress
     */
    ScraperService.prototype.saveCheckpoint = function (category, pageNum) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.currentRun)
                            return [2 /*return*/];
                        return [4 /*yield*/, scraperRunRepository.updateCheckpoint(this.currentRun.runId, {
                                lastCategoryId: category.id,
                                lastCategoryName: category.name,
                                currentCategoryIndex: this.currentCategoryIndex,
                                lastPageNumber: pageNum,
                                productsScraped: this.productsScrapedCount,
                                productsSaved: this.productsSavedCount,
                            })];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    return ScraperService;
}());
exports.ScraperService = ScraperService;
/**
 * Create a simple function to run the scraper
 * @param request - Optional request to filter by category
 */
function runScraper(request) {
    return __awaiter(this, void 0, void 0, function () {
        var scraper;
        return __generator(this, function (_a) {
            scraper = new ScraperService(undefined, request);
            return [2 /*return*/, scraper.run()];
        });
    });
}
