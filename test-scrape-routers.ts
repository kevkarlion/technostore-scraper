/**
 * Test script — scrape solo la categoría Routers (idsubrubro1=70)
 * para verificar que los fixes de precio e imágenes funcionan.
 *
 * Uso:
 *   npx ts-node test-scrape-routers.ts
 */
import 'dotenv/config';
import { getScraperConfig } from './src/lib/scraper/config';
import { createHttpClient } from './src/lib/scraper/http-client';
import { ScraperService } from './src/lib/scraper/scraper.service';

async function main() {
  const config = getScraperConfig();
  const http = createHttpClient(config);

  console.log('🔑 Login...');
  const scraper = new ScraperService(config, { categoryId: 'routers', source: 'test' }, http);
  await scraper.login();
  console.log('✅ Login OK\n');

  console.log('📡 Scraping Routers (idsubrubro1=70)...');
  const result = await scraper.run();

  console.log('\n══════════════════════════════════════');
  console.log('📊 RESULTADO');
  console.log('══════════════════════════════════════');
  console.log(`  Creados:    ${result.created}`);
  console.log(`  Actualizados: ${result.updated}`);
  console.log(`  Errores:    ${result.errors.length}`);
  console.log(`  Duración:   ${(result.durationMs / 1000).toFixed(1)}s`);

  if (result.createdIds.length > 0) {
    console.log(`\n  IDs creados: ${result.createdIds.join(', ')}`);
  }
  if (result.updatedIds.length > 0) {
    console.log(`  IDs actualizados: ${result.updatedIds.slice(0, 10).join(', ')}${result.updatedIds.length > 10 ? ` (+${result.updatedIds.length - 10} más)` : ''}`);
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
