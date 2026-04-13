// Quick test script to scrape "memorias" category
import 'dotenv/config';
import { runScraper } from './src/lib/scraper/index';

async function test() {
  console.log('[Test] Starting scrape for memorias category...');
  
  try {
    const result = await runScraper({ 
      categoryId: 'memorias',
      idsubrubro1: 1,
      source: 'test' 
    });
    
    console.log('[Test] Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('[Test] Error:', error);
  }
}

test();