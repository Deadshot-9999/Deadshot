// Build the static data files the site reads:
//   public/data/cities.json
//   public/data/mumbai.json            societies + research log
//   public/data/mumbai-shapes.geojson  building outlines from OpenStreetMap
//   public/data/mumbai-societies.csv   download
//
// Input: every pipeline/raw/*.json written by a source adapter (see sources/).
// If none exist yet, the curated seed list (seed-projects.json) is used so the site still works.
import fs from 'node:fs';
import path from 'node:path';
import { locate, landmark } from './lib/geocode.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, '../public/data');
const RAW = path.join(HERE, 'raw');
const CITY_YIELD = 0.026; // gross rental yield used to estimate rent when a source has none (Mumbai avg ~2.3–3%)

const slug = s => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const norm = s => slug(s).replace(/-(mumbai|thane|navi-mumbai)$/, '');

function loadSeed() {
  const rows = JSON.parse(fs.readFileSync(path.join(HERE, 'seed-projects.json'), 'utf8'));
  return rows.map(([name, developer, locality, kind, bhk, [size_min, size_max], [price_min, price_max], status, possession, amenities]) => ({
    name, developer, locality, kind, bhk, size_min, size_max, price_min, price_max, status, possession: String(possession), amenities,
    source: { name: 'Curated seed (indicative prices)', url: null }, price_basis: 'indicative',
  }));
}

function loadRaw() {
  if (!fs.existsSync(RAW)) return [];
  return fs.readdirSync(RAW).filter(f => f.endsWith('.json')).flatMap(f => {
    const j = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
    console.log(`raw/${f}: ${j.records.length} records from ${j.source} (${j.fetched_at})`);
    return j.records.map(r => ({ ...r, fetched_at: j.fetched_at }));
  });
}

// Merge records for the same project coming from several portals.
function merge(records) {
  const by = new Map();
  for (const r of records) {
    const k = norm(r.name) + '|' + norm(r.locality || '');
    const cur = by.get(k);
    if (!cur) { by.set(k, { ...r, sources: [r.source], amenities: [...new Set(r.amenities || [])], bhk: [...new Set(r.bhk || [])] }); continue; }
    cur.sources.push(r.source);
    for (const f of ['developer', 'status', 'possession', 'rera_id', 'units', 'towers', 'acres', 'image', 'kind']) cur[f] ??= r[f];
    for (const [lo, hi] of [['price_min', 'price_max'], ['size_min', 'size_max'], ['rent_min', 'rent_max']]) {
      if (r[lo] != null) cur[lo] = cur[lo] == null ? r[lo] : Math.min(cur[lo], r[lo]);
      if (r[hi] != null) cur[hi] = cur[hi] == null ? r[hi] : Math.max(cur[hi], r[hi]);
    }
    cur.listings_sale = (cur.listings_sale || 0) + (r.listings_sale || 0);
    cur.listings_rent = (cur.listings_rent || 0) + (r.listings_rent || 0);
    cur.amenities = [...new Set([...cur.amenities, ...(r.amenities || [])])];
    cur.bhk = [...new Set([...cur.bhk, ...(r.bhk || [])])].sort();
    if (r.price_basis === 'listed') cur.price_basis = 'listed';
  }
  return [...by.values()];
}

const hav = (a, b) => {
  const R = 6371, t = x => x * Math.PI / 180;
  const d = Math.sin(t(b.lat - a.lat) / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(t(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(d));
};

function liveLinks(s) {
  const q = encodeURIComponent(`${s.name} ${s.locality}`);
  return {
    '99acres': `https://www.99acres.com/search/property/buy/mumbai?keyword=${q}`,
    'Housing.com': `https://housing.com/in/buy/searches/P${q}`,
    'Magicbricks': s.mb_url || `https://www.magicbricks.com/property-for-sale/residential-real-estate?keyword=${q}&cityName=Mumbai`,
    'NoBroker': `https://www.nobroker.in/property/sale/mumbai/${encodeURIComponent(s.locality)}`,
    'PROPi': `https://www.propi.in/`,
    'Google': `https://www.google.com/search?q=${q}+Mumbai+price`,
  };
}

async function main() {
  const raw = loadRaw();
  const usingSeed = raw.length === 0;
  const records = merge(usingSeed ? loadSeed() : raw);
  console.log(`${records.length} societies to place${usingSeed ? ' (seed list — run a source adapter for live data)' : ''}`);

  // Landmarks for the "Nearby" filter.
  const lm = JSON.parse(fs.readFileSync(path.join(HERE, 'landmarks.json'), 'utf8'));
  const landmarks = {};
  for (const [cat, names] of Object.entries(lm)) {
    landmarks[cat] = [];
    for (const n of names) {
      if (Array.isArray(n)) { landmarks[cat].push({ name: n[0], lat: n[1], lng: n[2] }); continue; } // fixed point
      const hit = await landmark(cat, n);
      if (hit) landmarks[cat].push({ name: cat === 'Metro' ? `${n} (Metro)` : n, lat: hit.lat, lng: hit.lng });
      else console.log(`  landmark not found: ${cat} / ${n}`);
    }
  }

  const societies = [], events = [], shapes = [];
  let notLocated = 0, i = 0;
  for (const r of records) {
    i++;
    const loc = await locate(r.name, r.locality);
    if (!loc) { notLocated++; console.log(`  not located: ${r.name}, ${r.locality}`); continue; }
    const id = 's' + slug(r.name + '-' + r.locality);
    const s = {
      id, name: r.name, developer: r.developer || null, locality: r.locality, lat: +loc.lat.toFixed(5), lng: +loc.lng.toFixed(5),
      precision: loc.precision, status: r.status || null, possession: r.possession || null, rera_id: r.rera_id || null,
      units: r.units || null, towers: r.towers || null, acres: r.acres || null, kind: r.kind || 'apartment', bhk: r.bhk || [],
      size_min: r.size_min ?? null, size_max: r.size_max ?? null, price_min: r.price_min ?? null, price_max: r.price_max ?? null,
      price_basis: r.price_basis || 'listed',
      rent_min: r.rent_min ?? (r.price_min ? Math.round(r.price_min * CITY_YIELD / 12 / 500) * 500 : null),
      rent_max: r.rent_max ?? (r.price_max ? Math.round(r.price_max * CITY_YIELD / 12 / 500) * 500 : null),
      rent_estimated: r.rent_min == null,
      listings_sale: r.listings_sale || 0, listings_rent: r.listings_rent || 0,
      amenities: r.amenities || [], image: r.image || null,
      sources: (r.sources || [r.source]).filter(Boolean), fetched_at: r.fetched_at || null,
    };
    s.near = {};
    for (const [cat, pts] of Object.entries(landmarks)) {
      let best = null;
      for (const p of pts) { const d = hav(s, p); if (!best || d < best.km) best = { name: p.name, km: +d.toFixed(2) }; }
      if (best) s.near[cat] = best;
    }
    s.links = liveLinks({ ...s, mb_url: (s.sources.find(x => x && /magicbricks/.test(x.url || '')) || {}).url });
    societies.push(s);
    if (loc.geojson) shapes.push({ type: 'Feature', properties: { id }, geometry: loc.geojson });

    const src = s.sources[0] || {};
    events.push({ sid: id, step: 'Found', finding: `${s.name} · ${src.name || 'source'}`, url: src.url || null });
    events.push({ sid: id, step: 'Located on map', finding: `${s.locality} · ${s.lat.toFixed(4)}, ${s.lng.toFixed(4)} · ${loc.precision === 'building' ? 'OSM ' + loc.osm : 'locality centre'}`, url: loc.osm ? `https://www.openstreetmap.org/${loc.osm}` : null });
    if (s.price_min) events.push({ sid: id, step: 'Prices read', finding: `${inr(s.price_min)} – ${inr(s.price_max)}${s.price_basis === 'indicative' ? ' (indicative)' : ''}`, url: src.url || null });
    const m = s.near.Metro, t = s.near['Local train'];
    if (m || t) events.push({ sid: id, step: 'Commute checked', finding: [t && `${t.name.replace(' railway station', '')} station ${t.km} km`, m && `${m.name} ${m.km} km`].filter(Boolean).join(' · '), url: null });
    if (i % 20 === 0) console.log(`  ${i}/${records.length}`);
  }

  const now = new Date().toISOString();
  const allSources = [...new Set(societies.flatMap(s => s.sources.map(x => x && x.name)).filter(Boolean)), 'OpenStreetMap contributors'];
  const out = {
    city: { id: 'mumbai', name: 'Mumbai', center: [72.88, 19.1], zoom: 10.6 },
    generated_at: now, seed: usingSeed, city_yield: CITY_YIELD,
    counts: { listed: records.length, on_map: societies.length, not_located: notLocated, exact: societies.filter(s => s.precision === 'building').length,
      for_sale: societies.reduce((a, s) => a + s.listings_sale, 0), for_rent: societies.reduce((a, s) => a + s.listings_rent, 0) },
    sources: allSources, landmarks, societies, events,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'cities.json'), JSON.stringify({ mumbai: { name: 'Mumbai' } }));
  fs.writeFileSync(path.join(OUT, 'mumbai.json'), JSON.stringify(out));
  fs.writeFileSync(path.join(OUT, 'mumbai-shapes.geojson'), JSON.stringify({ type: 'FeatureCollection', features: shapes }));
  const cols = ['name', 'developer', 'locality', 'kind', 'status', 'possession', 'bhk', 'size_min', 'size_max', 'price_min', 'price_max', 'price_basis', 'rent_min', 'rent_max', 'rent_estimated', 'lat', 'lng', 'precision', 'amenities', 'source'];
  const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const csv = [cols.join(','), ...societies.map(s => cols.map(c => esc(c === 'bhk' || c === 'amenities' ? s[c].join('; ') : c === 'source' ? s.sources.map(x => x.url || x.name).join(' ') : s[c])).join(','))].join('\n');
  fs.writeFileSync(path.join(OUT, 'mumbai-societies.csv'), csv);
  console.log(`wrote ${societies.length} societies (${out.counts.exact} with exact OSM location), ${shapes.length} outlines, ${notLocated} not located`);
}

function inr(n) { return n >= 1e7 ? `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, '')} Cr` : `₹${(n / 1e5).toFixed(0)} L`; }

main().catch(e => { console.error(e); process.exit(1); });
