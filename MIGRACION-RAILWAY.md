# Migración Scraper Incremental a Railway

## Resumen

Completada migración de la lógica de scraping incremental desde TechnoStore (local) a scraper-server deployado en Railway.

## Cambios Realizados

### scraper-server (Railway)

1. **Chromium del sistema**: Actualizado para usar `/usr/bin/chromium` en lugar de Playwright browsers
2. **Run IDs únicos**: Corregido error de índice duplicado usando `crypto.randomUUID()`
3. **Productos discontinued**: Agregada lógica para marcar productos descontinuados cuando se scrapea por `categoryId`

### TechnoStore Frontend

1. **Filtro status:"active"**: Agregado a todas las queries de productos:
   - `findPaginated`
   - `findByCategorySlugPaginated`
   - `findByCategorySlug`
   - `findBySlug`

2. **Slugs consistentes**: Alineada generación de slugs entre:
   - `generateStaticParams` (pages)
   - `findBySlug` (repository)
   - `toPresentationProduct` (mapper)

## Endpoints Disponibles (Railway)

| Endpoint | Descripción |
|----------|-------------|
| `GET /health` | Health check |
| `GET /status` | Productos activos y últimos scrapes |
| `POST /run` | Scraping viejo (solo 12 categorías) |
| `POST /scraper/incremental` | Scraping completo con pre-check |
| `POST /scraper/run` | Scraping por categoría específica |
| `GET /scraper/categories` | Lista todas las categorías |

## Cron Job

Para ejecutar scraping automáticamente cada X horas:
```
POST https://technostore-scraper-production.up.railway.app/scraper/incremental
```

Con force full scrape:
```
POST https://technostore-scraper-production.up.railway.app/scraper/incremental?force=true
```

## Lecciones Aprendidas

1. Railway usa chromium del sistema, no Playwright browsers
2. Run IDs deben ser únicos para evitar errores de índice
3. Para marcar discontinued se necesita `categoryId`, no solo `idsubrubro1`
4. Frontend debe filtrar `status:"active"` en TODAS las queries
5. Generación de slugs debe ser consistente en todo el stack