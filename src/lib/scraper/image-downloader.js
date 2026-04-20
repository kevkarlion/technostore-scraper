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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureImageDirectory = ensureImageDirectory;
exports.uploadProductImage = uploadProductImage;
exports.uploadProductImages = uploadProductImages;
exports.downloadImage = downloadImage;
exports.downloadProductImages = downloadProductImages;
exports.getSupplierImageCount = getSupplierImageCount;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const SUPPLIER_IMAGES_DIR = path.join(process.cwd(), "public", "images", "suppliers");
/**
 * Ensure the supplier images directory exists
 */
async function ensureImageDirectory(supplier) {
    const supplierDir = path.join(SUPPLIER_IMAGES_DIR, supplier);
    if (!fs.existsSync(supplierDir)) {
        fs.mkdirSync(supplierDir, { recursive: true });
        console.log(`[ImageDownloader] Created directory: ${supplierDir}`);
    }
    return supplierDir;
}
/**
 * Try to upload to Cloudinary if configured
 * Returns the URL that should be used (cloudinary or original)
 */
async function uploadProductImage(imageUrl, supplier, productId, imageIndex = 0) {
    try {
        const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
        const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
        const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
        // Build full URL for supplier images
        let fullUrl = imageUrl;
        if (imageUrl.startsWith("imagenes/") || imageUrl.startsWith("/imagenes/")) {
            const baseUrl = process.env.SUPPLIER_URL || "https://jotakp.dyndns.org";
            fullUrl = `${baseUrl}/${imageUrl.replace(/^\//, "")}`;
        }
        else if (!imageUrl.startsWith("http")) {
            const baseUrl = process.env.SUPPLIER_URL || "https://jotakp.dyndns.org";
            fullUrl = `${baseUrl}/${imageUrl}`;
        }
        // Try Cloudinary if configured
        if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
            try {
                const timestamp = Math.round(Date.now() / 1000);
                const signature = await generateCloudinarySignature(timestamp, productId);
                const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
                const formData = new URLSearchParams();
                formData.append("file", fullUrl);
                // Use consistent folder and public_id format that matches the app's expectations
                formData.append("folder", `technostore/${supplier}`);
                // Format: jotakp_14438_0 (same as the app expects)
                formData.append("public_id", `${supplier}_${productId}_${imageIndex}`);
                formData.append("timestamp", timestamp.toString());
                formData.append("api_key", CLOUDINARY_API_KEY);
                if (signature)
                    formData.append("signature", signature);
                const response = await fetch(uploadUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: formData.toString(),
                });
                if (response.ok) {
                    const result = await response.json();
                    console.log(`[ImageUpload] Cloudinary: ${productId}/${imageIndex}`);
                    return {
                        localPath: "",
                        cloudinaryUrl: result.secure_url,
                        url: fullUrl,
                        success: true,
                    };
                }
            }
            catch (cloudError) {
                console.log(`[ImageUpload] Cloudinary failed: ${cloudError}, using original`);
            }
        }
        // Fallback: use original URL
        return {
            localPath: "",
            cloudinaryUrl: "",
            url: fullUrl,
            success: true,
        };
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[ImageUpload] Failed: ${imageUrl.substring(0, 50)}... - ${errorMsg}`);
        return {
            localPath: "",
            url: imageUrl,
            success: false,
            error: errorMsg,
        };
    }
}
/**
 * Generate Cloudinary signature (simplified - actually would need crypto)
 */
async function generateCloudinarySignature(timestamp, publicId) {
    // In production, properly sign with HMAC-SHA1
    const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";
    if (!CLOUDINARY_API_SECRET)
        return "";
    const crypto = await Promise.resolve().then(() => __importStar(require("crypto")));
    const toSign = `timestamp=${timestamp}public_id=${publicId}${CLOUDINARY_API_SECRET}`;
    return crypto.createHash("sha1").update(toSign).digest("hex");
}
/**
 * Upload multiple images for a product
 */
async function uploadProductImages(images, supplier, productId) {
    const cloudUrls = [];
    for (let i = 0; i < images.length; i++) {
        const imageUrl = images[i];
        const result = await uploadProductImage(imageUrl, supplier, productId, i);
        if (result.success) {
            const url = result.cloudinaryUrl || result.url;
            if (url)
                cloudUrls.push(url);
        }
    }
    return cloudUrls;
}
/**
 * Download image locally (fallback)
 */
async function downloadImage(imageUrl, supplier, productId, imageIndex = 0) {
    try {
        const supplierDir = await ensureImageDirectory(supplier);
        const pathname = new URL(imageUrl).pathname;
        const ext = path.extname(pathname) || ".jpg";
        const imageIdMatch = pathname.match(/(?:imagen|0+)(\d+)\.[a-zA-Z]+$/i);
        const imageId = imageIdMatch ? imageIdMatch[1] : pathname.slice(-20).replace(/[^a-z0-9]/gi, "");
        const filename = `${supplier}_${productId}_${imageId}${ext}`;
        const localPath = path.join(supplierDir, filename);
        if (fs.existsSync(localPath)) {
            return {
                localPath: `/images/suppliers/${supplier}/${filename}`,
                url: imageUrl,
                success: true,
            };
        }
        // Download
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        const response = await fetch(imageUrl, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                Accept: "image/*,*/*",
            },
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(localPath, buffer);
        console.log(`[ImageDownloader] Downloaded locally: ${filename}`);
        return {
            localPath: `/images/suppliers/${supplier}/${filename}`,
            url: imageUrl,
            success: true,
        };
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[ImageDownloader] Failed to download ${imageUrl}: ${errorMsg}`);
        return {
            localPath: "",
            url: imageUrl,
            success: false,
            error: errorMsg,
        };
    }
}
/**
 * Download multiple images (fallback)
 */
async function downloadProductImages(images, supplier, productId) {
    const urls = [];
    for (let i = 0; i < images.length; i++) {
        const result = await downloadImage(images[i], supplier, productId, i);
        if (result.success && result.localPath) {
            urls.push(result.localPath);
        }
    }
    return urls;
}
/**
 * Get image count for a supplier
 */
function getSupplierImageCount(supplier) {
    const supplierDir = path.join(SUPPLIER_IMAGES_DIR, supplier);
    if (!fs.existsSync(supplierDir)) {
        return 0;
    }
    const files = fs.readdirSync(supplierDir);
    return files.filter((f) => /\.(jpg|jpeg|png|gif|webp)$/i.test(f)).length;
}
