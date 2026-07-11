/**
 * Check DB state — ver qué tienen los productos de Routers en la DB.
 * Uso: npx ts-node test-check-db.ts
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

async function main() {
  const client = new MongoClient(process.env.MONGO_URI!);
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'ecommerce');

  const products = await db.collection('products')
    .find({ categories: 'routers', supplier: 'jotakp' })
    .project({ externalId: 1, name: 1, priceRaw: 1, price: 1, imageUrls: 1, sku: 1, stock: 1, description: 1 })
    .toArray();

  console.log(`\n📦 Productos Routers en DB: ${products.length}\n`);

  for (const p of products) {
    const hasPrice = p.priceRaw && p.priceRaw !== '';
    const imgCount = p.imageUrls?.length || 0;
    const hasDesc = p.description && p.description !== '' && p.description !== 'Sin descripción';

    console.log(`ID: ${p.externalId}`);
    console.log(`  Nombre:      ${p.name}`);
    console.log(`  priceRaw:    ${hasPrice ? '✅' + p.priceRaw : '❌ null/empty'}`);
    console.log(`  price:       ${p.price}`);
    console.log(`  imágenes:    ${imgCount > 0 ? '✅' + imgCount : '❌ 0'}`);
    console.log(`  SKU:         ${p.sku || '❌ empty'}`);
    console.log(`  descripción: ${hasDesc ? '✅' + p.description.slice(0, 60) + '...' : '❌ missing'}`);
    console.log('');
  }

  // Resumen
  const withPrice = products.filter((p: any) => p.priceRaw && p.priceRaw !== '').length;
  const withImages = products.filter((p: any) => p.imageUrls?.length > 0).length;
  console.log('══════════════════════════════════════');
  console.log('📊 RESUMEN');
  console.log('══════════════════════════════════════');
  console.log(`  Con precio:    ${withPrice}/${products.length}`);
  console.log(`  Con imágenes:  ${withImages}/${products.length}`);

  await client.close();
  process.exit(0);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
