# Scraper Server

Servidor standalone para ejecutar el scraper incremental. Deployalo en un service gratuito (Railway, Render, Fly.io) y cron-job.io lo llama cada 2 horas.

## Quick Start (Local)

```bash
cd scraper-server
cp .env.example .env
# Edit .env with your MongoDB Atlas credentials

npm install
npm start
```

## Deploy en Railway (gratis)

1. Crear cuenta en [railway.app](https://railway.app)
2. New Project → "Deploy from GitHub repo"
3. Seleccionar este repo (o crear uno nuevo solo con scraper-server/)
4. Agregar variables de entorno:
   - `MONGO_URI` = tu connection string de MongoDB Atlas
   - `PORT` = 3001
   - Las demas vars de .env.example
5. Click Deploy

## Deploy en Render (gratis)

1. Crear cuenta en [render.com](https://render.com)
2. New → Web Service
3. Conectar tu GitHub repo
4. Build command: `npm install`
5. Start command: `node server.js`
6. Agregar las environment variables

## Uso con cron-job.io

Una vez deployado, configurá el cron en cron-job.io:

**URL:**
```
https://tu-scraper-server.railway.app/run
```

**Schedule:** Every 2 hours

## Notas

- El servidor usa Playwright con chromium del sistema (no necesita descargar browsers)
- MongoDB debe ser accesible (Atlas o local con tunnel)
- El endpoint `/run` ejecuta el scraper y devuelve JSON con el resultado