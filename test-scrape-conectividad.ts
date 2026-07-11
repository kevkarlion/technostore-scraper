/**
 * Test script — scrape toda la categoría Conectividad (11 subcategorías).
 *
 * Uso:
 *   PLAYWRIGHT_BROWSERS_PATH=0 npx tsx test-scrape-conectividad.ts
 */
import 'dotenv/config';
import { getScraperConfig, jotakpCategories } from './src/lib/scraper/config';
import { createHttpClient } from './src/lib/scraper/http-client';
import { ScraperService } from './src/lib/scraper/scraper.service';

const CONECTIVIDAD_SUBS = [
  'antenas', 'conectores', 'extensores', 'patch-cord', 'patch-panel',
  'placas-de-red', 'puntos-de-acceso', 'rack', 'routers', 'switches', 'utp-ftp',
];

async function main() {
  const config = getScraperConfig();
  const http = createHttpClient(config);

  console.log('🔑 Login...');
  const scraper = new ScraperService(config, { source: 'test' }, http);
  await scraper.login();
  console.log('✅ Login OK\n');

  // Filter categories to only Conectividad subcategories
  const cats = jotakpCategories.filter(c => CONECTIVIDAD_SUBS.includes(c.id));
  console.log(`📡 Scraping ${cats.length} subcategorías de Conectividad:`);
  cats.forEach(c => console.log(`   - ${c.name} (idsubrubro1=${c.idsubrubro1})`));
  console.log('');

  // Override categories on the scraper instance
  (scraper as any).categories = cats;

  const result = await scraper.run();

  console.log('\n══════════════════════════════════════');
  console.log('📊 RESULTADO FINAL — CONECTIVIDAD');
  console.log('══════════════════════════════════════');
  console.log(`  Creados:      ${result.created}`);
  console.log(`  Actualizados: ${result.updated}`);
  console.log(`  Errores:      ${result.errors.length}`);
  console.log(`  Duración:     ${(result.durationMs / 1000).toFixed(1)}s`);

  if (result.createdIds.length > 0) {
    console.log(`\n  IDs creados: ${result.createdIds.join(', ')}`);
  }
  if (result.errors.length > 0) {
    console.log('\n  ❌ Errores:');
    result.errors.forEach((e) => console.log(`    - ${e}`));
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('💥 Fatal:', e);
  process.exit(1);
});
