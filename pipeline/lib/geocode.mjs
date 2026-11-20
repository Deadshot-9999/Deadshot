// Geocode with OpenStreetMap Nominatim.
// Usage policy: max 1 request/second, identify the app, cache results.
// https://operations.osmfoundation.org/policies/nominatim/
import fs from 'node:fs';
import path from 'node:path';

const CACHE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../.cache/geocode.json');
// Mumbai Metropolitan Region (lon/lat): Virar to Panvel, the sea to Kalyan.
const VIEWBOX = '72.75,19.50,73.25,18.85';
const UA = 'flat-finder-mumbai/1.0 (open-source map of Mumbai housing societies)';

let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch {}
const save = () => { fs.mkdirSync(path.dirname(CACHE), { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1)); };

let last = 0;
async function search(q, { polygon = false, featureType = null, limit = 5 } = {}) {
  const key = `${q}|${featureType || ''}|${limit}${polygon ? '|p' : ''}`;
  if (key in cache) return cache[key];
  const wait = 1100 - (Date.now() - last);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
  const u = new URL('https://nominatim.openstreetmap.org/search');
  const p = { q, format: 'jsonv2', limit: String(limit), countrycodes: 'in', viewbox: VIEWBOX, bounded: '1' };
  if (polygon) Object.assign(p, { polygon_geojson: '1', polygon_threshold: '0.00002' });
  if (featureType) p.featureType = featureType;
  u.search = new URLSearchParams(p);
  const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  if (!r.ok) throw new Error(`nominatim ${r.status} for ${q}`);
  const hits = (await r.json()).map(j => ({ lat: +j.lat, lng: +j.lon, osm: `${j.osm_type}/${j.osm_id}`, cls: `${j.category}:${j.type}`, display: j.display_name, geojson: j.geojson && j.geojson.type !== 'Point' ? j.geojson : null }));
  cache[key] = hits; save();
  return hits;
}

export const km = (a, b) => {
  const R = 6371, t = x => x * Math.PI / 180;
  const d = Math.sin(t(b.lat - a.lat) / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(t(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(d));
};

// Localities: settlements only (suburb / neighbourhood / town), never a random building that shares the name.
const locCache = new Map();
export async function locality(name) {
  if (locCache.has(name)) return locCache.get(name);
  const base = name.replace(/\s+(East|West)$/i, '');
  let hit = null;
  for (const q of [name, `${name}, Mumbai`, base]) {
    const hits = await search(q, { featureType: 'settlement' });
    hit = hits.find(h => /^(place|boundary):/.test(h.cls));
    if (hit) break;
  }
  locCache.set(name, hit || null);
  return hit || null;
}

const NOT_A_SOCIETY = /^(highway|water|waterway|natural|railway|public_transport|boundary|amenity:(hospital|clinic|bus_station|restaurant|cafe|school|college|place_of_worship)|office|shop|leisure|tourism|aeroway)/;

// Returns { lat, lng, precision: 'building' | 'locality', osm, geojson } or null.
export async function locate(name, loc) {
  const L = await locality(loc);
  for (const q of [`${name}, ${loc}`, name]) {
    const hits = await search(q, { polygon: true });
    const ok = hits.find(h => !NOT_A_SOCIETY.test(h.cls) && !/^place:(suburb|city|town|quarter)/.test(h.cls) && (!L || km(h, L) <= 4));
    if (ok) return { ...ok, precision: 'building' };
  }
  if (L) return { ...L, geojson: null, precision: 'locality' };
  return null;
}

// Landmarks: only accept a result of the right kind; skip rather than guess.
const KIND = {
  'Metro': { q: n => [`${n} metro station`, n], ok: /^(railway|public_transport):/ },
  'Local train': { q: n => [`${n} railway station`, `${n} station`, n], ok: /^(railway|public_transport):/ },
  'Airport': { q: n => [n], ok: /^(aeroway|building|amenity)/ },
  'Business district': { q: n => [n], ok: /^(landuse|place|building|office|amenity|highway:(?!motorway))/ },
  'Hospital': { q: n => [n], ok: /^(amenity|building|healthcare|landuse|highway:bus_stop)/ },
  'Sea / promenade': { q: n => [n], ok: /^(highway|natural|leisure|place|tourism|amenity)/ },
};
export async function landmark(cat, name) {
  const k = KIND[cat];
  for (const q of k.q(name)) {
    const hits = await search(q);
    const ok = hits.find(h => k.ok.test(h.cls));
    if (ok) return ok;
  }
  return null;
}
