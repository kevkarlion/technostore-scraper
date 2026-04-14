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
require("dotenv/config");
var express_1 = __importDefault(require("express"));
var playwright_1 = require("playwright");
var mongodb_1 = require("mongodb");
var crypto_1 = __importDefault(require("crypto"));
// Import new scraper modules (use alias to avoid conflict)
var index_1 = require("./src/lib/scraper/index");
// CONFIG - with defaults and logging
var SUPPLIER_URL = process.env.SUPPLIER_URL || 'https://jotakp.dyndns.org';
var SUPPLIER_LOGIN_URL = process.env.SUPPLIER_LOGIN_URL || 'http://jotakp.dyndns.org/loginext.aspx';
var SUPPLIER_EMAIL = process.env.SUPPLIER_EMAIL || '20418216795';
var SUPPLIER_PASSWORD = process.env.SUPPLIER_PASSWORD || '123456';
console.log('[Config] SUPPLIER_URL:', SUPPLIER_URL);
console.log('[Config] SUPPLIER_EMAIL:', SUPPLIER_EMAIL);
var SCRAPER_CONFIG = {
    baseUrl: SUPPLIER_URL,
    loginUrl: SUPPLIER_LOGIN_URL,
    email: SUPPLIER_EMAIL,
    password: SUPPLIER_PASSWORD,
    selectors: {
        login: {
            emailInputSelector: '#ContentPlaceHolder1_txtUsuario, #txtUsuario',
            passwordInputSelector: '#ContentPlaceHolder1_txtClave, #txtClave',
            submitButtonSelector: '#ContentPlaceHolder1_btnIngresar, #btnIngresar'
        }
    }
};
// Validation
if (!SCRAPER_CONFIG.email) {
    throw new Error('SUPPLIER_EMAIL is required');
}
if (!SCRAPER_CONFIG.password) {
    throw new Error('SUPPLIER_PASSWORD is required');
}
if (!SCRAPER_CONFIG.selectors.login.emailInputSelector) {
    throw new Error('emailInputSelector is undefined');
}
console.log('[Config] Selectors:', SCRAPER_CONFIG.selectors.login);
var JOTAKP_CATEGORIES = [
    { id: 'carry-caddy-disk', idsubrubro1: 100 },
    { id: 'cd-dvd-bluray', idsubrubro1: 13 },
    { id: 'discos-externos', idsubrubro1: 14 },
    { id: 'discos-hdd', idsubrubro1: 69 },
    { id: 'discos-m2', idsubrubro1: 157 },
    { id: 'discos-ssd', idsubrubro1: 156 },
    { id: 'memorias-flash', idsubrubro1: 12 },
    { id: 'pendrive', idsubrubro1: 5 },
    { id: 'memorias', idsubrubro1: 1 },
    { id: 'auricular-bluetooth', idsubrubro1: 149 },
    { id: 'auricular-cableado', idsubrubro1: 36 },
    { id: 'microfonos', idsubrubro1: 45 },
    { id: 'parlantes', idsubrubro1: 35 },
];
var CATEGORIES = JOTAKP_CATEGORIES;
var MAX_PARALLEL = 2;
var MAX_PAGES = 3;
var MONGO_URI = process.env.MONGO_URI;
var DB_NAME = process.env.DB_NAME || 'technostore';
var db;
function getDb() {
    return __awaiter(this, void 0, void 0, function () {
        var client;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!!db) return [3 /*break*/, 2];
                    client = new mongodb_1.MongoClient(MONGO_URI);
                    return [4 /*yield*/, client.connect()];
                case 1:
                    _a.sent();
                    db = client.db(DB_NAME);
                    // Expose globally for scraper modules
                    global.db = db;
                    _a.label = 2;
                case 2: return [2 /*return*/, db];
            }
        });
    });
}
function generateContentHash(content) {
    return crypto_1.default.createHash('md5').update(content).digest('hex');
}
function getCategoryPreview(page, idsubrubro1, baseUrl) {
    return __awaiter(this, void 0, void 0, function () {
        var url, content, contentHash, items, productIds, seenIds, _i, items_1, item, href, match, e_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 9, , 10]);
                    url = baseUrl + '/buscar.aspx?idsubrubro1=' + idsubrubro1 + '&pag=1';
                    return [4 /*yield*/, page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, page.waitForSelector("div:has-text('U$D')", { timeout: 10000 }).catch(function () { })];
                case 2:
                    _a.sent();
                    return [4 /*yield*/, page.content()];
                case 3:
                    content = _a.sent();
                    contentHash = generateContentHash(content);
                    return [4 /*yield*/, page.locator('a[href*="articulo.aspx?id="]').all()];
                case 4:
                    items = _a.sent();
                    productIds = [];
                    seenIds = new Set();
                    _i = 0, items_1 = items;
                    _a.label = 5;
                case 5:
                    if (!(_i < items_1.length)) return [3 /*break*/, 8];
                    item = items_1[_i];
                    return [4 /*yield*/, item.getAttribute('href')];
                case 6:
                    href = _a.sent();
                    if (href) {
                        match = href.match(/id=(\d+)/);
                        if (match && !seenIds.has(match[1])) {
                            seenIds.add(match[1]);
                            productIds.push(match[1]);
                        }
                    }
                    _a.label = 7;
                case 7:
                    _i++;
                    return [3 /*break*/, 5];
                case 8: return [2 /*return*/, { contentHash: contentHash, productCount: productIds.length, productIds: productIds }];
                case 9:
                    e_1 = _a.sent();
                    console.error('[Pre-check] Error:', e_1.message);
                    return [2 /*return*/, null];
                case 10: return [2 /*return*/];
            }
        });
    });
}
function preCheckCategories(categories, page) {
    return __awaiter(this, void 0, void 0, function () {
        var result, i, batch, batchPromises, batchResults, _i, batchResults_1, r;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    result = { changed: [], unchanged: [], errors: [] };
                    console.log('[Pre-check] Checking', categories.length, 'categories...');
                    i = 0;
                    _a.label = 1;
                case 1:
                    if (!(i < categories.length)) return [3 /*break*/, 4];
                    batch = categories.slice(i, i + MAX_PARALLEL);
                    console.log('[Pre-check] Batch', Math.floor(i / MAX_PARALLEL) + 1);
                    batchPromises = batch.map(function (cat) { return __awaiter(_this, void 0, void 0, function () {
                        var preview, database, existing, hasChanged;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0: return [4 /*yield*/, getCategoryPreview(page, cat.idsubrubro1, SCRAPER_CONFIG.baseUrl)];
                                case 1:
                                    preview = _a.sent();
                                    if (!preview)
                                        return [2 /*return*/, { categoryId: cat.id, status: 'error' }];
                                    return [4 /*yield*/, getDb()];
                                case 2:
                                    database = _a.sent();
                                    return [4 /*yield*/, database.collection('scraper_state').findOne({ categoryId: cat.id })];
                                case 3:
                                    existing = _a.sent();
                                    hasChanged = !existing || existing.contentHash !== preview.contentHash;
                                    return [4 /*yield*/, database.collection('scraper_state').updateOne({ categoryId: cat.id }, { $set: { categoryId: cat.id, idsubrubro1: cat.idsubrubro1, contentHash: preview.contentHash, productCount: preview.productCount, capturedAt: new Date() } }, { upsert: true })];
                                case 4:
                                    _a.sent();
                                    return [2 /*return*/, { categoryId: cat.id, status: hasChanged ? 'changed' : 'unchanged', count: preview.productCount }];
                            }
                        });
                    }); });
                    return [4 /*yield*/, Promise.all(batchPromises)];
                case 2:
                    batchResults = _a.sent();
                    for (_i = 0, batchResults_1 = batchResults; _i < batchResults_1.length; _i++) {
                        r = batchResults_1[_i];
                        if (r.status === 'changed')
                            result.changed.push(r.categoryId);
                        else if (r.status === 'unchanged')
                            result.unchanged.push(r.categoryId);
                        else
                            result.errors.push(r.categoryId);
                    }
                    _a.label = 3;
                case 3:
                    i += MAX_PARALLEL;
                    return [3 /*break*/, 1];
                case 4:
                    console.log('[Pre-check] Complete:', result.changed.length, 'changed');
                    return [2 /*return*/, result];
            }
        });
    });
}
function scrapeCategoryProducts(page, categoryId, idsubrubro1) {
    return __awaiter(this, void 0, void 0, function () {
        var products, scrapedIds, pageNum, url, items, _i, items_2, item, href, fullText, match, externalId, price, priceMatch, name_1, description, desc, _a, stock, stockEl, stockText, stockMatch, _b, sku, skuEl, _c, imageUrls, imgs, _d, _e, img, src, _f, e_2, _g, e_3;
        return __generator(this, function (_h) {
            switch (_h.label) {
                case 0:
                    console.log('[Scraper] Scraping:', categoryId);
                    products = [];
                    scrapedIds = [];
                    pageNum = 1;
                    _h.label = 1;
                case 1:
                    if (!(pageNum <= MAX_PAGES)) return [3 /*break*/, 48];
                    url = SCRAPER_CONFIG.baseUrl + '/buscar.aspx?idsubrubro1=' + idsubrubro1 + '&pag=' + pageNum;
                    _h.label = 2;
                case 2:
                    _h.trys.push([2, 46, , 47]);
                    return [4 /*yield*/, page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })];
                case 3:
                    _h.sent();
                    return [4 /*yield*/, page.waitForSelector('a[href*="articulo.aspx?id="]', { timeout: 5000 }).catch(function () { })];
                case 4:
                    _h.sent();
                    return [4 /*yield*/, page.locator('a[href*="articulo.aspx?id="]').all()];
                case 5:
                    items = _h.sent();
                    if (items.length === 0)
                        return [3 /*break*/, 48];
                    console.log('[Scraper] Page', pageNum, ':', items.length, 'products');
                    _i = 0, items_2 = items;
                    _h.label = 6;
                case 6:
                    if (!(_i < items_2.length)) return [3 /*break*/, 45];
                    item = items_2[_i];
                    _h.label = 7;
                case 7:
                    _h.trys.push([7, 39, , 44]);
                    return [4 /*yield*/, item.getAttribute('href')];
                case 8:
                    href = _h.sent();
                    return [4 /*yield*/, item.textContent()];
                case 9:
                    fullText = _h.sent();
                    match = href.match(/id=(\d+)/);
                    externalId = match ? match[1] : null;
                    if (!externalId)
                        return [3 /*break*/, 44];
                    price = null;
                    priceMatch = fullText.match(/U\$D\s+([\d.,]+)/);
                    if (priceMatch)
                        price = parseFloat(priceMatch[1].replace(',', '.'));
                    name_1 = fullText.replace(/U\$D[\s\d.,+IVA%]+$/, '').trim();
                    if (!name_1 || name_1.length < 3)
                        return [3 /*break*/, 44];
                    return [4 /*yield*/, page.goto(SCRAPER_CONFIG.baseUrl + '/articulo.aspx?id=' + externalId, { waitUntil: 'networkidle', timeout: 30000 })];
                case 10:
                    _h.sent();
                    description = '';
                    _h.label = 11;
                case 11:
                    _h.trys.push([11, 15, , 16]);
                    return [4 /*yield*/, page.$('#ContentPlaceHolder1_lblDescripcion')];
                case 12:
                    desc = _h.sent();
                    if (!desc) return [3 /*break*/, 14];
                    return [4 /*yield*/, desc.textContent()];
                case 13:
                    description = (_h.sent()) || '';
                    _h.label = 14;
                case 14: return [3 /*break*/, 16];
                case 15:
                    _a = _h.sent();
                    return [3 /*break*/, 16];
                case 16:
                    stock = 0;
                    _h.label = 17;
                case 17:
                    _h.trys.push([17, 21, , 22]);
                    return [4 /*yield*/, page.$('#ContentPlaceHolder1_lblStock')];
                case 18:
                    stockEl = _h.sent();
                    if (!stockEl) return [3 /*break*/, 20];
                    return [4 /*yield*/, stockEl.textContent()];
                case 19:
                    stockText = (_h.sent()) || '';
                    stockMatch = stockText.match(/(\d+)/);
                    stock = stockMatch ? parseInt(stockMatch[1]) : 0;
                    _h.label = 20;
                case 20: return [3 /*break*/, 22];
                case 21:
                    _b = _h.sent();
                    return [3 /*break*/, 22];
                case 22:
                    sku = '';
                    _h.label = 23;
                case 23:
                    _h.trys.push([23, 27, , 28]);
                    return [4 /*yield*/, page.$('#ContentPlaceHolder1_lblCodigo')];
                case 24:
                    skuEl = _h.sent();
                    if (!skuEl) return [3 /*break*/, 26];
                    return [4 /*yield*/, skuEl.textContent()];
                case 25:
                    sku = (_h.sent()) || '';
                    _h.label = 26;
                case 26: return [3 /*break*/, 28];
                case 27:
                    _c = _h.sent();
                    return [3 /*break*/, 28];
                case 28:
                    imageUrls = [];
                    _h.label = 29;
                case 29:
                    _h.trys.push([29, 35, , 36]);
                    return [4 /*yield*/, page.locator('div.tg-img-overlay.artImg').all()];
                case 30:
                    imgs = _h.sent();
                    _d = 0, _e = imgs.slice(0, 5);
                    _h.label = 31;
                case 31:
                    if (!(_d < _e.length)) return [3 /*break*/, 34];
                    img = _e[_d];
                    return [4 /*yield*/, img.getAttribute('data-src')];
                case 32:
                    src = _h.sent();
                    if (src && src.includes('imagenes/'))
                        imageUrls.push(src);
                    _h.label = 33;
                case 33:
                    _d++;
                    return [3 /*break*/, 31];
                case 34: return [3 /*break*/, 36];
                case 35:
                    _f = _h.sent();
                    return [3 /*break*/, 36];
                case 36: return [4 /*yield*/, page.goBack()];
                case 37:
                    _h.sent();
                    return [4 /*yield*/, page.waitForLoadState('networkidle').catch(function () { })];
                case 38:
                    _h.sent();
                    products.push({ externalId: externalId, name: name_1, price: price, stock: stock, description: description, sku: sku, imageUrls: imageUrls });
                    scrapedIds.push(externalId);
                    return [3 /*break*/, 44];
                case 39:
                    e_2 = _h.sent();
                    console.log('[Scraper] Error product:', e_2.message);
                    _h.label = 40;
                case 40:
                    _h.trys.push([40, 42, , 43]);
                    return [4 /*yield*/, page.goBack()];
                case 41:
                    _h.sent();
                    return [3 /*break*/, 43];
                case 42:
                    _g = _h.sent();
                    return [3 /*break*/, 43];
                case 43: return [3 /*break*/, 44];
                case 44:
                    _i++;
                    return [3 /*break*/, 6];
                case 45: return [3 /*break*/, 47];
                case 46:
                    e_3 = _h.sent();
                    console.log('[Scraper] Error page', pageNum, ':', e_3.message);
                    return [3 /*break*/, 47];
                case 47:
                    pageNum++;
                    return [3 /*break*/, 1];
                case 48: return [2 /*return*/, { products: products, scrapedIds: scrapedIds }];
            }
        });
    });
}
function saveProduct(product, categoryId) {
    return __awaiter(this, void 0, void 0, function () {
        var database, collection, existing, update, changed, _i, _a, _b, key, value;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, getDb()];
                case 1:
                    database = _c.sent();
                    collection = database.collection('products');
                    return [4 /*yield*/, collection.findOne({ externalId: product.externalId, supplier: 'jotakp' })];
                case 2:
                    existing = _c.sent();
                    update = { lastSyncedAt: new Date(), categories: [categoryId] };
                    if (product.name)
                        update.name = product.name;
                    if (product.price !== null)
                        update.price = product.price;
                    if (product.stock !== undefined)
                        update.stock = product.stock;
                    if (product.description)
                        update.description = product.description;
                    if (product.sku)
                        update.sku = product.sku;
                    if (product.imageUrls && product.imageUrls.length > 0)
                        update.imageUrls = product.imageUrls;
                    if (!existing) return [3 /*break*/, 5];
                    changed = {};
                    for (_i = 0, _a = Object.entries(update); _i < _a.length; _i++) {
                        _b = _a[_i], key = _b[0], value = _b[1];
                        if (key !== 'lastSyncedAt' && key !== 'categories') {
                            if (JSON.stringify(existing[key]) !== JSON.stringify(value))
                                changed[key] = value;
                        }
                    }
                    if (!(Object.keys(changed).length > 0)) return [3 /*break*/, 4];
                    return [4 /*yield*/, collection.updateOne({ _id: existing._id }, { $set: __assign(__assign({}, changed), { lastSyncedAt: new Date() }) })];
                case 3:
                    _c.sent();
                    return [2 /*return*/, { created: false, updated: true }];
                case 4: return [2 /*return*/, { created: false, updated: false }];
                case 5: return [4 /*yield*/, collection.insertOne(__assign(__assign({}, update), { externalId: product.externalId, supplier: 'jotakp', status: 'active', currency: 'USD', attributes: [], createdAt: new Date(), updatedAt: new Date() }))];
                case 6:
                    _c.sent();
                    return [2 /*return*/, { created: true, updated: false }];
            }
        });
    });
}
function markDiscontinued(categoryId, scrapedIds) {
    return __awaiter(this, void 0, void 0, function () {
        var database, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getDb()];
                case 1:
                    database = _a.sent();
                    return [4 /*yield*/, database.collection('products').updateMany({ categories: categoryId, supplier: 'jotakp', externalId: { $nin: scrapedIds } }, { $set: { status: 'discontinued', discontinuedAt: new Date() } })];
                case 2:
                    result = _a.sent();
                    return [2 /*return*/, result.modifiedCount];
            }
        });
    });
}
function runIncrementalScraper() {
    return __awaiter(this, arguments, void 0, function (forceFullScrape) {
        var chromiumPath, browser, results, context, page_1, branchSelect, _a, preCheckResult_1, changedCats, i, batch, batchPromises, batchResults, _i, batchResults_2, r, _b, _c, product, result, count, error_1;
        var _this = this;
        var _d;
        if (forceFullScrape === void 0) { forceFullScrape = false; }
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    console.log('[Incremental] Starting...');
                    chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
                    return [4 /*yield*/, playwright_1.chromium.launch({ headless: true, executablePath: chromiumPath, args: ['--no-sandbox', '--disable-setuid-sandbox'] })];
                case 1:
                    browser = _e.sent();
                    results = { created: 0, updated: 0, unchanged: 0, discontinued: 0 };
                    _e.label = 2;
                case 2:
                    _e.trys.push([2, 32, 33, 35]);
                    console.log('[Incremental] Login...');
                    return [4 /*yield*/, browser.newContext()];
                case 3:
                    context = _e.sent();
                    return [4 /*yield*/, context.newPage()];
                case 4:
                    page_1 = _e.sent();
                    return [4 /*yield*/, page_1.goto(SCRAPER_CONFIG.loginUrl, { waitUntil: 'networkidle' })];
                case 5:
                    _e.sent();
                    return [4 /*yield*/, page_1.fill(SCRAPER_CONFIG.selectors.login.emailInputSelector, SCRAPER_CONFIG.email)];
                case 6:
                    _e.sent();
                    return [4 /*yield*/, page_1.fill(SCRAPER_CONFIG.selectors.login.passwordInputSelector, SCRAPER_CONFIG.password)];
                case 7:
                    _e.sent();
                    return [4 /*yield*/, page_1.click(SCRAPER_CONFIG.selectors.login.submitButtonSelector)];
                case 8:
                    _e.sent();
                    return [4 /*yield*/, page_1.waitForLoadState('networkidle')];
                case 9:
                    _e.sent();
                    return [4 /*yield*/, page_1.waitForTimeout(2000)];
                case 10:
                    _e.sent();
                    _e.label = 11;
                case 11:
                    _e.trys.push([11, 16, , 17]);
                    return [4 /*yield*/, page_1.$('#ContentPlaceHolder1_ddlSucursal, #ddlSucursal')];
                case 12:
                    branchSelect = _e.sent();
                    if (!branchSelect) return [3 /*break*/, 15];
                    return [4 /*yield*/, branchSelect.selectOption({ index: 1 })];
                case 13:
                    _e.sent();
                    return [4 /*yield*/, page_1.waitForLoadState('networkidle')];
                case 14:
                    _e.sent();
                    _e.label = 15;
                case 15: return [3 /*break*/, 17];
                case 16:
                    _a = _e.sent();
                    return [3 /*break*/, 17];
                case 17:
                    console.log('[Incremental] Logged in');
                    if (!forceFullScrape) return [3 /*break*/, 18];
                    preCheckResult_1 = { changed: CATEGORIES.map(function (c) { return c.id; }), unchanged: [], errors: [] };
                    return [3 /*break*/, 20];
                case 18: return [4 /*yield*/, preCheckCategories(CATEGORIES, page_1)];
                case 19:
                    preCheckResult_1 = _e.sent();
                    _e.label = 20;
                case 20:
                    console.log('[Incremental] Pre-check:', preCheckResult_1.changed.length, 'changed');
                    if (preCheckResult_1.changed.length === 0)
                        return [2 /*return*/, { success: true, preCheck: preCheckResult_1 }];
                    changedCats = CATEGORIES.filter(function (c) { return preCheckResult_1.changed.includes(c.id); });
                    i = 0;
                    _e.label = 21;
                case 21:
                    if (!(i < changedCats.length)) return [3 /*break*/, 31];
                    batch = changedCats.slice(i, i + MAX_PARALLEL);
                    console.log('[Incremental] Scraping batch:', batch.map(function (c) { return c.id; }).join(', '));
                    batchPromises = batch.map(function (cat) { return __awaiter(_this, void 0, void 0, function () {
                        var e_4;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    _a.trys.push([0, 2, , 3]);
                                    return [4 /*yield*/, scrapeCategoryProducts(page_1, cat.id, cat.idsubrubro1)];
                                case 1: return [2 /*return*/, _a.sent()];
                                case 2:
                                    e_4 = _a.sent();
                                    console.log('[Incremental] Error', cat.id, ':', e_4.message);
                                    return [2 /*return*/, { products: [], scrapedIds: [] }];
                                case 3: return [2 /*return*/];
                            }
                        });
                    }); });
                    return [4 /*yield*/, Promise.all(batchPromises)];
                case 22:
                    batchResults = _e.sent();
                    _i = 0, batchResults_2 = batchResults;
                    _e.label = 23;
                case 23:
                    if (!(_i < batchResults_2.length)) return [3 /*break*/, 30];
                    r = batchResults_2[_i];
                    _b = 0, _c = r.products;
                    _e.label = 24;
                case 24:
                    if (!(_b < _c.length)) return [3 /*break*/, 27];
                    product = _c[_b];
                    return [4 /*yield*/, saveProduct(product, r.products[0] ? (_d = changedCats.find(function (c) { return preCheckResult_1.changed.includes(c.id); })) === null || _d === void 0 ? void 0 : _d.id : 'unknown')];
                case 25:
                    result = _e.sent();
                    if (result.created)
                        results.created++;
                    else if (result.updated)
                        results.updated++;
                    else
                        results.unchanged++;
                    _e.label = 26;
                case 26:
                    _b++;
                    return [3 /*break*/, 24];
                case 27:
                    if (!(r.scrapedIds.length > 0)) return [3 /*break*/, 29];
                    return [4 /*yield*/, markDiscontinued('unknown', r.scrapedIds)];
                case 28:
                    count = _e.sent();
                    results.discontinued += count;
                    _e.label = 29;
                case 29:
                    _i++;
                    return [3 /*break*/, 23];
                case 30:
                    i += MAX_PARALLEL;
                    return [3 /*break*/, 21];
                case 31:
                    console.log('[Incremental] Done! Created:', results.created, 'Updated:', results.updated);
                    return [2 /*return*/, { success: true, preCheck: preCheckResult_1, scrapeResult: results }];
                case 32:
                    error_1 = _e.sent();
                    console.error('[Incremental] Error:', error_1);
                    return [2 /*return*/, { success: false, error: String(error_1) }];
                case 33: return [4 /*yield*/, browser.close()];
                case 34:
                    _e.sent();
                    return [7 /*endfinally*/];
                case 35: return [2 /*return*/];
            }
        });
    });
}
var app = (0, express_1.default)();
var PORT = process.env.PORT || 3001;
app.use(express_1.default.json());
app.get('/health', function (req, res) { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
    return [2 /*return*/];
}); }); });
app.post('/run', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var forceFullScrape, result, error_2;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                forceFullScrape = req.query.force === 'true';
                return [4 /*yield*/, runIncrementalScraper(forceFullScrape)];
            case 1:
                result = _a.sent();
                res.json(result);
                return [3 /*break*/, 3];
            case 2:
                error_2 = _a.sent();
                res.status(500).json({ success: false, error: String(error_2) });
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); });
app.get('/status', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var database, totalProducts, lastScrapes, e_5;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 4, , 5]);
                return [4 /*yield*/, getDb()];
            case 1:
                database = _a.sent();
                return [4 /*yield*/, database.collection('products').countDocuments({ supplier: 'jotakp', status: 'active' })];
            case 2:
                totalProducts = _a.sent();
                return [4 /*yield*/, database.collection('scraper_state').find().sort({ capturedAt: -1 }).limit(10).toArray()];
            case 3:
                lastScrapes = _a.sent();
                res.json({ status: 'ok', products: totalProducts, lastScrapes: lastScrapes.map(function (s) { return ({ category: s.categoryId, date: s.capturedAt }); }) });
                return [3 /*break*/, 5];
            case 4:
                e_5 = _a.sent();
                res.status(500).json({ error: e_5.message });
                return [3 /*break*/, 5];
            case 5: return [2 /*return*/];
        }
    });
}); });
// NEW: Full scraper endpoints (from TechnoStore)
app.get('/scraper/categories', function (req, res) {
    // List available categories
    var categories = index_1.jotakpCategories.map(function (c) { return ({ id: c.id, name: c.name, idsubrubro1: c.idsubrubro1, parentId: c.parentId }); });
    res.json({ categories: categories });
});
app.post('/scraper/run', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var lastError, attempt, _a, categoryId, idsubrubro1, source, result, error_3;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                lastError = null;
                attempt = 1;
                _b.label = 1;
            case 1:
                if (!(attempt <= 3)) return [3 /*break*/, 8];
                _b.label = 2;
            case 2:
                _b.trys.push([2, 4, , 7]);
                console.log("[Scraper] Attempt ".concat(attempt, "/3..."));
                _a = req.body, categoryId = _a.categoryId, idsubrubro1 = _a.idsubrubro1, source = _a.source;
                return [4 /*yield*/, (0, index_1.runScraper)({ categoryId: categoryId, idsubrubro1: idsubrubro1, source: source })];
            case 3:
                result = _b.sent();
                return [2 /*return*/, res.json(result)];
            case 4:
                error_3 = _b.sent();
                console.error("[Scraper] Attempt ".concat(attempt, " failed:"), error_3.message);
                lastError = error_3;
                if (!(attempt < 3)) return [3 /*break*/, 6];
                return [4 /*yield*/, new Promise(function (r) { return setTimeout(r, 5000); })];
            case 5:
                _b.sent();
                _b.label = 6;
            case 6: return [3 /*break*/, 7];
            case 7:
                attempt++;
                return [3 /*break*/, 1];
            case 8:
                res.status(500).json({ success: false, error: String(lastError) });
                return [2 /*return*/];
        }
    });
}); });
app.post('/scraper/incremental', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var lastError, attempt, forceFullScrape, result, error_4;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                lastError = null;
                attempt = 1;
                _a.label = 1;
            case 1:
                if (!(attempt <= 3)) return [3 /*break*/, 8];
                _a.label = 2;
            case 2:
                _a.trys.push([2, 4, , 7]);
                console.log("[Incremental] Attempt ".concat(attempt, "/3..."));
                forceFullScrape = req.body.forceFullScrape;
                return [4 /*yield*/, (0, index_1.runIncrementalScraper)(forceFullScrape)];
            case 3:
                result = _a.sent();
                return [2 /*return*/, res.json(result)];
            case 4:
                error_4 = _a.sent();
                console.error("[Incremental] Attempt ".concat(attempt, " failed:"), error_4.message);
                lastError = error_4;
                if (!(attempt < 3)) return [3 /*break*/, 6];
                return [4 /*yield*/, new Promise(function (r) { return setTimeout(r, 5000); })];
            case 5:
                _a.sent();
                _a.label = 6;
            case 6: return [3 /*break*/, 7];
            case 7:
                attempt++;
                return [3 /*break*/, 1];
            case 8:
                res.status(500).json({ success: false, error: String(lastError) });
                return [2 /*return*/];
        }
    });
}); });
// Debug endpoint to fix discontinued products
app.post('/debug/fix-discontinued', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var category, db_1, result, error_5;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 3, , 4]);
                category = req.body.category;
                return [4 /*yield*/, getDb()];
            case 1:
                db_1 = _a.sent();
                return [4 /*yield*/, db_1.collection('products').updateMany({ categories: category, status: 'discontinued' }, { $set: { status: 'active' }, $unset: { discontinuedAt: '' } })];
            case 2:
                result = _a.sent();
                res.json({ success: true, modifiedCount: result.modifiedCount });
                return [3 /*break*/, 4];
            case 3:
                error_5 = _a.sent();
                res.status(500).json({ success: false, error: String(error_5) });
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/];
        }
    });
}); });
// Debug endpoint to check products
app.post('/debug/check-products', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var category, db_2, products, error_6;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 3, , 4]);
                category = req.body.category;
                return [4 /*yield*/, getDb()];
            case 1:
                db_2 = _a.sent();
                return [4 /*yield*/, db_2.collection('products')
                        .find({ categories: category, status: 'active' })
                        .project({ name: 1, imageUrls: 1 })
                        .limit(5)
                        .toArray()];
            case 2:
                products = _a.sent();
                res.json({ success: true, products: products });
                return [3 /*break*/, 4];
            case 3:
                error_6 = _a.sent();
                res.status(500).json({ success: false, error: String(error_6) });
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/];
        }
    });
}); });
app.listen(PORT, function () { console.log('[Server] Scraper server on port', PORT); });
