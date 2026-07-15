/**
 * Borrar todos los productos con status 'discontinued' de la DB.
 * Uso: npx ts-node delete-discontinued.ts [--dry-run]
 *
 * --dry-run  solo muestra qué se borraría, sin tocar la DB.
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const client = new MongoClient(process.env.MONGO_URI!);
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'ecommerce');
  const collection = db.collection('products');

  // Contar discontinued
  const total = await collection.countDocuments({ status: 'discontinued' });
  console.log(`\n🗑️  Productos discontinued: ${total}\n`);

  if (total === 0) {
    console.log('Nada que borrar.');
    await client.close();
    process.exit(0);
  }

  // Muestra los primeros 10
  const sample = await collection
    .find({ status: 'discontinued' })
    .project({ externalId: 1, name: 1, categories: 1, discontinuedAt: 1 })
    .limit(10)
    .toArray();

  console.log('Ejemplo:');
  for (const p of sample) {
    console.log(`  - ${p.externalId}: ${p.name} [${p.categories?.join(', ')}]`);
  }
  if (total > 10) console.log(`  ... y ${total - 10} más\n`);

  if (dryRun) {
    console.log('🔒 DRY RUN — no se borró nada.\n');
    await client.close();
    process.exit(0);
  }

  // Borrar
  const result = await collection.deleteMany({ status: 'discontinued' });
  console.log(`✅ Borrados: ${result.deletedCount} productos\n`);

  await client.close();
  process.exit(0);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
