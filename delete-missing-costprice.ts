/**
 * Borra productos sin campo costPrice de la DB.
 * Uso: npx ts-node delete-missing-costprice.ts
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

async function main() {
  const client = new MongoClient(process.env.MONGO_URI!);
  await client.connect();
  
  const db = client.db(process.env.DB_NAME || 'ecommerce');
  const products = db.collection('products');

  // Find products without costPrice
  const query = {
    $or: [
      { costPrice: { $exists: false } },
      { costPrice: null }
    ]
  };

  const count = await products.countDocuments(query);
  console.log(`\n📊 Productos sin costPrice: ${count}\n`);

  if (count === 0) {
    console.log('✅ No hay productos para borrar.\n');
    await client.close();
    process.exit(0);
  }

  // Show sample
  const sample = await products.find(query).project({ 
    externalId: 1, 
    name: 1, 
    price: 1, 
    createdAt: 1 
  }).limit(10).toArray();
  
  console.log('Ejemplo de productos a borrar:');
  for (const p of sample) {
    console.log(`  - ${p.externalId}: ${p.name?.slice(0, 40)} (price: ${p.price})`);
  }
  console.log(`  ... y ${count - 10} más\n`);

  // Delete
  const result = await products.deleteMany(query);
  console.log(`✅ Borrados: ${result.deletedCount} productos\n`);

  await client.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('💥 Error:', e);
  process.exit(1);
});