// Geocode project names with OpenStreetMap Nominatim.
// Usage policy: max 1 request/second, identify the app, cache results.
// https://operations.osmfoundation.org/policies/nominatim/
import fs from 'node:fs';
import path from 'node:path';

const CACHE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../.cache/geocode.json');
// Mumbai Metropolitan Region bounding box (lon/lat): Virar to Panvel, Arabian Sea to Kalyan.
const VIEWBOX = '72.75,19.50,73.25,18.85';
const UA = 'flat-finder-mumbai/1.0 (open-source map of Mumbai housing societies)';

let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch {}
const save = () => { fs.mkdirSync(path.dirname(CACHE), { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1)); };

let last = 0;
async function nominatim(q, polygon = false) {
  if (q in cache) return cache[q];
  const wait = 1100 - (Date.now() - last);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.search = new URLSearchParams({ q, format: 'jsonv2', limit: '1', countrycodes: 'in', viewbox: VIEWBOX, bounded: '1', polygon_geojson: polygon ? '1' : '0', polygon_threshold: '0.00002' });
  const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  if (!r.ok) throw new Error(`nominatim ${r.status} for ${q}`);
  const j = await r.json();
  const hit = j[0] ? { lat: +j[0].lat, lng: +j[0].lon, osm: `${j[0].osm_type}/${j[0].osm_id}`, cls: `${j[0].category}:${j[0].type}`, display: j[0].display_name, geojson: j[0].geojson && j[0].geojson.type !== 'Point' ? j[0].geojson : null } : null;
  cache[q] = hit; save();
  return hit;
}

// Returns { lat, lng, precision: 'building' | 'locality', osm, geojson } or null.
export async function locate(name, locality) {
  const exact = await nominatim(`${name}, ${locality}, Mumbai`, true) || await nominatim(`${name}, Mumbai`, true);
  if (exact && !/^(boundary|place):/.test(exact.cls)) return { ...exact, precision: 'building' };
  const loc = await nominatim(`${locality}, Mumbai`);
  if (loc) return { ...loc, geojson: null, precision: 'locality' };
  return null;
}
