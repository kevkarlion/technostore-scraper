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
exports.preCheckCategories = preCheckCategories;
exports.runIncrementalScraper = runIncrementalScraper;
var playwright_1 = require("playwright");
var config_1 = require("./config");
var scraper_service_1 = require("./scraper.service");
var crypto_1 = __importDefault(require("crypto"));
// Set browsers path
var BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || "/tmp/ms-playwright";
process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_PATH;
process.env.HOME = "/tmp";
console.log("[Scraper] Initialized PLAYWRIGHT_BROWSERS_PATH:", BROWSERS_PATH);
/**
 * Incremental Scraper - runs smart scraping every 2 hours
 *
 * Flow:
 * 1. Pre-check: Get first page of each category and calculate hash
 * 2. Compare with previous state - if changed, mark for re-scrape
 * 3. Only scrape categories that changed
 * 4. Update state in DB
 */
var MAX_PARALLEL_PAGES = 2;
// Find chromium executable
function getChromiumExecutable() {
    return __awaiter(this, void 0, void 0, function () {
        var fs, pathModule, execSync, possiblePaths, _i, possiblePaths_1, p, downloadDir, searchPaths, _a, searchPaths_1, p;
        return __generator(this, function (_b) {
            fs = require("fs");
            pathModule = require("path");
            execSync = require("child_process").execSync;
            possiblePaths = [
                "/vercel/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome",
                "/vercel/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell",
                "/home/sbx_user1051/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome",
                "/home/sbx_user1051/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell",
                pathModule.join(BROWSERS_PATH, "chromium-1208", "chrome-linux64", "chrome"),
                pathModule.join(BROWSERS_PATH, "chromium_headless_shell-1208", "chrome-headless-shell-linux64", "chrome-headless-shell"),
                pathModule.join("/tmp", "ms-playwright", "chromium-1208", "chrome-linux64", "chrome"),
            ];
            console.log("[Scraper] Looking for chromium in", possiblePaths.length, "locations...");
            for (_i = 0, possiblePaths_1 = possiblePaths; _i < possiblePaths_1.length; _i++) {
                p = possiblePaths_1[_i];
                try {
                    console.log("[Scraper] Checking:", p);
                    if (p && fs.existsSync(p)) {
                        console.log("[Scraper] FOUND chromium at:", p);
                        return [2 /*return*/, p];
                    }
                }
                catch (e) {
                    console.log("[Scraper] Error checking path:", e);
                }
            }
            // Try to download
            console.log("[Scraper] No chromium found, attempting download...");
            try {
                downloadDir = BROWSERS_PATH;
                try {
                    fs.mkdirSync(downloadDir, { recursive: true });
                }
                catch (_c) {
                    /* ignore */
                }
                console.log("[Scraper] Running: npx playwright install chromium");
                execSync("npx playwright install chromium", {
                    stdio: "inherit",
                    env: __assign(__assign({}, process.env), { PLAYWRIGHT_BROWSERS_PATH: downloadDir, HOME: "/tmp" }),
                });
                searchPaths = [
                    pathModule.join(downloadDir, "chromium-1208", "chrome-linux64", "chrome"),
                    pathModule.join(downloadDir, "ms-playwright", "chromium-1208", "chrome-linux64", "chrome"),
                    "/tmp/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome",
                ];
                for (_a = 0, searchPaths_1 = searchPaths; _a < searchPaths_1.length; _a++) {
                    p = searchPaths_1[_a];
                    console.log("[Scraper] Checking downloaded:", p);
                    if (p && fs.existsSync(p)) {
                        console.log("[Scraper] Downloaded chromium at:", p);
                        return [2 /*return*/, p];
                    }
                }
            }
            catch (e) {
                console.log("[Scraper] Download failed:", e);
            }
            console.log("[Scraper] WARNING: Returning undefined - playwright will use default");
            return [2 /*return*/, undefined];
        });
    });
}
/**
 * Generate MD5 hash of page content
 */
function generateContentHash(content) {
    return crypto_1.default.createHash("md5").update(content).digest("hex");
}
/**
 * Get category preview (lightweight info from first page)
 */
function getCategoryPreview(page, idsubrubro1, baseUrl) {
    return __awaiter(this, void 0, void 0, function () {
        var url, content, contentHash, items, productIds, seenIds, _i, items_1, item, href, idMatch, firstPriceUsd, firstItemText, _a, priceMatch, error_1;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 12, , 13]);
                    url = "".concat(baseUrl, "/buscar.aspx?idsubrubro1=").concat(idsubrubro1, "&pag=1");
                    return [4 /*yield*/, page.goto(url, { waitUntil: "networkidle", timeout: 30000 })];
                case 1:
                    _b.sent();
                    return [4 /*yield*/, page.waitForSelector("div:has-text('U$D')", { timeout: 10000 }).catch(function () { })];
                case 2:
                    _b.sent();
                    return [4 /*yield*/, page.content()];
                case 3:
                    content = _b.sent();
                    contentHash = generateContentHash(content);
                    return [4 /*yield*/, page.locator("a[href*='articulo.aspx?id=']").all()];
                case 4:
                    items = _b.sent();
                    productIds = [];
                    seenIds = new Set();
                    _i = 0, items_1 = items;
                    _b.label = 5;
                case 5:
                    if (!(_i < items_1.length)) return [3 /*break*/, 8];
                    item = items_1[_i];
                    return [4 /*yield*/, item.getAttribute("href")];
                case 6:
                    href = _b.sent();
                    if (href) {
                        idMatch = href.match(/id=(\d+)/);
                        if (idMatch && !seenIds.has(idMatch[1])) {
                            seenIds.add(idMatch[1]);
                            productIds.push(idMatch[1]);
                        }
                    }
                    _b.label = 7;
                case 7:
                    _i++;
                    return [3 /*break*/, 5];
                case 8:
                    firstPriceUsd = void 0;
                    if (!items[0]) return [3 /*break*/, 10];
                    return [4 /*yield*/, items[0].textContent()];
                case 9:
                    _a = _b.sent();
                    return [3 /*break*/, 11];
                case 10:
                    _a = null;
                    _b.label = 11;
                case 11:
                    firstItemText = _a;
                    if (firstItemText) {
                        priceMatch = firstItemText.match(/U\$D\s+([\d.,]+)/);
                        if (priceMatch) {
                            firstPriceUsd = priceMatch[1];
                        }
                    }
                    return [2 /*return*/, {
                            contentHash: contentHash,
                            productCount: productIds.length,
                            productIds: productIds,
                            firstPriceUsd: firstPriceUsd,
                        }];
                case 12:
                    error_1 = _b.sent();
                    console.error("[Incremental] Error getting preview for idsubrubro1=".concat(idsubrubro1, ":"), error_1);
                    return [2 /*return*/, null];
                case 13: return [2 /*return*/];
            }
        });
    });
}
/**
 * Get DB connection
 */
function getDb() {
    return __awaiter(this, void 0, void 0, function () {
        var MongoClient, MONGO_URI, DB_NAME, client;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, Promise.resolve().then(function () { return __importStar(require("mongodb")); })];
                case 1:
                    MongoClient = (_a.sent()).MongoClient;
                    MONGO_URI = process.env.MONGO_URI;
                    DB_NAME = process.env.DB_NAME || "technostore";
                    if (!MONGO_URI) {
                        throw new Error("MONGO_URI is required");
                    }
                    client = new MongoClient(MONGO_URI);
                    return [4 /*yield*/, client.connect()];
                case 2:
                    _a.sent();
                    return [2 /*return*/, client.db(DB_NAME)];
            }
        });
    });
}
/**
 * Pre-check all categories - parallel version
 */
function preCheckCategories(categories) {
    return __awaiter(this, void 0, void 0, function () {
        var result, config, chromiumPath, e_1, browser, context_1, loginPage, branchSelect, _a, i, batch, batchPromises, batchResults, _i, batchResults_1, r;
        var _this = this;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    result = {
                        changed: [],
                        unchanged: [],
                        errors: [],
                    };
                    config = (0, config_1.getScraperConfig)();
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, getChromiumExecutable()];
                case 2:
                    chromiumPath = _b.sent();
                    return [3 /*break*/, 4];
                case 3:
                    e_1 = _b.sent();
                    console.log("[Scraper] Error getting chromium:", e_1);
                    return [3 /*break*/, 4];
                case 4:
                    console.log("[Scraper] Using chromium path:", chromiumPath || "default");
                    return [4 /*yield*/, playwright_1.chromium.launch(__assign({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] }, (chromiumPath ? { executablePath: chromiumPath } : {})))];
                case 5:
                    browser = _b.sent();
                    _b.label = 6;
                case 6:
                    _b.trys.push([6, , 27, 29]);
                    console.log("[Incremental] Login for pre-check...");
                    return [4 /*yield*/, browser.newContext()];
                case 7:
                    context_1 = _b.sent();
                    return [4 /*yield*/, context_1.newPage()];
                case 8:
                    loginPage = _b.sent();
                    return [4 /*yield*/, loginPage.goto(config.loginUrl, { waitUntil: "networkidle" })];
                case 9:
                    _b.sent();
                    return [4 /*yield*/, loginPage.fill(config.selectors.login.emailInputSelector, config.email)];
                case 10:
                    _b.sent();
                    return [4 /*yield*/, loginPage.fill(config.selectors.login.passwordInputSelector, config.password)];
                case 11:
                    _b.sent();
                    return [4 /*yield*/, loginPage.click(config.selectors.login.submitButtonSelector)];
                case 12:
                    _b.sent();
                    return [4 /*yield*/, loginPage.waitForLoadState("networkidle")];
                case 13:
                    _b.sent();
                    return [4 /*yield*/, loginPage.waitForTimeout(2000)];
                case 14:
                    _b.sent();
                    _b.label = 15;
                case 15:
                    _b.trys.push([15, 20, , 21]);
                    branchSelect = loginPage.locator("#ContentPlaceHolder1_ddlSucursal, #ddlSucursal").first();
                    return [4 /*yield*/, branchSelect.count()];
                case 16:
                    if (!((_b.sent()) > 0)) return [3 /*break*/, 19];
                    return [4 /*yield*/, branchSelect.selectOption({ index: 1 })];
                case 17:
                    _b.sent();
                    return [4 /*yield*/, loginPage.waitForLoadState("networkidle")];
                case 18:
                    _b.sent();
                    _b.label = 19;
                case 19: return [3 /*break*/, 21];
                case 20:
                    _a = _b.sent();
                    return [3 /*break*/, 21];
                case 21: return [4 /*yield*/, loginPage.close()];
                case 22:
                    _b.sent();
                    console.log("[Incremental] Pre-checking categories in parallel...");
                    i = 0;
                    _b.label = 23;
                case 23:
                    if (!(i < categories.length)) return [3 /*break*/, 26];
                    batch = categories.slice(i, i + MAX_PARALLEL_PAGES);
                    console.log("[Incremental] Pre-check batch ".concat(Math.floor(i / MAX_PARALLEL_PAGES) + 1, ": ").concat(batch.map(function (c) { return c.name; }).join(", ")));
                    batchPromises = batch.map(function (cat) { return __awaiter(_this, void 0, void 0, function () {
                        var page, preview, db, existing, hasChanged, error_2;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0: return [4 /*yield*/, context_1.newPage()];
                                case 1:
                                    page = _a.sent();
                                    _a.label = 2;
                                case 2:
                                    _a.trys.push([2, 8, , 10]);
                                    return [4 /*yield*/, getCategoryPreview(page, cat.idsubrubro1, config.baseUrl)];
                                case 3:
                                    preview = _a.sent();
                                    return [4 /*yield*/, page.close()];
                                case 4:
                                    _a.sent();
                                    if (!preview) {
                                        return [2 /*return*/, { categoryId: cat.id, status: "error" }];
                                    }
                                    return [4 /*yield*/, getDb()];
                                case 5:
                                    db = _a.sent();
                                    return [4 /*yield*/, db.collection("scraper_state").findOne({ categoryId: cat.id })];
                                case 6:
                                    existing = _a.sent();
                                    hasChanged = !existing || existing.contentHash !== preview.contentHash;
                                    // Save snapshot
                                    return [4 /*yield*/, db.collection("scraper_state").updateOne({ categoryId: cat.id }, {
                                            $set: {
                                                categoryId: cat.id,
                                                idsubrubro1: cat.idsubrubro1,
                                                contentHash: preview.contentHash,
                                                productCount: preview.productCount,
                                                productIds: preview.productIds,
                                                firstPriceUsd: preview.firstPriceUsd,
                                                capturedAt: new Date(),
                                            },
                                        }, { upsert: true })];
                                case 7:
                                    // Save snapshot
                                    _a.sent();
                                    return [2 /*return*/, {
                                            categoryId: cat.id,
                                            status: hasChanged ? "changed" : "unchanged",
                                            count: preview.productCount,
                                        }];
                                case 8:
                                    error_2 = _a.sent();
                                    return [4 /*yield*/, page.close()];
                                case 9:
                                    _a.sent();
                                    return [2 /*return*/, { categoryId: cat.id, status: "error" }];
                                case 10: return [2 /*return*/];
                            }
                        });
                    }); });
                    return [4 /*yield*/, Promise.all(batchPromises)];
                case 24:
                    batchResults = _b.sent();
                    // Process results
                    for (_i = 0, batchResults_1 = batchResults; _i < batchResults_1.length; _i++) {
                        r = batchResults_1[_i];
                        if (r.status === "changed") {
                            result.changed.push(r.categoryId);
                            console.log("[Incremental] Changed: ".concat(r.categoryId, " (count: ").concat(r.count, ")"));
                        }
                        else if (r.status === "unchanged") {
                            result.unchanged.push(r.categoryId);
                            console.log("[Incremental] Unchanged: ".concat(r.categoryId));
                        }
                        else {
                            result.errors.push(r.categoryId);
                            console.log("[Incremental] Error: ".concat(r.categoryId));
                        }
                    }
                    _b.label = 25;
                case 25:
                    i += MAX_PARALLEL_PAGES;
                    return [3 /*break*/, 23];
                case 26: return [3 /*break*/, 29];
                case 27: return [4 /*yield*/, browser.close()];
                case 28:
                    _b.sent();
                    return [7 /*endfinally*/];
                case 29:
                    console.log("[Incremental] Pre-check complete: ".concat(result.changed.length, " changed, ").concat(result.unchanged.length, " unchanged, ").concat(result.errors.length, " errors"));
                    return [2 /*return*/, result];
            }
        });
    });
}
/**
 * Run incremental scraper with auto resume
 * 1. Pre-check all categories (parallel)
 * 2. Only scrape changed ones (parallel)
 * 3. Update states
 */
function runIncrementalScraper() {
    return __awaiter(this, arguments, void 0, function (forceFullScrape) {
        var categories, preCheckResult, processedCategories, db, allStates, _i, allStates_1, state, lastScrape, now, hoursDiff, e_2, categoriesToScrape, scrapeResults, startTime, i, batch, batchPromises, batchResults, _a, batchResults_2, r;
        var _b;
        var _this = this;
        if (forceFullScrape === void 0) { forceFullScrape = false; }
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    console.log("[Incremental] Starting incremental scraper (parallel)...");
                    categories = config_1.jotakpCategories
                        .filter(function (c) { return c.idsubrubro1 > 0; })
                        .map(function (c) { return ({ id: c.id, idsubrubro1: c.idsubrubro1, name: c.name }); });
                    if (!forceFullScrape) return [3 /*break*/, 1];
                    console.log("[Incremental] Force full scrape - skipping pre-check");
                    preCheckResult = {
                        changed: categories.map(function (c) { return c.id; }),
                        unchanged: [],
                        errors: [],
                    };
                    return [3 /*break*/, 3];
                case 1: return [4 /*yield*/, preCheckCategories(categories)];
                case 2:
                    preCheckResult = _c.sent();
                    _c.label = 3;
                case 3:
                    console.log("[Incremental] Pre-check result: ".concat(preCheckResult.changed.length, " changed, ").concat(preCheckResult.unchanged.length, " unchanged"));
                    // If no changes, finish
                    if (preCheckResult.changed.length === 0) {
                        return [2 /*return*/, {
                                success: true,
                                preCheck: {
                                    total: categories.length,
                                    changed: preCheckResult.changed,
                                    unchanged: preCheckResult.unchanged,
                                    errors: preCheckResult.errors,
                                },
                                timestamp: new Date(),
                            }];
                    }
                    processedCategories = new Set();
                    _c.label = 4;
                case 4:
                    _c.trys.push([4, 7, , 8]);
                    return [4 /*yield*/, getDb()];
                case 5:
                    db = _c.sent();
                    return [4 /*yield*/, db.collection("scraper_state").find().toArray()];
                case 6:
                    allStates = _c.sent();
                    for (_i = 0, allStates_1 = allStates; _i < allStates_1.length; _i++) {
                        state = allStates_1[_i];
                        if (state.lastScrapeAt) {
                            lastScrape = new Date(state.lastScrapeAt);
                            now = new Date();
                            hoursDiff = (now.getTime() - lastScrape.getTime()) / (1000 * 60 * 60);
                            if (hoursDiff < 2) {
                                processedCategories.add(state.categoryId);
                            }
                        }
                    }
                    console.log("[Incremental] Found ".concat(processedCategories.size, " recently processed categories, will skip them"));
                    return [3 /*break*/, 8];
                case 7:
                    e_2 = _c.sent();
                    console.log("[Incremental] Could not load previous state, starting fresh");
                    return [3 /*break*/, 8];
                case 8:
                    categoriesToScrape = preCheckResult.changed.filter(function (catId) { return !processedCategories.has(catId); });
                    console.log("[Incremental] Scraping ".concat(categoriesToScrape.length, " categories (filtered from ").concat(preCheckResult.changed.length, ")..."));
                    if (categoriesToScrape.length === 0) {
                        console.log("[Incremental] All categories already processed recently");
                        return [2 /*return*/, {
                                success: true,
                                preCheck: {
                                    total: categories.length,
                                    changed: preCheckResult.changed,
                                    unchanged: preCheckResult.unchanged,
                                    errors: preCheckResult.errors,
                                },
                                timestamp: new Date(),
                            }];
                    }
                    scrapeResults = {
                        created: 0,
                        updated: 0,
                        errors: [],
                        durationMs: 0,
                    };
                    startTime = Date.now();
                    i = 0;
                    _c.label = 9;
                case 9:
                    if (!(i < categoriesToScrape.length)) return [3 /*break*/, 12];
                    batch = categoriesToScrape.slice(i, i + MAX_PARALLEL_PAGES);
                    console.log("[Incremental] Scraping batch ".concat(Math.floor(i / MAX_PARALLEL_PAGES) + 1, ": ").concat(batch.join(", ")));
                    batchPromises = batch.map(function (categoryId) { return __awaiter(_this, void 0, void 0, function () {
                        var result, cat, db, error_3;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    _a.trys.push([0, 5, , 6]);
                                    return [4 /*yield*/, (0, scraper_service_1.runScraper)({
                                            categoryId: categoryId,
                                            source: "incremental",
                                        })];
                                case 1:
                                    result = _a.sent();
                                    cat = config_1.jotakpCategories.find(function (c) { return c.id === categoryId; });
                                    if (!cat) return [3 /*break*/, 4];
                                    return [4 /*yield*/, getDb()];
                                case 2:
                                    db = _a.sent();
                                    return [4 /*yield*/, db.collection("scraper_state").updateOne({ categoryId: cat.id }, {
                                            $set: {
                                                lastScrapeAt: new Date(),
                                            },
                                        })];
                                case 3:
                                    _a.sent();
                                    _a.label = 4;
                                case 4: return [2 /*return*/, result];
                                case 5:
                                    error_3 = _a.sent();
                                    console.error("[Incremental] Error scraping ".concat(categoryId, ":"), error_3);
                                    return [2 /*return*/, {
                                            created: 0,
                                            updated: 0,
                                            errors: ["Error scraping ".concat(categoryId)],
                                            success: false,
                                        }];
                                case 6: return [2 /*return*/];
                            }
                        });
                    }); });
                    return [4 /*yield*/, Promise.all(batchPromises)];
                case 10:
                    batchResults = _c.sent();
                    for (_a = 0, batchResults_2 = batchResults; _a < batchResults_2.length; _a++) {
                        r = batchResults_2[_a];
                        scrapeResults.created += r.created;
                        scrapeResults.updated += r.updated;
                        (_b = scrapeResults.errors).push.apply(_b, r.errors);
                    }
                    _c.label = 11;
                case 11:
                    i += MAX_PARALLEL_PAGES;
                    return [3 /*break*/, 9];
                case 12:
                    scrapeResults.durationMs = Date.now() - startTime;
                    // ============================================================
                    // MARK DISCONTINUED
                    // ============================================================
                    try {
                        console.log("[Incremental] Scraping completed: ".concat(scrapeResults.created, " created, ").concat(scrapeResults.updated, " updated"));
                    }
                    catch (e) {
                        console.log("[Incremental] Error marking discontinued:", e);
                    }
                    return [2 /*return*/, {
                            success: true,
                            preCheck: {
                                total: categories.length,
                                changed: preCheckResult.changed,
                                unchanged: preCheckResult.unchanged,
                                errors: preCheckResult.errors,
                            },
                            scrapeResult: scrapeResults,
                            timestamp: new Date(),
                        }];
            }
        });
    });
}
