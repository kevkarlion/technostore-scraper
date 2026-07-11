/**
 * Debug script: compare raw Axios HTML vs browser for detail page.
 * Logs in, fetches /articulo.aspx?id=22396, dumps raw HTML + pattern matches.
 */

import * as fs from 'fs';
import * as cheerio from 'cheerio';
import { createHttpClient, safeGet, safePost } from '../lib/scraper/http-client';
import { getScraperConfig } from '../lib/scraper/config';

const DETAIL_PATH = '/articulo.aspx?id=22396';
const DUMP_FILE = '/tmp/detail-22396.html';

async function main() {
  const config = getScraperConfig();
  const http = createHttpClient(config);

  // ── Login ────────────────────────────────────────────────────────────
  console.log(`[1] GET login page: ${config.loginUrl}`);
  const loginPageHtml = await safeGet(http, config.loginUrl);
  const $login = cheerio.load(loginPageHtml);

  const loginBody: Record<string, string> = {};
  $login('input[type="hidden"]').each((_: any, el: any) => {
    const name = $login(el).attr('name');
    const value = $login(el).attr('value') || '';
    if (name) loginBody[name] = value;
  });

  const emailInputName = $login('input[name*="txtUsuario"]').first().attr('name') || 'txtUsuario';
  const passInputName = $login('input[name*="txtClave"]').first().attr('name') || 'txtClave';
  const btnName = $login('input[name*="btnIngresar"]').first().attr('name') || 'btnIngresar';

  loginBody[emailInputName] = config.email;
  loginBody[passInputName] = config.password;
  loginBody[btnName] = 'Ingresar';

  console.log(`[2] POST login (${Object.keys(loginBody).length} fields)`);
  await safePost(http, config.loginUrl, loginBody);
  console.log('[3] Login OK\n');

  // ── Fetch detail page ────────────────────────────────────────────────
  console.log(`[4] GET detail page: ${DETAIL_PATH}`);
  const html = await safeGet(http, DETAIL_PATH);
  console.log(`[5] Response length: ${html.length} chars\n`);

  // ── Save full HTML to file ───────────────────────────────────────────
  fs.writeFileSync(DUMP_FILE, html, 'utf-8');
  console.log(`[6] Full HTML written to ${DUMP_FILE}\n`);

  // ── Raw HTML preview (first 5000 chars) ──────────────────────────────
  console.log('═══════════════════════════════════════════════════════');
  console.log('  RAW HTML — first 5000 chars');
  console.log('═══════════════════════════════════════════════════════');
  console.log(html.substring(0, 5000));
  console.log('═══════════════════════════════════════════════════════\n');

  // ── Pattern search ───────────────────────────────────────────────────
  const patterns = [
    { label: 'tg-body-f18', regex: /tg-body-f18/gi },
    { label: 'U$D', regex: /U\$D/g },
    { label: 'USD (case)', regex: /USD/gi },
    { label: '169', regex: /169/g },
    { label: 'precio (case)', regex: /precio/gi },
    { label: 'price (case)', regex: /price/gi },
    { label: 'lblPrecio', regex: /lblPrecio/gi },
    { label: 'tg-prices', regex: /tg-prices/gi },
    { label: 'class with price', regex: /class="[^"]*price[^"]*"/gi },
    { label: 'data-price', regex: /data-price/gi },
  ];

  console.log('═══════════════════════════════════════════════════════');
  console.log('  PATTERN MATCHES');
  console.log('═══════════════════════════════════════════════════════');
  for (const p of patterns) {
    const matches = html.match(p.regex);
    console.log(`  ${p.label}: ${matches ? `${matches.length} match(es)` : 'NOT FOUND'}`);
    if (matches) {
      for (const m of matches.slice(0, 3)) {
        const idx = html.indexOf(m);
        const start = Math.max(0, idx - 80);
        const end = Math.min(html.length, idx + m.length + 80);
        console.log(`    context: ...${html.substring(start, end)}...`);
      }
    }
  }
  console.log('═══════════════════════════════════════════════════════\n');

  // ── Cheerio: all label elements ──────────────────────────────────────
  const $ = cheerio.load(html);

  console.log('═══════════════════════════════════════════════════════');
  console.log('  ASP.NET LABELS (id contains "lbl")');
  console.log('═══════════════════════════════════════════════════════');
  $('[id*="lbl"]').each((_: any, el: any) => {
    const id = $(el).attr('id') || '';
    const text = $(el).text().trim();
    if (text.length > 0) {
      console.log(`  #${id}: ${JSON.stringify(text.substring(0, 200))}`);
    }
  });
  console.log('');

  // ── All elements with "tg-" classes ──────────────────────────────────
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ELEMENTS with tg-* classes');
  console.log('═══════════════════════════════════════════════════════');
  $('[class*="tg-"]').each((_: any, el: any) => {
    const tag = $(el).prop('tagName');
    const cls = $(el).attr('class') || '';
    const text = $(el).text().trim().substring(0, 120);
    console.log(`  <${tag} class="${cls}"> ${text ? JSON.stringify(text) : '(empty)'}`);
  });
  console.log('');

  // ── Extract snippet around price area ────────────────────────────────
  console.log('═══════════════════════════════════════════════════════');
  console.log('  HTML SNIPPET — area around price indicators');
  console.log('═══════════════════════════════════════════════════════');

  const priceMarkers = ['tg-body-f18', 'tg-prices', 'lblPrecio', 'precio', 'U$D'];
  for (const marker of priceMarkers) {
    const idx = html.toLowerCase().indexOf(marker.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 300);
      const end = Math.min(html.length, idx + 500);
      console.log(`\n  [marker: "${marker}" @ pos ${idx}]`);
      console.log(html.substring(start, end));
      console.log('  ─────────────────────────────────────');
    } else {
      console.log(`\n  [marker: "${marker}"] — NOT FOUND in HTML`);
    }
  }
  console.log('═══════════════════════════════════════════════════════\n');

  // ── Script tags with price keywords ──────────────────────────────────
  console.log('═══════════════════════════════════════════════════════');
  console.log('  SCRIPT TAGS containing price keywords');
  console.log('═══════════════════════════════════════════════════════');
  let scriptHits = 0;
  $('script').each((_: any, el: any) => {
    const content = $(el).html() || '';
    if (content.match(/precio|price|U\$D|USD|costo|stock/i)) {
      scriptHits++;
      console.log(`  --- script #${scriptHits} (${content.length} chars) ---`);
      console.log(content.substring(0, 800));
    }
  });
  if (scriptHits === 0) console.log('  (none found)');
  console.log('═══════════════════════════════════════════════════════\n');

  // ── Summary ──────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Total HTML length: ${html.length}`);
  console.log(`  Has tg-body-f18: ${html.includes('tg-body-f18')}`);
  console.log(`  Has U$D: ${html.includes('U$D')}`);
  console.log(`  Has 169: ${html.includes('169')}`);
  console.log(`  Has precio: ${html.toLowerCase().includes('precio')}`);
  console.log(`  Has lblPrecio: ${html.toLowerCase().includes('lblprecio')}`);
  console.log(`  Has tg-prices: ${html.includes('tg-prices')}`);
  console.log(`  Full HTML saved to: ${DUMP_FILE}`);
  console.log('═══════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('FATAL ERROR:', err.message);
  process.exit(1);
});
