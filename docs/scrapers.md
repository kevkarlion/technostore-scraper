# Scraper Documentation

## Overview

This project has **two independent scrapers** that share the same supplier (Jotakp/Cappelletti) but have different purposes and implementations:

1. **Incremental Scraper** - For new products and discontinued detection
2. **Playwright-Listing Scraper** - For full price updates

---

## Incremental Scraper

### Purpose
Detect and create **new products**, and mark **discontinued products**. Does NOT update prices of existing products.

### Files
- `src/lib/scraper/incremental-scraper.service.ts` - Orchestrator
- `src/lib/scraper/scraper.service.ts` - Product extraction and saving
- `src/lib/scraper/playwright-singleton.ts` - Playwright browser singleton

### Flow

```
1. PRE-CHECK (Axios + Cheerio)
   ├─ Fetch all pages of each category
   ├─ Extract product IDs from listing
   ├─ Compare with scraper_state (previous IDs)
   └─ Detect: NEW products, DISCONTINUED products

2. SCRAPE NEW PRODUCTS (Playwright)
   ├─ Launch browser, login, select branch
   ├─ Extract prices from listing pages (conIva=1)
   └─ For each NEW product:
       ├─ Navigate to detail page
       ├─ Extract: description, SKU, stock, images
       ├─ Get price from listing cache
       └─ Save to DB

3. MARK DISCONTINUED
   └─ Products in scraper_state but not in current listing → status = 'discontinued'
```

### Key Behaviors

- **Skip existing products**: If product ID exists in `scraper_state`, skip completely (don't process, don't save)
- **Price source**: Uses listing page prices with `conIva=1` parameter
- **No price = Skip**: If no price found in listing, product is skipped (logged as WARNING)
- **No price fallback**: Does NOT use detail page prices as fallback

### Price Extraction

The listing page returns prices WITH IVA when using `conIva=1` parameter:
```
URL: /buscar.aspx?idsubrubro1=XX&pag=1&conIva=1
```

Example: Base price $43.79 → With IVA (21%): $52.99

---

## Playwright-Listing Scraper

### Purpose
**Update prices** of all existing products. Does NOT create new products or handle discontinued.

### Files
- `src/lib/scraper/scraper-playwright-listing.service.ts` - Main scraper
- `src/lib/scraper/playwright-singleton-listing.ts` - Playwright browser singleton (separate from incremental)

### Flow

```
1. DISCOVER PRODUCTS (Axios + Cheerio)
   ├─ Fetch all pages of category
   └─ Extract product IDs and names

2. EXTRACT PRICES (Playwright)
   ├─ For each category page (up to 20 pages):
   │   ├─ Navigate with Playwright (renders JS)
   │   ├─ Extract prices from rendered links
   │   └─ Cache: Map<externalId, price>
   └─ URL includes conIva=1

3. QUERY DB
   ├─ Get all existing products in category
   └─ Compare prices

4. UPDATE PRICES
   ├─ For each product:
   │   ├─ If listing price != DB costPrice → update
   │   └─ If DB price is 0/default → set to costPrice
   └─ Only updates: costPrice, price (if default)

5. ENRICH NEW PRODUCTS
   └─ Only for products NOT in DB:
       ├─ Navigate to detail page
       ├─ Extract: description, images, SKU, stock
       └─ Save with listing price
```

### Key Behaviors

- **Only updates prices**: Does not create/discontinue products
- **Price source**: Listing page prices with `conIva=1`
- **Has fallback**: If no listing price, uses detail page price
- **Price comparison**: Compares listing price with DB, updates if different

---

## Key Differences

| Feature | Incremental | Playwright-Listing |
|---------|-------------|-------------------|
| **Creates new products** | ✅ YES | ❌ NO (only enriches) |
| **Updates prices** | ❌ NO | ✅ YES |
| **Handles discontinued** | ✅ YES | ❌ NO |
| **Detail page price as fallback** | ❌ NO | ✅ YES |
| **Price source** | Listing only | Listing → Detail |
| **Affected products** | New only | All in category |

---

## Scraper State

Stored in MongoDB `scraper_state` collection:

```json
{
  "categoryId": "consolas",
  "idsubrubro1": 88,
  "productIds": ["18523", "19223", ...],
  "contentHash": "abc123...",
  "productCount": 7,
  "lastScrapeAt": "2026-07-27T20:50:00.000Z"
}
```

**Purpose**: Track which products were processed to detect new/discontinued on next run.

### Dry-Run / Batch Save

El Incremental Scraper no guarda productos categoría por categoría. En cambio, usa un **modo dry-run** que acumula todos los productos extraídos y los guarda **en batch al final**.

**Flujo actual:**

```
1. PRE-CHECK (Axios + Cheerio)
   └─ Detecta qué categorías cambiaron

2. SCRAPE EN DRY-RUN (Playwright)
   ├─ Itera categorías SECUENCIALMENTE (1 por vez)
   ├─ Cada categoría llama a runScraper con dryRun: true
   │   └─ runScraper SKIPEA: upsert, Cloudinary, discontinued, scraper_state
   │   └─ Acumula productos en accumulatedProducts[]
   ├─ Reinicia Playwright cada RESTART_PLAYWRIGHT_EVERY categorías
   └─ Acumula TODOS los productos en allProducts[]

3. BATCH SAVE
   ├─ Valida cada producto:
   │   ├─ externalId requerido
   │   ├─ priceRaw requerido
   │   └─ parsePrice(priceRaw) > 0 (precio inválido → salta)
   ├─ Guarda válidos con productRepository.atomicUpsertByExternalId()
   ├─ Sube imágenes a Cloudinary (solo productos nuevos)
   ├─ Marca discontinued para categorías scrapeadas
   └─ Actualiza scraper_state para categorías scrapeadas

4. UPDATE SCRAPER STATE
   └─ Actualiza scraper_state con IDs reales de la DB
```

**Ventajas:**
- Si crashea a mitad, no quedan categorías parcialmente guardadas
- Se pueden validar precios antes de persistir
- Una sola transacción lógica por categoría

**Archivos modificados:**
- `src/lib/scraper/types.ts` — `dryRun` field en `ScraperRunRequest`, `products` field en `ScraperResult`
- `src/lib/scraper/scraper.service.ts` — `if (!isDryRun)` envuelve saves/Cloudinary/discontinued/scraper_state
- `src/lib/scraper/incremental-scraper.service.ts` — batch save loop después del scraping

---

## Price Handling

### conIva=1 Parameter

The Jotakp site has two price modes:
- **Without IVA**: Base supplier price
- **With IVA (21%)**: Final consumer price

Our scrapers use `conIva=1` to get prices with IVA included.

### Price Fields

- `costPrice`: USD price from supplier (with IVA)
- `price`: ARS sale price (computed by backend)
- `currency`: Always 'USD'

### Price Examples

Product 22323 (PREVENTA Consola Gamer Portatil Wifi NM-R37-V):
- Listing price: U$D 43.79 (without IVA)
- With IVA (21%): U$D 52.99
- Stored as: costPrice = 52.99

---

## Logging

### Incremental Scraper
- `[Pre-check] Category XX`: Pre-check results
- `[WARNING] XXXXX`: Product skipped (no price from listing)
- `[Upsert] XXXXX: costPrice=X.XX`: Product saved
- `[Discontinued] Category XX`: Products marked discontinued

### Playwright-Listing Scraper
- `[Scraper] Category XX`: collected N listing prices
- `[Upsert] XXXXX`: Product updated

---

## Error Handling

### Incremental
- If listing page fails: skip that page, continue with others
- If detail page fails: product is skipped, logged as error
- If no price: product is skipped (not created)

### Playwright-Listing
- If listing page fails: retry with backoff
- If DB query fails: abort category
- If update fails: log error, continue with others

---

## Environment Variables

```env
MONGO_URI=mongodb+srv://...
DB_NAME=ecommerce
SUPPLIER_URL=https://jotakp.dyndns.org
SUPPLIER_EMAIL=20418216795
SUPPLIER_PASSWORD=123456
PLAYWRIGHT_BROWSERS_PATH=/home/kriq/.cache/ms-playwright
```

---

## API Endpoints

```bash
# Incremental scraper
POST /scraper/incremental
POST /scraper/incremental?categoryId=consolas

# Playwright-Listing (price updates)
POST /scraper/playwright-listing
```

---

## Architecture Notes

### Shared Code
- `config.ts` - Category definitions, supplier config
- `http-client.ts` - Axios client with retry logic
- `data-transformer.ts` - Price parsing utilities
- `types.ts` - TypeScript interfaces

### Separate Playwright Instances
The two scrapers use **different Playwright singletons** to avoid conflicts:
- Incremental: `playwright-singleton.ts`
- Listing: `playwright-singleton-listing.ts`

This ensures changes to one scraper's browser logic don't affect the other.

---

## Browser Resilience (Auto-Restart)

Playwright puede degradarse durante scraping largo (muchas páginas), causando errores como:
- `Target page, context or browser has been closed`
- `net::ERR_ABORTED; maybe frame was detached`
- `Protocol error (Target.createTarget): Failed to open a new tab`

### Solución implementada

El singleton de Playwright tiene un **contador de errores** con auto-restart:

```typescript
// Configuración
const FAILURE_THRESHOLD = 3;  // Reiniciar después de 3 fallos consecutivos
const FAILURE_WINDOW_MS = 60000;  // En menos de 1 minuto
```

**Comportamiento:**
1. Cada error incrementa el contador
2. Si hay 3+ errores en 1 minuto → reinicia el browser automáticamente
3. Éxito resetea el contador a 0

**Logs:**
- `[PlaywrightSingleton] Too many failures (X), restarting browser...` → browser reiniciado
- Después del restart, el scraping continúa

Esto evita que el scraper falle completamente por degradación del browser.
