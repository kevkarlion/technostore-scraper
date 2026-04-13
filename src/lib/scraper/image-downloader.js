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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureImageDirectory = ensureImageDirectory;
exports.uploadProductImage = uploadProductImage;
exports.uploadProductImages = uploadProductImages;
exports.downloadImage = downloadImage;
exports.downloadProductImages = downloadProductImages;
exports.getSupplierImageCount = getSupplierImageCount;
var fs = __importStar(require("fs"));
var path = __importStar(require("path"));
var SUPPLIER_IMAGES_DIR = path.join(process.cwd(), "public", "images", "suppliers");
/**
 * Ensure the supplier images directory exists
 */
function ensureImageDirectory(supplier) {
    return __awaiter(this, void 0, void 0, function () {
        var supplierDir;
        return __generator(this, function (_a) {
            supplierDir = path.join(SUPPLIER_IMAGES_DIR, supplier);
            if (!fs.existsSync(supplierDir)) {
                fs.mkdirSync(supplierDir, { recursive: true });
                console.log("[ImageDownloader] Created directory: ".concat(supplierDir));
            }
            return [2 /*return*/, supplierDir];
        });
    });
}
/**
 * Try to upload to Cloudinary if configured
 * Returns the URL that should be used (cloudinary or original)
 */
function uploadProductImage(imageUrl_1, supplier_1, productId_1) {
    return __awaiter(this, arguments, void 0, function (imageUrl, supplier, productId, imageIndex) {
        var CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, fullUrl, baseUrl, baseUrl, timestamp, signature, uploadUrl, formData, response, result, cloudError_1, error_1, errorMsg;
        if (imageIndex === void 0) { imageIndex = 0; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 8, , 9]);
                    CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
                    CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
                    CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
                    fullUrl = imageUrl;
                    if (imageUrl.startsWith("imagenes/") || imageUrl.startsWith("/imagenes/")) {
                        baseUrl = process.env.SUPPLIER_URL || "https://jotakp.dyndns.org";
                        fullUrl = "".concat(baseUrl, "/").concat(imageUrl.replace(/^\//, ""));
                    }
                    else if (!imageUrl.startsWith("http")) {
                        baseUrl = process.env.SUPPLIER_URL || "https://jotakp.dyndns.org";
                        fullUrl = "".concat(baseUrl, "/").concat(imageUrl);
                    }
                    if (!(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET)) return [3 /*break*/, 7];
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 6, , 7]);
                    timestamp = Math.round(Date.now() / 1000);
                    return [4 /*yield*/, generateCloudinarySignature(timestamp, productId)];
                case 2:
                    signature = _a.sent();
                    uploadUrl = "https://api.cloudinary.com/v1_1/".concat(CLOUDINARY_CLOUD_NAME, "/image/upload");
                    formData = new URLSearchParams();
                    formData.append("file", fullUrl);
                    formData.append("folder", "scraper/".concat(supplier));
                    formData.append("public_id", "".concat(productId, "_").concat(imageIndex));
                    formData.append("timestamp", timestamp.toString());
                    formData.append("api_key", CLOUDINARY_API_KEY);
                    if (signature)
                        formData.append("signature", signature);
                    return [4 /*yield*/, fetch(uploadUrl, {
                            method: "POST",
                            headers: { "Content-Type": "application/x-www-form-urlencoded" },
                            body: formData.toString(),
                        })];
                case 3:
                    response = _a.sent();
                    if (!response.ok) return [3 /*break*/, 5];
                    return [4 /*yield*/, response.json()];
                case 4:
                    result = _a.sent();
                    console.log("[ImageUpload] Cloudinary: ".concat(productId, "/").concat(imageIndex));
                    return [2 /*return*/, {
                            localPath: "",
                            cloudinaryUrl: result.secure_url,
                            url: fullUrl,
                            success: true,
                        }];
                case 5: return [3 /*break*/, 7];
                case 6:
                    cloudError_1 = _a.sent();
                    console.log("[ImageUpload] Cloudinary failed: ".concat(cloudError_1, ", using original"));
                    return [3 /*break*/, 7];
                case 7: 
                // Fallback: use original URL
                return [2 /*return*/, {
                        localPath: "",
                        cloudinaryUrl: "",
                        url: fullUrl,
                        success: true,
                    }];
                case 8:
                    error_1 = _a.sent();
                    errorMsg = error_1 instanceof Error ? error_1.message : "Unknown error";
                    console.error("[ImageUpload] Failed: ".concat(imageUrl.substring(0, 50), "... - ").concat(errorMsg));
                    return [2 /*return*/, {
                            localPath: "",
                            url: imageUrl,
                            success: false,
                            error: errorMsg,
                        }];
                case 9: return [2 /*return*/];
            }
        });
    });
}
/**
 * Generate Cloudinary signature (simplified - actually would need crypto)
 */
function generateCloudinarySignature(timestamp, publicId) {
    return __awaiter(this, void 0, void 0, function () {
        var CLOUDINARY_API_SECRET, crypto, toSign;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";
                    if (!CLOUDINARY_API_SECRET)
                        return [2 /*return*/, ""];
                    return [4 /*yield*/, Promise.resolve().then(function () { return __importStar(require("crypto")); })];
                case 1:
                    crypto = _a.sent();
                    toSign = "timestamp=".concat(timestamp, "public_id=").concat(publicId).concat(CLOUDINARY_API_SECRET);
                    return [2 /*return*/, crypto.createHash("sha1").update(toSign).digest("hex")];
            }
        });
    });
}
/**
 * Upload multiple images for a product
 */
function uploadProductImages(images, supplier, productId) {
    return __awaiter(this, void 0, void 0, function () {
        var cloudUrls, i, imageUrl, result, url;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    cloudUrls = [];
                    i = 0;
                    _a.label = 1;
                case 1:
                    if (!(i < images.length)) return [3 /*break*/, 4];
                    imageUrl = images[i];
                    return [4 /*yield*/, uploadProductImage(imageUrl, supplier, productId, i)];
                case 2:
                    result = _a.sent();
                    if (result.success) {
                        url = result.cloudinaryUrl || result.url;
                        if (url)
                            cloudUrls.push(url);
                    }
                    _a.label = 3;
                case 3:
                    i++;
                    return [3 /*break*/, 1];
                case 4: return [2 /*return*/, cloudUrls];
            }
        });
    });
}
/**
 * Download image locally (fallback)
 */
function downloadImage(imageUrl_1, supplier_1, productId_1) {
    return __awaiter(this, arguments, void 0, function (imageUrl, supplier, productId, imageIndex) {
        var supplierDir, pathname, ext, imageIdMatch, imageId, filename, localPath, controller_1, timeoutId, response, arrayBuffer, buffer, error_2, errorMsg;
        if (imageIndex === void 0) { imageIndex = 0; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 4, , 5]);
                    return [4 /*yield*/, ensureImageDirectory(supplier)];
                case 1:
                    supplierDir = _a.sent();
                    pathname = new URL(imageUrl).pathname;
                    ext = path.extname(pathname) || ".jpg";
                    imageIdMatch = pathname.match(/(?:imagen|0+)(\d+)\.[a-zA-Z]+$/i);
                    imageId = imageIdMatch ? imageIdMatch[1] : pathname.slice(-20).replace(/[^a-z0-9]/gi, "");
                    filename = "".concat(supplier, "_").concat(productId, "_").concat(imageId).concat(ext);
                    localPath = path.join(supplierDir, filename);
                    if (fs.existsSync(localPath)) {
                        return [2 /*return*/, {
                                localPath: "/images/suppliers/".concat(supplier, "/").concat(filename),
                                url: imageUrl,
                                success: true,
                            }];
                    }
                    controller_1 = new AbortController();
                    timeoutId = setTimeout(function () { return controller_1.abort(); }, 30000);
                    return [4 /*yield*/, fetch(imageUrl, {
                            signal: controller_1.signal,
                            headers: {
                                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                                Accept: "image/*,*/*",
                            },
                        })];
                case 2:
                    response = _a.sent();
                    clearTimeout(timeoutId);
                    if (!response.ok) {
                        throw new Error("HTTP ".concat(response.status, ": ").concat(response.statusText));
                    }
                    return [4 /*yield*/, response.arrayBuffer()];
                case 3:
                    arrayBuffer = _a.sent();
                    buffer = Buffer.from(arrayBuffer);
                    fs.writeFileSync(localPath, buffer);
                    console.log("[ImageDownloader] Downloaded locally: ".concat(filename));
                    return [2 /*return*/, {
                            localPath: "/images/suppliers/".concat(supplier, "/").concat(filename),
                            url: imageUrl,
                            success: true,
                        }];
                case 4:
                    error_2 = _a.sent();
                    errorMsg = error_2 instanceof Error ? error_2.message : "Unknown error";
                    console.error("[ImageDownloader] Failed to download ".concat(imageUrl, ": ").concat(errorMsg));
                    return [2 /*return*/, {
                            localPath: "",
                            url: imageUrl,
                            success: false,
                            error: errorMsg,
                        }];
                case 5: return [2 /*return*/];
            }
        });
    });
}
/**
 * Download multiple images (fallback)
 */
function downloadProductImages(images, supplier, productId) {
    return __awaiter(this, void 0, void 0, function () {
        var urls, i, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    urls = [];
                    i = 0;
                    _a.label = 1;
                case 1:
                    if (!(i < images.length)) return [3 /*break*/, 4];
                    return [4 /*yield*/, downloadImage(images[i], supplier, productId, i)];
                case 2:
                    result = _a.sent();
                    if (result.success && result.localPath) {
                        urls.push(result.localPath);
                    }
                    _a.label = 3;
                case 3:
                    i++;
                    return [3 /*break*/, 1];
                case 4: return [2 /*return*/, urls];
            }
        });
    });
}
/**
 * Get image count for a supplier
 */
function getSupplierImageCount(supplier) {
    var supplierDir = path.join(SUPPLIER_IMAGES_DIR, supplier);
    if (!fs.existsSync(supplierDir)) {
        return 0;
    }
    var files = fs.readdirSync(supplierDir);
    return files.filter(function (f) { return /\.(jpg|jpeg|png|gif|webp)$/i.test(f); }).length;
}
