/**
 * Cleanup script: removes jotakp products without costPrice and syncs scraper_state.
 * Usage: node scripts/cleanup-products.js
 */

const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || process.env.MONGODB_DB_NAME || 'ecommerce';

if (!uri) {
  console.error('ERROR: MONGO_URI not set');
  process.exit(1);
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB_NAME);

  // 1. Delete products without costPrice
  const toDelete = await db.collection('products').countDocuments({
    supplier: 'jotakp',
    $or: [
      { costPrice: { $exists: false } },
      { costPrice: null },
      { costPrice: 0 },
    ],
  });

  if (toDelete === 0) {
    console.log('No products to clean.');
    await client.close();
    return;
  }

  const result = await db.collection('products').deleteMany({
    supplier: 'jotakp',
    $or: [
      { costPrice: { $exists: false } },
      { costPrice: null },
      { costPrice: 0 },
    ],
  });
  console.log(`Deleted ${result.deletedCount} products without costPrice`);

  // 2. Sync scraper_state — remove IDs that no longer exist
  const remainingIds = await db.collection('products').distinct('externalId', { supplier: 'jotakp' });
  const remainingSet = new Set(remainingIds);

  const states = await db.collection('scraper_state').find({}).toArray();
  let stateCleaned = 0;
  for (const state of states) {
    if (state.productIds && state.productIds.length > 0) {
      const cleaned = state.productIds.filter((id) => remainingSet.has(id));
      if (cleaned.length !== state.productIds.length) {
        const removed = state.productIds.length - cleaned.length;
        await db.collection('scraper_state').updateOne(
          { _id: state._id },
          { $set: { productIds: cleaned } },
        );
        console.log(`  ${state.categoryId}: removed ${removed} orphan IDs`);
        stateCleaned++;
      }
    }
  }
  console.log(`Synced ${stateCleaned} scraper_state categories`);

  // 3. Summary
  const after = await db.collection('products').countDocuments({ supplier: 'jotakp' });
  console.log(`\nDone. Products remaining: ${after}`);

  await client.close();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
