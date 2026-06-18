# Manual del Scraper Server

## Índice

1. [Descripción General](#1-descripción-general)
2. [Arquitectura del Sistema](#2-arquitectura-del-sistema)
3. [Scrapers Disponibles](#3-scrapers-disponibles)
4. [Disparo de Scrapers](#4-disparo-de-scrapers)
5. [API Endpoints](#5-api-endpoints)
6. [Módulo de Monitoreo](#6-módulo-de-monitoreo)
7. [Reglas de Health Check](#7-reglas-de-health-check)
8. [Base de Datos](#8-base-de-datos)
9. [Despliegue en Railway](#9-despliegue-en-railway)
10. [Variables de Entorno](#10-variables-de-entorno)
11. [Solución de Problemas](#11-solución-de-problemas)

---

## 1. Descripción General

**Scraper Server** es un servidor autónomo que extrae productos del proveedor **Jotakp (Cappelletti Informática)** usando **Playwright** (Chromium headless). Corre en **Railway** (o localmente) y persiste los datos en **MongoDB Atlas**.

### Stack tecnológico

| Componente | Tecnología |
|---|---|
| Lenguaje | TypeScript / Node.js |
| Web scraping | Playwright con Chromium |
| Servidor HTTP | Express |
| Base de datos | MongoDB (Atlas) |
| Scheduler | node-cron (tz Argentina) |
| Imágenes | Cloudinary (opcional) |
| Despliegue | Railway (Docker) |

---

## 2. Arquitectura del Sistema

### 2.1 Estructura de archivos

```
scraper-server/
├── server.ts                  # Punto de entrada: Express + scheduling
├── server.js                  # Compilado de server.ts (lo que corre en Railway)
├── Dockerfile                 # Imagen Docker para Railway
├── tsconfig.json
├── package.json
├── .env                       # Variables de entorno locales
├── .env.example
├── MANUAL.md                  # Este documento
├── MIGRACION-RAILWAY.md       # Historial de migración
├── src/
│   └── lib/
│       ├── scraper/           # Módulo principal de scraping
│       │   ├── index.ts       # Re-exporta todo el módulo
│       │   ├── types.ts       # Interfaces y tipos (RawProduct, ScraperConfig, etc.)
│       │   ├── config.ts      # Config: categorías Jotakp + selectors web
│       │   ├── scraper.service.ts    # ScraperService class + runScraper()
│       │   ├── incremental-scraper.service.ts  # preCheckCategories + runIncrementalScraper()
│       │   ├── data-transformer.ts    # Transformación de datos (precios, stock)
│       │   ├── image-downloader.ts    # Subida a Cloudinary / descarga local
│       │   ├── *.js           # Versiones compiladas de cada .ts
│       └── monitoring/        # Módulo de monitoreo
│           ├── index.ts       # initMonitoring(): crea índices
│           ├── types.ts       # ExecutionLog, HealthCheck, MetricsSnapshot, etc.
│           ├── execution-recorder.ts  # Envuelve ejecuciones con logging
│           ├── health-checker.ts      # 5 reglas de detección de anomalías
│           ├── metrics-aggregator.ts  # Agregación diaria de métricas
│           ├── sse-emitter.ts         # Server-Sent Events para el dashboard
│           ├── api.ts                 # Router Express con endpoints REST
│           ├── *.js           # Versiones compiladas
├── public/
│   └── dashboard/
│       └── index.html         # Dashboard web (frontend estático)
└── node_modules/
```

### 2.2 Flujo de datos

```
Jotakp (web)  ──[Playwright]──▶  scraper.service.ts  ──▶  MongoDB Atlas
                                      │
                                      ├─▶ image-downloader.ts ──▶ Cloudinary
                                      │
 incremental-scraper.service.ts ──▶ execution-recorder.ts ──▶ execution_logs
                                      │
                                 health-checker.ts ──▶ health_checks
                                      │
                                 metrics-aggregator.ts ──▶ metrics_snapshots
                                      │
                                 sse-emitter.ts ──▶ Dashboard (SSE)
```

### 2.3 Diagrama de componentes

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Express Server (port 3001)                    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    server.ts                                   │   │
│  │  - Conexión MongoDB (singleton, pool 5 conexiones)            │   │
│  │  - Scheduler node-cron                                        │   │
│  │  - Endpoints HTTP (/run, /scraper/*, /monitoring/*)           │   │
│  │  - Post-execution hooks (health + metrics)                    │   │
│  └──────────────┬───────────────────────────────────────────────┘   │
│                 │                                                    │
│  ┌──────────────▼──────────────────────────┐  ┌──────────────────┐ │
│  │         scraper/                         │  │   monitoring/    │ │
│  │                                          │  │                  │ │
│  │  ┌──────────────────────────────────┐   │  │  execution-     │ │
│  │  │  incremental-scraper.service.ts  │   │  │  recorder.ts    │ │
│  │  │  - preCheckCategories()          │──┼──▶│                  │ │
│  │  │  - runIncrementalScraper()       │   │  │  health-        │ │
│  │  └────────────┬─────────────────────┘   │  │  checker.ts     │ │
│  │               │                          │  │                  │ │
│  │  ┌────────────▼─────────────────────┐   │  │  metrics-       │ │
│  │  │  scraper.service.ts              │   │  │  aggregator.ts  │ │
│  │  │  - ScraperService class          │   │  │                  │ │
│  │  │  - runScraper()                  │   │  │  sse-emitter.ts  │ │
│  │  │  - initBrowser() / reconnect()   │   │  │                  │ │
│  │  │  - login() / scrapeCategory()    │   │  │  api.ts          │ │
│  │  └──────────────────────────────────┘   │  └──────────────────┘ │
│  └──────────────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.4 Gestión de conexiones MongoDB

El servidor usa un **pool de conexiones reducido** (max 5, min 0) para funcionar bien en el tier gratuito M0 de Atlas:

- **Conexión lazy**: se conecta recién cuando se necesita.
- **Timeout agresivo**: 5s server selection, 5s wait queue.
- **Cierre post-scrape**: después de cada ejecución del scraper se cierra la conexión para liberar recursos en M0.
- **Singleton**: se reusa el mismo cliente a través de `getDb()`.

---

## 3. Scrapers Disponibles

### 3.1 ScraperService (scraper.service.ts)

**Clase:** `ScraperService` — el scraper completo y reutilizable.

#### Funcionalidades

- **Browser lifecycle**: singleton de Chromium con reconexión automática si se desconecta.
- **Login automático**: navega al login de Jotakp, completa credenciales, selecciona sucursal.
- **Scraping por categoría**: navega `buscar.aspx?idsubrubro1=N`, página por página, extrayendo productos.
- **Scraping de detalle**: para cada producto abre la página individual, extrae descripción, stock, SKU, imágenes.
- **Reintentos**: navegación con retry 3 veces ante fallos.
- **Resume**: guarda checkpoints para reanudar si se corta.
- **Upsert de productos**: si existe → actualiza solo campos modificados; si no existe → inserta.
- **Reactivación**: si un producto estaba `discontinued` o `inStock: false` y se encuentra de nuevo, lo reactiva automáticamente.

#### Métodos clave

| Método | Descripción |
|---|---|
| `initBrowser()` | Inicializa Chromium (búsqueda de ejecutable + launch) |
| `login(page)` | Login en Jotakp + selección de sucursal |
| `scrapeCategory(categoryId)` | Scrapea una categoría página por página |
| `scrapeProductDetail(page, externalId)` | Extrae detalle de un producto individual |
| `run()` | Ejecuta el scraper completo |

**Exportación:** `export async function runScraper(request?)`

**Uso interno:** es llamado por `incremental-scraper.service.ts` para scrapear cada categoría.

### 3.2 IncrementalScraper (incremental-scraper.service.ts)

**Función principal:** `runIncrementalScraper(forceFullScrape?)` — el scraper inteligente que se ejecuta en cada ciclo programado.

#### Flujo

```
runIncrementalScraper()
  │
  ├─ forceFullScrape? ──sí──▶  todas las categorías marcadas como "changed"
  │
  └─ no ──▶ preCheckCategories()
              │
              ├─ Lanza Chromium
              ├─ Para cada categoría:
              │    ├─ Obtiene primera página
              │    ├─ Calcula hash del contenido
              │    ├─ Compara con scraper_state (MongoDB)
              │    └─ Marca "changed" / "unchanged"
              │
              └─ Retorna lista de categorías cambiadas
  │
  ├─ SIEMPRE procesa TODAS las categorías (para actualizar stock)
  │
  └─ Para cada categoría (en batches de 2 paralelas):
       ├─ Llama runScraper({ categoryId })
       └─ Registra created/updated/errors
```

**Por qué siempre procesa todas:** aunque el contenido no haya cambiado, el stock puede variar. Scrapea todo para mantener los precios y stock actualizados.

### 3.3 Scraper antiguo (inline en server.ts)

**Función:** `runIncrementalScraper(forceFullScrape?)` — dentro de `server.ts` (NO la del módulo).

Este es el scraper **original** que solo maneja 12 categorías fijas. Está deprecated en favor del módulo nuevo, pero aún se expone via `POST /run`.

#### Diferencias con el nuevo

| Aspecto | Antiguo (server.ts) | Nuevo (módulo) |
|---|---|---|
| Categorías | 12 fijas ~70 | (todas las de config.ts) |
| Browser | Lanza 1 browser para todo | 1 browser por pre-check + 1 por scraper |
| Pre-check | Secuencial por batch | Paralelo (2 simultáneas) |
| Precios | Extrae de listado | Extrae de página de detalle |
| Imágenes | No sube a Cloudinary | Sube a Cloudinary si configurado |
| Discontinued | Sí | Sí (vía scraper.service.ts) |
| Reintentos | No | 3 reintentos |
| Resume | No | Checkpoints |

### 3.4 Categorías scrapeadas

El proveedor **Jotakp** tiene **≈70 subcategorías** organizadas en estas categorías principales:

| Categoría | Subcategorías |
|---|---|
| Almacenamiento | Carry-Caddy, CD/DVD, Discos Externos, HDD, M.2, SSD, Memorias Flash, Pendrive |
| Audio | Auriculares BT/Cableados, Micrófonos, Parlantes, Placas de Sonido, Reproductores |
| Cables | Audio, Celulares, Energía, Hardware, Impresora, Video |
| Computadoras | AIO, Notebooks, PCs, Tablets, Accesorios, Cargadores, Fundas, Licencias |
| Conectividad | Routers, Switches, Antenas, Patch Cord, Puntos de Acceso, Racks |
| Energía | Baterías, Cargadores, Estabilizadores, UPS, Pilas, Zapatillas, LEDs |
| Gaming | Consolas, Joysticks, Auriculares, Mouse, Teclado, Sillas, Combos |
| Hardware | Mothers, Fuentes, Gabinetes, Memorias RAM, Microprocesadores, Placas de Video |
| Imagen | Monitores, Proyectores, Cámaras, Smartwatches, Streaming |
| Impresión | Impresoras, Tóneres, Cartuchos, Tintas, Resmas |
| Periféricos | Teclados, Mouse, Webcams, Tabletas Gráficas, Lectores |
| Seguridad | Cámaras CCTV, Cámaras IP, DVR/NVR, Alarmas, Porteros, Kits |
| Telefonía | Celulares, Teléfonos, Centrales, Accesorios |
| Varios | Herramientas, Oficina, Electro, Limpieza |

---

## 4. Disparo de Scrapers

### 4.1 Scheduler automático (node-cron)

El servidor incluye un scheduler interno usando `node-cron` con timezone `America/Argentina/Buenos_Aires`.

**Schedule actual:** `0 7,10,13,16,19,22 * * 1-6`

| Día | Horarios |
|---|---|
| Lunes a Sábado | 07:00, 10:00, 13:00, 16:00, 19:00, 22:00 |
| Domingo | No corre |

El scheduler ejecuta `runIncrementalScraper(false)` (incremental, no forzado).

**Configurable via:** variable de entorno `SCRAPER_SCHEDULE` (formato cron estándar de 5 campos).

### 4.2 Endpoint HTTP POST /scraper/incremental

```bash
# Incremental normal
curl -X POST https://technostore-scraper-production.up.railway.app/scraper/incremental

# Forzar rescrape completo
curl -X POST https://technostore-scraper-production.up.railway.app/scraper/incremental \
  -H "Content-Type: application/json" \
  -d '{"forceFullScrape": true}'
```

Este endpoint:

1. Crea un `executionId` via `executionRecorder.recordExecution()`.
2. Ejecuta `runIncrementalScraperNew(forceFullScrape)`.
3. Corre health checks post-ejecución (fire-and-forget).
4. Agrega métricas diarias (fire-and-forget).
5. Retries: hasta 3 intentos con 5s de espera entre cada uno.

### 4.3 Endpoint HTTP POST /run (scraper antiguo)

```bash
curl -X POST https://technostore-scraper-production.up.railway.app/run
curl -X POST "https://technostore-scraper-production.up.railway.app/run?force=true"
```

### 4.4 Endpoint HTTP POST /scraper/run (por categoría)

```bash
curl -X POST https://technostore-scraper-production.up.railway.app/scraper/run \
  -H "Content-Type: application/json" \
  -d '{"categoryId": "discos-ssd", "idsubrubro1": 156}'
```

### 4.5 Modo despierto en Railway

Railway duerme el servicio si no recibe tráfico. Para evitar que el scheduler falle, el server necesita un **uptime monitor** que le pegue al `/health` cada 5-10 minutos para mantenerlo despierto.

---

## 5. API Endpoints

### 5.1 Scraping

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/run` | Scraper antiguo (12 categorías, `?force=true` para full) |
| `POST` | `/scraper/run` | Scraper por categoría específica |
| `POST` | `/scraper/incremental` | Scraper incremental completo (nuevo módulo) |
| `POST` | `/scraper/test-category` | Testear una categoría específica |
| `GET` | `/scraper/categories` | Lista todas las categorías disponibles |

### 5.2 Estado y monitoreo

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/health` | Health check simple |
| `GET` | `/status` | Productos activos + últimos scrapes |
| `GET` | `/scheduler/status` | Estado del scheduler (schedule, timezone) |
| `GET` | `/dashboard` | Dashboard web de monitoreo |
| `GET` | `/api/monitoring/status` | Estado del scraper + resumen 7 días |
| `GET` | `/api/monitoring/history` | Historial paginado de ejecuciones |
| `GET` | `/api/monitoring/executions/:id` | Detalle completo de una ejecución |
| `GET` | `/api/monitoring/metrics` | Métricas pre-agregadas (últimos N días) |
| `GET` | `/api/monitoring/health` | Alertas activas de salud |
| `POST` | `/api/monitoring/health/check` | Forzar verificación manual |
| `GET` | `/api/monitoring/events` | SSE stream en tiempo real |

### 5.3 Debug

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/debug/mongo-test` | Testear conexión a MongoDB |
| `POST` | `/debug/fix-discontinued` | Reactivar productos discontinued de una categoría |
| `POST` | `/debug/check-products` | Ver productos activos de una categoría |

---

## 6. Módulo de Monitoreo

El módulo `monitoring/` implementa un sistema de monitoreo completo con 3 colecciones en MongoDB y un dashboard web.

### 6.1 execution-recorder.ts

Envuelve cualquier función de scraper con:

- **Captura de logs**: intercepta `console.log` y `console.error` durante la ejecución y los guarda en memoria.
- **Registro en DB**: al terminar (éxito, warning o error), guarda un documento en `execution_logs`.
- **No bloqueante**: si la DB falla, el scraper sigue funcionando. El error se loguea pero no se propaga.
- **Re-throw**: en caso de error del scraper, lo vuelve a lanzar después de registrar el fallo.

Campos del documento `execution_logs`:

| Campo | Descripción |
|---|---|
| `startedAt` | Inicio de ejecución |
| `completedAt` | Fin de ejecución |
| `durationMs` | Duración total |
| `status` | `success` / `warning` / `error` |
| `triggerSource` | `cron` / `http` / `manual` |
| `productsFound` | Productos encontrados |
| `productsCreated` | Productos nuevos insertados |
| `productsUpdated` | Productos existentes actualizados |
| `productsUnavailable` | Productos marcados como sin stock |
| `errorCount` | Cantidad de errores |
| `errors` | Array de mensajes de error (máx 50) |
| `logEntries` | Últimas 200 líneas de log capturadas |
| `metadata.durationCategory` | `fast` (<1min), `normal` (<5min), `slow` (≥5min) |

### 6.2 health-checker.ts

Detecta 5 tipos de anomalías:

| Regla | Tipo | Severidad | Condición |
|---|---|---|---|
| 1. consecutive-failures | `critical` | 3+ ejecuciones error consecutivas |
| 2. slow-execution | `warning` | Duración > 2× promedio de últimas 10 ejecuciones exitosas |
| 3. repetitive-errors | `warning` | Mismo error en 3+ ejecuciones consecutivas |
| 4. product-drop | `critical` | Productos encontrados < 50% del promedio de 7 días |
| 5. scraper-stopped | `critical` | Sin ejecuciones en >3h (ventana 07:00–24:00 AR) |

Las alertas se guardan en `health_checks` con TTL de 180 días.

El scraper-stopped se verifica cada 30 minutos mediante un `setInterval` en server.ts. Una ejecución exitosa resuelve automáticamente cualquier alerta de scraper-stopped pendiente.

### 6.3 metrics-aggregator.ts

Agrega métricas diarias en `metrics_snapshots`:

- Corre cada hora (`startPeriodicAggregation`).
- Procesa `execution_logs` del día actual con `$match` + `$group`.
- También re-agrega el día anterior para capturar ejecuciones que cruzaron la medianoche.
- Un documento por día (`date: YYYY-MM-DD`) con unique index.
- TTL: 365 días.

### 6.4 sse-emitter.ts

Maneja conexiones Server-Sent Events para el dashboard:

- Clientes vía `GET /api/monitoring/events`.
- Heartbeat cada 30s.
- Broadcast de `health-alert` cuando se detecta una anomalía.
- Limpieza automática al desconectarse.

### 6.5 api.ts

Router Express montado en `/api/monitoring/` con todos los endpoints read-only. Nunca agrega datos en tiempo real — lee de las colecciones pre-agregadas.

---

## 7. Reglas de Health Check

### 7.1 Ventana activa

El scraper solo debe ejecutarse (y se monitorea) en la ventana **07:00 – 24:00 hora Argentina (UTC-3)**. Fuera de esa ventana, el scraper está en reposo y no se generan falsas alarmas por falta de ejecuciones.

### 7.2 Post-execution hooks

Después de cada ejecución:

1. Se resuelven alertas `scraper-stopped` pendientes (cualquier ejecución implica que el scraper no está detenido).
2. Se ejecutan las 4 reglas de health check post-ejecución (consecutive-failures, slow-execution, repetitive-errors, product-drop).
3. Se agregan métricas del día (`metricsAggregator.aggregateToday()`).

Estos hooks son **fire-and-forget**: nunca bloquean la respuesta HTTP ni el tick del cron.

---

## 8. Base de Datos

### 8.1 Colecciones

| Colección | Propósito | TTL |
|---|---|---|
| `products` | Productos scrapeados (activos, discontinued) | — |
| `scraper_state` | Estado de cada categoría (hash, product count) | — |
| `execution_logs` | Registro de cada ejecución del scraper | 90 días |
| `health_checks` | Alertas de salud detectadas | 180 días |
| `metrics_snapshots` | Métricas diarias pre-agregadas | 365 días |

### 8.2 Índices

- `execution_logs`: `{ startedAt: -1 }`, `{ status: 1, startedAt: -1 }`, TTL en `startedAt`
- `health_checks`: `{ detectedAt: -1 }`, `{ checkType: 1, detectedAt: -1 }`, `{ severity: 1, resolvedAt: 1 }`, TTL en `detectedAt`
- `metrics_snapshots`: `{ date: -1 }` (unique), TTL en `date`
- `products`: indexed por `externalId`, `supplier`, `categories`, `status`

### 8.3 Producto (schema)

```typescript
{
  externalId: string,      // ID del proveedor
  supplier: "jotakp",
  name: string,
  description?: string,
  price: number,           // en USD
  stock: number,
  sku?: string,
  imageUrls: string[],     // URLs originales
  cloudinaryUrls?: string[], // URLs en Cloudinary (si configurado)
  categories: string[],
  status: "active" | "discontinued",
  inStock: boolean,
  currency: "USD",
  createdAt: Date,
  updatedAt: Date,
  lastSyncedAt: Date,
}
```

---

## 9. Despliegue en Railway

### 9.1 Dockerfile

```
FROM node:18-bullseye
# Instala chromium del sistema (NO Playwright browsers)
RUN apt-get install -y chromium chromium-driver
# PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium
CMD ["node", "server.js"]
```

Railway usa chromium del sistema en `/usr/bin/chromium`, no los browsers descargados por Playwright. La variable `PLAYWRIGHT_BROWSERS_PATH` se setea a `/tmp/ms-playwright`.

### 9.2 Gestión de memoria

Railway free tier tiene **512MB de RAM**. Si el scraper crashea y se reconecta, quedan procesos Chromium huérfanos que agotan los PIDs del sistema y causan `EAGAIN` al intentar lanzar uno nuevo.

**Solución:** se ejecuta `pkill -f chromium` antes de cada `chromium.launch()` para limpiar procesos zombie.

### 9.3 Conexión persistente

Railway puede reciclar el contenedor. El scraper usa un singleton de conexión MongoDB que se reconecta automáticamente.

---

## 10. Variables de Entorno

| Variable | Requerida | Default | Descripción |
|---|---|---|---|
| `MONGO_URI` | **Sí** | — | Connection string de MongoDB Atlas |
| `DB_NAME` | No | `ecommerce` | Nombre de la base de datos |
| `PORT` | No | `3001` | Puerto del servidor |
| `SUPPLIER_URL` | No | `https://jotakp.dyndns.org` | URL base del proveedor |
| `SUPPLIER_LOGIN_URL` | No | `http://jotakp.dyndns.org/loginext.aspx` | URL de login |
| `SUPPLIER_EMAIL` | No | `20418216795` | Usuario de acceso |
| `SUPPLIER_PASSWORD` | No | `123456` | Contraseña de acceso |
| `SUPPLIER_DELAY_MS` | No | `3000` | Delay entre requests (ms) |
| `SCRAPER_SCHEDULE` | No | `0 7,10,13,16,19,22 * * 1-6` | Cron schedule en hora Argentina |
| `CHROMIUM_PATH` | No | `/usr/bin/chromium` | Ruta al ejecutable de Chromium |
| `PLAYWRIGHT_BROWSERS_PATH` | No | `/tmp/ms-playwright` | Directorio de browsers Playwright |
| `CLOUDINARY_CLOUD_NAME` | No | — | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | No | — | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | No | — | Cloudinary API secret |
| `CLOUDINARY_FOLDER` | No | `technostore` | Carpeta en Cloudinary |

---

## 11. Solución de Problemas

### 11.1 Error "spawn /usr/bin/chromium EAGAIN"

**Causa:** procesos Chromium huérfanos acumulados en Railway. El kernel no puede crear nuevos procesos.

**Solución automática:** el scraper ejecuta `pkill -f chromium` antes de cada launch. Si el error persiste, probablemente el contenedor necesita reinicio.

**Solución manual:** redeployar en Railway (forza un reinicio limpio).

### 11.2 Error de conexión MongoDB

**Causa:** timeout en el tier M0 de Atlas o credenciales incorrectas.

**Verificación:** `curl GET https://technostore-scraper-production.up.railway.app/debug/mongo-test`

### 11.3 Scraper no se ejecuta según el schedule

**Causa:** Railway durmió el contenedor por inactividad. El cron solo corre mientras el servidor Express está vivo.

**Solución:** configurar un uptime monitor (UptimeRobot, cron-job u otro) que le pegue al `/health` cada 5 minutos.

### 11.4 Productos no se actualizan

**Verificación:** 
1. `curl GET https://technostore-scraper-production.up.railway.app/status` — muestra últimos scrapes
2. Revisar `execution_logs` en MongoDB para ver el estado de las últimas ejecuciones
3. Dashboard: `https://technostore-scraper-production.up.railway.app/dashboard`

### 11.5 Error "browserType.launch: Failed to launch"

**Causa:** Chromium no encontrado o no instalado.

**Verificación:** Railway usa chromium del sistema. El Dockerfile instala `chromium` y `chromium-driver`. Si el deploy falló, la imagen puede no tener chromium. Verificar los logs de build en Railway.

---

## Historial del documento

| Versión | Fecha | Cambios |
|---|---|---|
| 1.0 | 2026-06-17 | Versión inicial del manual |
