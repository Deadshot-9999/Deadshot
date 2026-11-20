// Magicbricks source adapter.
// Opens the public "New Projects in Mumbai" pages in a normal Chromium window, lets the page load
// its own project cards, and keeps the JSON the page itself requests (mbproject/newProjectCards).
// Output: pipeline/raw/magicbricks.json  →  then run `npm run build`.
//
//   node pipeline/sources/magicbricks.mjs [--pages 40] [--headed] [--inspect]
//
// Be polite: one page at a time with a pause between pages. Run it on your own machine;
// portals often block cloud/datacenter IP addresses.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const PAGES = +opt('--pages', 200);
const HEADED = args.includes('--headed');
const INSPECT = args.includes('--inspect');
const PAUSE_MS = 2500;

const pick = (o, keys) => { for (const k of keys) { const v = k.split('.').reduce((a, p) => a?.[p], o); if (v != null && v !== '') return v; } return null; };
const num = v => { if (v == null) return null; const n = parseFloat(String(v).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : null; };
function rupees(v) {
  if (v == null) return null; if (typeof v === 'number') return v;
  const s = String(v).toLowerCase(); const n = num(s); if (n == null) return null;
  return /cr/.test(s) ? n * 1e7 : /lac|lakh|\bl\b/.test(s) ? n * 1e5 : n;
}
// Find arrays of project-like objects anywhere inside a JSON response.
function projectsIn(j, out = []) {
  if (Array.isArray(j)) { if (j.length && typeof j[0] === 'object' && j[0] && Object.keys(j[0]).some(k => /proj.*name|^pname$|^name$/i.test(k))) out.push(...j); else j.forEach(x => projectsIn(x, out)); }
  else if (j && typeof j === 'object') Object.values(j).forEach(v => projectsIn(v, out));
  return out;
}
function normalize(p) {
  const name = pick(p, ['projectName', 'pname', 'prjName', 'name', 'psmName']);
  const locality = pick(p, ['locality', 'localityName', 'lmtDName', 'locName', 'location', 'address.locality']);
  if (!name || !locality) return null;
  const bhkText = String(pick(p, ['bhk', 'bedroomStr', 'bhkStr', 'configuration', 'unitTypes', 'propTypeStr']) || '');
  const bhk = [...new Set((bhkText.match(/\d+(?=\s*(,|\s)*\s*(bhk|rk|and|,|$))/gi) || []).map(Number).filter(n => n > 0 && n < 10))];
  const url = pick(p, ['url', 'pdpUrl', 'projectUrl', 'seoUrl']);
  const amen = pick(p, ['amenities', 'amenityList', 'amenitiesStr']);
  return {
    name: String(name).trim(),
    developer: pick(p, ['developerName', 'builderName', 'devName', 'builder']) || null,
    locality: String(locality).replace(/,?\s*(Mumbai|Thane|Navi Mumbai)$/i, '').trim(),
    kind: /villa/i.test(bhkText) ? 'villa' : /plot/i.test(bhkText) ? 'plot' : 'apartment',
    bhk,
    size_min: num(pick(p, ['minArea', 'minSize', 'areaMin', 'minCarpetArea'])), size_max: num(pick(p, ['maxArea', 'maxSize', 'areaMax', 'maxCarpetArea'])),
    price_min: rupees(pick(p, ['minPrice', 'priceMin', 'minPriceD', 'startPrice'])), price_max: rupees(pick(p, ['maxPrice', 'priceMax', 'maxPriceD'])),
    status: pick(p, ['possessionStatus', 'status', 'projectStatus', 'constructionStatus']),
    possession: pick(p, ['possessionDate', 'possession', 'possDate']),
    rera_id: pick(p, ['reraId', 'reraNumber', 'rera']),
    units: num(pick(p, ['totalUnits', 'units'])), towers: num(pick(p, ['totalTowers', 'towers'])), acres: num(pick(p, ['projectArea', 'totalArea'])),
    amenities: Array.isArray(amen) ? amen.map(a => typeof a === 'string' ? a : a.name).filter(Boolean) : typeof amen === 'string' ? amen.split(/[,|]/).map(x => x.trim()).filter(Boolean) : [],
    listings_sale: num(pick(p, ['saleCount', 'propertyCount', 'noOfProperties'])) || 0,
    listings_rent: num(pick(p, ['rentCount'])) || 0,
    image: pick(p, ['image', 'imgUrl', 'projectImage', 'coverImage']),
    price_basis: 'listed',
    source: { name: 'Magicbricks', url: url ? new URL(url, 'https://www.magicbricks.com').href : null },
  };
}

const browser = await chromium.launch({ headless: !HEADED });
const ctx = await browser.newContext({ locale: 'en-IN', viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const seen = new Map(); let rawSample = null;
page.on('response', async r => {
  if (!/mbproject\/(newProjectCards|getInventoryProject)/.test(r.url())) return;
  try {
    const j = await r.json(); const ps = projectsIn(j);
    if (!rawSample && ps.length) rawSample = ps[0];
    for (const p of ps) { const n = normalize(p); if (n) seen.set(n.name + '|' + n.locality, n); }
  } catch {}
});
for (let i = 1; i <= PAGES; i++) {
  const before = seen.size;
  const url = i === 1 ? 'https://www.magicbricks.com/new-projects-mumbai' : `https://www.magicbricks.com/new-projects-mumbai?page=${i}`;
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) { console.log(`page ${i}: ${e.message}`); }
  for (let k = 0; k < 6; k++) { await page.mouse.wheel(0, 2500); await page.waitForTimeout(700); }
  await page.waitForTimeout(PAUSE_MS);
  console.log(`page ${i}: ${seen.size} projects (+${seen.size - before})`);
  if (INSPECT && rawSample) { console.log('Sample raw record keys:', Object.keys(rawSample)); console.log(JSON.stringify(rawSample, null, 1).slice(0, 3000)); break; }
  if (i > 2 && seen.size === before) { console.log('No new projects on this page, stopping.'); break; }
}
await browser.close();

if (!INSPECT) {
  if (!seen.size) { console.error('No projects captured. Run with --headed --inspect to see what the page returns.'); process.exit(1); }
  fs.mkdirSync(path.join(HERE, '../raw'), { recursive: true });
  fs.writeFileSync(path.join(HERE, '../raw/magicbricks.json'), JSON.stringify({ source: 'Magicbricks', fetched_at: new Date().toISOString(), records: [...seen.values()] }, null, 1));
  console.log(`saved ${seen.size} projects to pipeline/raw/magicbricks.json`);
}
