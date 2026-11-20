/* Flat Finder · Mumbai */
const $ = s => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, ''); else if (v != null && v !== false) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const inr = n => n == null ? '—' : n >= 1e7 ? `₹${(n / 1e7).toFixed(n >= 1e8 ? 0 : 2).replace(/\.?0+$/, '')} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(n >= 1e6 ? 0 : 1).replace(/\.0$/, '')} L` : `₹${Math.round(n / 1e3)}k`;
const sqft = n => n == null ? '—' : `${Math.round(n).toLocaleString('en-IN')} sq ft`;
const toast = msg => { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); };

const STEPS = {
  buy: [0, 50e5, 75e5, 1e7, 1.5e7, 2e7, 3e7, 5e7, 7.5e7, 1e8, 2e8, 5e8, Infinity],
  rent: [0, 15e3, 25e3, 35e3, 50e3, 75e3, 1e5, 1.5e5, 2e5, 3e5, 5e5, 10e5, Infinity],
  size: [0, 400, 500, 650, 800, 1000, 1250, 1500, 2000, 2500, 3500, 5000, Infinity],
};
const NEAR = { 'Metro': 1, 'Local train': 1.5, 'Airport': 8, 'Business district': 4, 'Hospital': 3, 'Sea / promenade': 2 };
const KIND_LABEL = { apartment: 'Apartment', villa: 'Villa', plot: 'Plot', penthouse: 'Penthouse', 'builder-floor': 'Builder floor' };
const STYLES = {
  night: 'https://tiles.openfreemap.org/styles/dark',
  streets: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron',
};
const LIST_KEY = 'ff-mumbai-list';

const S = {
  mode: 'buy', kind: new Set(), bhk: new Set(), size: [0, STEPS.size.length - 1], price: [0, STEPS.buy.length - 1],
  amen: new Set(), near: new Set(), ready: false, exact: false, only: false, q: null, sort: 'best',
  list: new Set(store.get(LIST_KEY, [])), sel: null, style: 'night', tilt: false, glow: true, bounds: true, labels: false,
};
let D, byId, matches = [], map, shapes;

/* ---------- data ---------- */
async function load() {
  const [d, sh] = await Promise.all([fetch('data/mumbai.json').then(r => r.json()), fetch('data/mumbai-shapes.geojson').then(r => r.json()).catch(() => ({ type: 'FeatureCollection', features: [] }))]);
  D = d; shapes = sh; byId = new Map(D.societies.map(s => [s.id, s]));
  const hl = location.hash.match(/list=([^&]+)/);
  if (hl) { const ids = decodeURIComponent(hl[1]).split(',').filter(id => byId.has(id)); if (ids.length) { S.list = new Set(ids); S.only = true; $('#f-only').checked = true; saveList(); toast(`Loaded a shared list of ${ids.length}`); } }
}

/* ---------- filtering ---------- */
const range = (key, steps) => { const [a, b] = S[key]; return [steps[a], steps[b]]; };
function overlaps(lo, hi, min, max) {
  if (lo === 0 && hi === Infinity) return true;
  if (min == null && max == null) return false;
  min ??= max; max ??= min;
  return max >= lo && min <= hi;
}
function test(s, skip) {
  if (S.only && !S.list.has(s.id)) return false;
  if (S.q && skip !== 'q') { const { field, value } = S.q; if (field === 'text') { if (!hay(s).includes(value.toLowerCase())) return false; } else if (s[field] !== value) return false; }
  if (skip !== 'kind' && S.kind.size && !S.kind.has(s.kind)) return false;
  if (skip !== 'bhk' && S.bhk.size && !s.bhk.some(b => S.bhk.has(Math.min(b, 5)))) return false;
  const [slo, shi] = range('size', STEPS.size); if (!overlaps(slo, shi, s.size_min, s.size_max)) return false;
  const [plo, phi] = range('price', STEPS[S.mode]);
  if (!(S.mode === 'buy' ? overlaps(plo, phi, s.price_min, s.price_max) : overlaps(plo, phi, s.rent_min, s.rent_max))) return false;
  for (const a of S.amen) if (!s.amenities.includes(a)) return false;
  if (skip !== 'near') for (const n of S.near) if (!(s.near[n] && s.near[n].km <= NEAR[n])) return false;
  if (S.ready && !/ready/i.test(s.status || '')) return false;
  if (S.exact && s.precision !== 'building') return false;
  return true;
}
const hay = s => (s._h ??= `${s.name} ${s.developer || ''} ${s.locality}`.toLowerCase());
function score(s) {
  let x = 0;
  if (s.precision === 'building') x += 2;
  if (s.price_basis === 'listed') x += 2;
  x += Math.min(s.amenities.length, 20) / 10;
  if (s.near.Metro) x += Math.max(0, 2 - s.near.Metro.km);
  if (s.near['Local train']) x += Math.max(0, 1.5 - s.near['Local train'].km);
  x += Math.log10(1 + (s.listings_sale || 0) + (s.listings_rent || 0));
  if (S.list.has(s.id)) x += 5;
  return x;
}
const priceOf = s => S.mode === 'buy' ? s.price_min : s.rent_min;
const SORTS = {
  best: (a, b) => score(b) - score(a),
  price: (a, b) => (priceOf(a) ?? Infinity) - (priceOf(b) ?? Infinity),
  'price-desc': (a, b) => (priceOf(b) ?? -1) - (priceOf(a) ?? -1),
  psf: (a, b) => psf(a) - psf(b),
  metro: (a, b) => (a.near.Metro?.km ?? 99) - (b.near.Metro?.km ?? 99),
  listings: (a, b) => (b.listings_sale + b.listings_rent) - (a.listings_sale + a.listings_rent),
};
const psf = s => s.price_min && s.size_min ? s.price_min / s.size_min : Infinity;

function apply() {
  matches = D.societies.filter(s => test(s)).sort(SORTS[S.sort]);
  const ids = new Set(matches.map(s => s.id));
  $('#count').textContent = matches.length.toLocaleString('en-IN');
  const exact = matches.filter(s => s.precision === 'building').length;
  $('#count-sub').textContent = `of ${D.societies.length.toLocaleString('en-IN')} on the map · ${exact} at exact building location`;
  renderResults(); renderFacetCounts();
  if (map && map.getSource('soc')) { map.getSource('soc').setData(points(ids)); map.getSource('shapes')?.setData(shapeData(ids)); }
}

/* ---------- UI: filters ---------- */
function chipsFor(el, items, set, key) {
  el.replaceChildren(...items.map(([val, label]) => h('button', { 'data-v': val, class: set.has(val) ? 'on' : '', onclick: e => { set.has(val) ? set.delete(val) : set.add(val); e.currentTarget.classList.toggle('on'); apply(); } }, label, h('small', { 'data-c': key }))));
}
function renderFacetCounts() {
  const count = (skip, fn) => D.societies.filter(s => test(s, skip) && fn(s)).length;
  for (const b of $('#f-kind').children) b.querySelector('small').textContent = count('kind', s => s.kind === b.dataset.v) + ' societies';
  for (const b of $('#f-bhk').children) b.querySelector('small').textContent = count('bhk', s => s.bhk.some(x => Math.min(x, 5) === +b.dataset.v));
  for (const b of $('#f-near').children) b.querySelector('small').textContent = count('near', s => s.near[b.dataset.v]?.km <= NEAR[b.dataset.v]);
}
function dual(el, key, steps, fmt, label) {
  el.replaceChildren();
  const max = steps.length - 1;
  const fill = h('div', { class: 'fill' });
  const a = h('input', { type: 'range', min: 0, max, step: 1, value: S[key][0], 'aria-label': 'Minimum' });
  const b = h('input', { type: 'range', min: 0, max, step: 1, value: S[key][1], 'aria-label': 'Maximum' });
  el.append(h('div', { class: 'track' }), fill, a, b);
  const sync = () => {
    let lo = +a.value, hi = +b.value; if (lo > hi) [lo, hi] = [hi, lo];
    S[key] = [lo, hi];
    fill.style.left = (lo / max * 100) + '%'; fill.style.right = (100 - hi / max * 100) + '%';
    const any = lo === 0 && hi === max;
    label.textContent = any ? 'Any' : hi === max ? `${fmt(steps[lo])}+` : lo === 0 ? `up to ${fmt(steps[hi])}` : `${fmt(steps[lo])} – ${fmt(steps[hi])}`;
  };
  a.oninput = b.oninput = () => { sync(); apply(); };
  sync();
}
function buildFilters() {
  const kinds = [...new Set(D.societies.map(s => s.kind))];
  $('#f-kind').replaceChildren(...kinds.map(k => h('button', { 'data-v': k, onclick: e => { S.kind.has(k) ? S.kind.delete(k) : S.kind.add(k); e.currentTarget.classList.toggle('on'); apply(); } }, KIND_LABEL[k] || k, h('small'))));
  chipsFor($('#f-bhk'), [[1, '1 BHK'], [2, '2 BHK'], [3, '3 BHK'], [4, '4 BHK'], [5, '5+ BHK']], S.bhk);
  chipsFor($('#f-near'), Object.entries(NEAR).filter(([n]) => D.landmarks[n]?.length).map(([n, km]) => [n, `${n} ≤ ${km} km`]), S.near);
  const freq = {}; D.societies.forEach(s => s.amenities.forEach(a => freq[a] = (freq[a] || 0) + 1));
  const amen = Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([a]) => a);
  const top = amen.slice(0, 8);
  chipsFor($('#f-amen'), top.map(a => [a, a]), S.amen);
  const list = $('#amen-list');
  const drawList = q => list.replaceChildren(...amen.slice(8).filter(a => a.toLowerCase().includes(q.toLowerCase())).map(a => h('label', { class: 'sw' }, h('input', { type: 'checkbox', checked: S.amen.has(a), onchange: e => { e.target.checked ? S.amen.add(a) : S.amen.delete(a); apply(); } }), `${a} `, h('small', { class: 'fine' }, freq[a]))));
  drawList('');
  $('#amen-q').oninput = e => drawList(e.target.value);
  $('#amen-toggle').hidden = amen.length <= 8;
  $('#amen-toggle').onclick = () => { const m = $('#amen-more'); m.hidden = !m.hidden; $('#amen-toggle').textContent = m.hidden ? 'More amenities' : 'Fewer amenities'; };
  dual($('#f-size'), 'size', STEPS.size, n => n.toLocaleString('en-IN') + ' ft²', $('#v-size'));
  buildPrice();
  for (const b of $('#f-mode').children) b.onclick = () => {
    if (S.mode === b.dataset.m) return;
    S.mode = b.dataset.m; S.price = [0, STEPS[S.mode].length - 1];
    for (const x of $('#f-mode').children) x.classList.toggle('on', x === b);
    buildPrice(); apply(); if (S.sel) openCard(S.sel);
  };
  $('#f-ready').onchange = e => { S.ready = e.target.checked; apply(); };
  $('#f-exact').onchange = e => { S.exact = e.target.checked; apply(); };
  $('#f-only').onchange = e => { S.only = e.target.checked; apply(); };
  $('#f-sort').onchange = e => { S.sort = e.target.value; apply(); };
  $('#preset').onclick = loadPreset;
}
function buildPrice() {
  $('#l-price').textContent = S.mode === 'buy' ? 'Budget' : 'Monthly rent';
  dual($('#f-price'), 'price', STEPS[S.mode], inr, $('#v-price'));
}
function loadPreset() {
  reset();
  S.bhk.add(2); S.bhk.add(3); S.price = [0, STEPS.buy.indexOf(3e7)]; S.near.add('Metro'); S.amen.add('Swimming Pool'); S.amen.add('Gymnasium');
  for (const b of $('#f-bhk').children) b.classList.toggle('on', S.bhk.has(+b.dataset.v));
  for (const b of $('#f-near').children) b.classList.toggle('on', S.near.has(b.dataset.v));
  for (const b of $('#f-amen').children) b.classList.toggle('on', S.amen.has(b.dataset.v));
  buildPrice(); apply(); toast('2–3 BHK under ₹3 Cr near a metro, with pool and gym'); fitMatches();
}
function reset() {
  S.kind.clear(); S.bhk.clear(); S.amen.clear(); S.near.clear(); S.q = null; S.mode = 'buy';
  S.size = [0, STEPS.size.length - 1]; S.price = [0, STEPS.buy.length - 1];
  for (const x of $('#f-mode').children) x.classList.toggle('on', x.dataset.m === 'buy');
  document.querySelectorAll('.chips button.on,.tiles button.on').forEach(b => b.classList.remove('on'));
  dual($('#f-size'), 'size', STEPS.size, n => n.toLocaleString('en-IN') + ' ft²', $('#v-size'));
  renderPill();
}

/* ---------- search ---------- */
function buildSearch() {
  const q = $('#q'), ol = $('#q-results');
  let items = [], idx = 0;
  const choose = it => {
    ol.hidden = true; q.value = '';
    if (it.type === 'society') { openCard(it.s.id, true); return; }
    S.q = it.type === 'text' ? { field: 'text', value: it.label } : { field: it.type, value: it.label };
    renderPill(); apply(); fitMatches();
  };
  const draw = () => ol.replaceChildren(...items.map((it, i) => h('li', { class: i === idx ? 'on' : '', onmousedown: e => { e.preventDefault(); choose(it); } }, it.label, h('small', {}, it.sub))));
  q.oninput = () => {
    const v = q.value.trim().toLowerCase(); idx = 0;
    if (!v) { ol.hidden = true; return; }
    const loc = new Map(), dev = new Map();
    D.societies.forEach(s => { loc.set(s.locality, (loc.get(s.locality) || 0) + 1); if (s.developer) dev.set(s.developer, (dev.get(s.developer) || 0) + 1); });
    const rank = t => { t = t.toLowerCase(); return t.startsWith(v) ? 0 : t.includes(' ' + v) ? 1 : t.includes(v) ? 2 : 9; };
    items = [
      ...[...loc].filter(([l]) => rank(l) < 9).sort((a, b) => rank(a[0]) - rank(b[0])).slice(0, 3).map(([l, n]) => ({ type: 'locality', label: l, sub: `Locality · ${n} societies` })),
      ...[...dev].filter(([l]) => rank(l) < 9).sort((a, b) => rank(a[0]) - rank(b[0])).slice(0, 2).map(([l, n]) => ({ type: 'developer', label: l, sub: `Developer · ${n} societies` })),
      ...D.societies.filter(s => rank(s.name) < 9).sort((a, b) => rank(a.name) - rank(b.name)).slice(0, 7).map(s => ({ type: 'society', s, label: s.name, sub: `${s.locality}${s.developer ? ' · ' + s.developer : ''}` })),
      { type: 'text', label: q.value.trim(), sub: 'Filter by this text' },
    ];
    ol.hidden = false; draw();
  };
  q.onkeydown = e => {
    if (ol.hidden) return;
    if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, items.length - 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { idx = Math.max(idx - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { choose(items[idx]); }
    else if (e.key === 'Escape') { ol.hidden = true; }
  };
  q.onblur = () => setTimeout(() => ol.hidden = true, 100);
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); q.focus(); }
    if (e.key === 'Escape') { closeCard(); document.querySelectorAll('.modal').forEach(m => m.hidden = true); }
  });
}
function renderPill() {
  const p = $('#q-pill');
  p.hidden = !S.q;
  if (S.q) p.replaceChildren(`${S.q.field === 'text' ? 'Text' : S.q.field[0].toUpperCase() + S.q.field.slice(1)}: ${S.q.value}`, h('button', { 'aria-label': 'Clear', onclick: () => { S.q = null; renderPill(); apply(); } }, '×'));
}

/* ---------- results ---------- */
function renderResults() {
  const max = 150;
  const rows = matches.slice(0, max).map(s => {
    const p = S.mode === 'buy' ? [s.price_min, s.price_max] : [s.rent_min, s.rent_max];
    return h('div', { class: 'res' + (S.sel === s.id ? ' on' : ''), onclick: () => openCard(s.id, true), onmouseenter: () => hover(s.id), onmouseleave: () => hover(null) },
      h('b', {}, S.list.has(s.id) ? h('span', { class: 'star' }, '★ ') : null, s.name),
      h('span', { class: 'p' }, p[0] ? `${inr(p[0])}${p[1] && p[1] !== p[0] ? '–' + inr(p[1]).replace('₹', '') : ''}${S.mode === 'rent' ? '/mo' : ''}` : '—'),
      h('small', {}, `${s.locality}${s.bhk.length ? ' · ' + s.bhk.join(', ') + ' BHK' : ''}`),
      h('small', { class: 'p' }, s.near.Metro && s.near.Metro.km < 2 ? `Metro ${s.near.Metro.km} km` : s.status || ''));
  });
  $('#results').replaceChildren(...rows, matches.length > max ? h('div', { class: 'res-more' }, `+ ${matches.length - max} more on the map. Narrow the filters to list them.`) : null);
}

/* ---------- card ---------- */
function openCard(id, fly) {
  const s = byId.get(id); if (!s) return;
  S.sel = id; const c = $('#card'); c.hidden = false; $('#mt-society').disabled = false;
  const buy = s.price_min ? `${inr(s.price_min)} – ${inr(s.price_max)}` : 'Price on request';
  const rent = s.rent_min ? `${inr(s.rent_min)} – ${inr(s.rent_max)}` : '—';
  const psfv = psf(s);
  c.replaceChildren(
    h('button', { class: 'iconbtn close', 'aria-label': 'Close', onclick: closeCard }, '×'),
    h('div', { class: 'k' }, `${KIND_LABEL[s.kind] || s.kind} · ${s.locality}`),
    h('h2', {}, s.name),
    h('div', { class: 'sub' }, [s.developer, s.status, s.possession && `Possession ${s.possession}`].filter(Boolean).join(' · ')),
    h('div', { class: 'row-gap' },
      s.precision === 'building' ? h('span', { class: 'badge' }, 'Exact location') : h('span', { class: 'badge warn', title: 'Not found as a building on OpenStreetMap. Pin sits at the locality centre.' }, 'Approx. location'),
      s.price_basis === 'indicative' ? h('span', { class: 'badge warn', title: 'From the curated seed list, not a live listing. Check the live links below.' }, 'Indicative prices') : h('span', { class: 'badge' }, 'Listed prices'),
      s.rera_id ? h('span', { class: 'badge' }, `RERA ${s.rera_id}`) : null),
    h('div', { class: 'grid' },
      h('div', { style: S.mode === 'buy' ? 'border-color:color-mix(in srgb,var(--accent) 50%,transparent)' : '' }, h('span', { class: 'k' }, 'Buy'), h('b', {}, buy)),
      h('div', { style: S.mode === 'rent' ? 'border-color:color-mix(in srgb,var(--accent) 50%,transparent)' : '' }, h('span', { class: 'k' }, s.rent_estimated ? 'Rent (est.)' : 'Rent / month'), h('b', {}, rent)),
      h('div', {}, h('span', { class: 'k' }, 'Home size'), h('b', {}, s.size_min ? `${sqft(s.size_min).replace(' sq ft', '')} – ${sqft(s.size_max)}` : '—')),
      h('div', {}, h('span', { class: 'k' }, 'Per sq ft'), h('b', {}, isFinite(psfv) ? `₹${Math.round(psfv).toLocaleString('en-IN')}` : '—')),
      h('div', {}, h('span', { class: 'k' }, 'BHK'), h('b', {}, s.bhk.length ? s.bhk.join(', ') : '—')),
      h('div', {}, h('span', { class: 'k' }, 'Listings'), h('b', {}, s.listings_sale || s.listings_rent ? `${s.listings_sale} sale · ${s.listings_rent} rent` : 'See live'))),
    h('div', { class: 'k' }, 'Live listings now'),
    h('div', { class: 'live' }, ...Object.entries(s.links).map(([name, url]) => h('a', { href: url, target: '_blank', rel: 'noopener' }, name))),
    Object.keys(s.near).length ? h('div', { class: 'k' }, 'Nearby') : null,
    h('div', { class: 'near' }, ...Object.entries(s.near).flatMap(([cat, n]) => [h('span', { class: 'fine' }, cat), h('span', {}, n.name.replace(' railway station', '')), h('span', {}, `${n.km} km`)])),
    s.amenities.length ? h('div', { class: 'k' }, `Amenities · ${s.amenities.length}`) : null,
    h('div', { class: 'tags' }, ...s.amenities.map(a => h('span', {}, a))),
    h('div', { class: 'actions' },
      h('button', { class: S.list.has(id) ? 'ghost' : 'primary', onclick: () => { toggleList(id); openCard(id); } }, S.list.has(id) ? '★ In my list' : '☆ Add to my list'),
      h('a', { class: 'ghost', style: 'text-decoration:none;color:var(--text)', href: `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`, target: '_blank', rel: 'noopener' }, 'Directions')),
    h('div', { class: 'fine' }, 'Sources: ', ...s.sources.flatMap((x, i) => [i ? ', ' : '', x.url ? h('a', { href: x.url, target: '_blank', rel: 'noopener' }, x.name) : x.name]), s.fetched_at ? ` · fetched ${new Date(s.fetched_at).toLocaleDateString('en-IN')}` : ''),
  );
  c.scrollTop = 0;
  if (fly && map) map.flyTo({ center: [s.lng, s.lat], zoom: Math.max(map.getZoom(), 15), speed: 1.4, offset: window.innerWidth > 900 ? [-120, 0] : [0, -80] });
  if (map?.getSource('sel')) map.getSource('sel').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lng, s.lat] }, properties: {} }] });
  renderResults(); mtab('society');
}
function closeCard() {
  S.sel = null; $('#card').hidden = true; $('#mt-society').disabled = true;
  map?.getSource('sel')?.setData({ type: 'FeatureCollection', features: [] }); renderResults(); mtab('search');
}

/* ---------- my list ---------- */
const saveList = () => { store.set(LIST_KEY, [...S.list]); $('#v-list').textContent = S.list.size ? `${S.list.size} saved` : 'empty'; };
function toggleList(id) { S.list.has(id) ? S.list.delete(id) : S.list.add(id); saveList(); apply(); }
function bigrams(s) { s = s.toLowerCase().replace(/[^a-z0-9]/g, ''); const b = new Set(); for (let i = 0; i < s.length - 1; i++) b.add(s.slice(i, i + 2)); return b; }
function dice(a, b) { const A = bigrams(a), B = bigrams(b); let n = 0; A.forEach(x => B.has(x) && n++); return 2 * n / (A.size + B.size || 1); }
function buildList() {
  saveList();
  $('#btn-paste').onclick = () => { $('#paste').hidden = false; $('#paste-text').focus(); };
  $('#paste-cancel').onclick = () => $('#paste').hidden = true;
  $('#paste-clear').onclick = () => { S.list.clear(); saveList(); apply(); $('#paste-result').textContent = 'List cleared.'; };
  $('#paste-add').onclick = () => {
    const names = $('#paste-text').value.split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
    const out = names.map(n => { let best = null, bs = 0; for (const s of D.societies) { const sc = Math.max(dice(n, s.name), dice(n, s.name + ' ' + s.locality)); if (sc > bs) { bs = sc; best = s; } } return { n, s: bs > 0.45 ? best : null }; });
    out.forEach(o => o.s && S.list.add(o.s.id)); saveList(); apply();
    $('#paste-result').replaceChildren(...out.map(o => h('div', {}, o.s ? `✓ ${o.n} → ${o.s.name}, ${o.s.locality}` : `✗ ${o.n}: no close match`)));
  };
  $('#btn-share').onclick = async () => {
    if (!S.list.size) return toast('Add societies to your list first');
    const url = `${location.origin}${location.pathname}#list=${encodeURIComponent([...S.list].join(','))}`;
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link', url); }
  };
}

/* ---------- map ---------- */
function points(ids) {
  return { type: 'FeatureCollection', features: D.societies.map(s => ({ type: 'Feature', id: s.id, geometry: { type: 'Point', coordinates: [s.lng, s.lat] }, properties: { id: s.id, name: s.name, m: ids.has(s.id) ? 1 : 0, l: S.list.has(s.id) ? 1 : 0, x: s.precision === 'building' ? 1 : 0 } })) };
}
function shapeData(ids) {
  return { type: 'FeatureCollection', features: shapes.features.map(f => ({ ...f, properties: { ...f.properties, m: ids.has(f.properties.id) ? 1 : 0 } })) };
}
function nightify() {
  if (S.style !== 'night') return;
  for (const l of map.getStyle().layers) {
    try {
      if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', '#050506');
      else if (l.type === 'fill') map.setPaintProperty(l.id, 'fill-opacity', /water/.test(l.id) ? 1 : 0.35);
      else if (l.type === 'line') map.setPaintProperty(l.id, 'line-opacity', /road|highway|street|transport/.test(l.id) ? 0.35 : 0.2);
      else if (l.type === 'symbol') map.setPaintProperty(l.id, 'text-opacity', /place|water/.test(l.id) ? 0.55 : 0.0);
      if (/water/.test(l.id) && l.type === 'fill') map.setPaintProperty(l.id, 'fill-color', '#07090d');
    } catch {}
  }
}
function addLayers() {
  const ids = new Set(matches.map(s => s.id));
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ffd9a0';
  const dim = S.style === 'light' ? '#8a8780' : '#5d5b57';
  map.addSource('soc', { type: 'geojson', data: points(ids) });
  map.addSource('shapes', { type: 'geojson', data: shapeData(ids) });
  map.addSource('sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'shape-3d', type: 'fill-extrusion', source: 'shapes', layout: { visibility: S.tilt && S.bounds ? 'visible' : 'none' }, paint: { 'fill-extrusion-color': ['case', ['==', ['get', 'm'], 1], accent, dim], 'fill-extrusion-height': 90, 'fill-extrusion-opacity': 0.75 } });
  map.addLayer({ id: 'shape-line', type: 'line', source: 'shapes', minzoom: 13, layout: { visibility: S.bounds ? 'visible' : 'none' }, paint: { 'line-color': ['case', ['==', ['get', 'm'], 1], accent, dim], 'line-width': 1.2, 'line-opacity': 0.8 } });
  map.addLayer({ id: 'soc-glow', type: 'circle', source: 'soc', filter: ['==', ['get', 'm'], 1], layout: { visibility: S.glow ? 'visible' : 'none' }, paint: { 'circle-color': accent, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 9, 14, 22], 'circle-blur': 1, 'circle-opacity': S.style === 'light' ? 0.25 : 0.45 } });
  map.addLayer({ id: 'soc-dim', type: 'circle', source: 'soc', filter: ['==', ['get', 'm'], 0], paint: { 'circle-color': dim, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1.6, 14, 4], 'circle-opacity': 0.7 } });
  map.addLayer({ id: 'soc-dot', type: 'circle', source: 'soc', filter: ['==', ['get', 'm'], 1], paint: { 'circle-color': accent, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 14, 7], 'circle-stroke-color': ['case', ['==', ['get', 'l'], 1], '#ffffff', 'rgba(0,0,0,0)'], 'circle-stroke-width': 1.5, 'circle-opacity': ['case', ['==', ['get', 'x'], 1], 1, 0.75] } });
  map.addLayer({ id: 'soc-sel', type: 'circle', source: 'sel', paint: { 'circle-radius': 14, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': accent, 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'soc-label', type: 'symbol', source: 'soc', filter: ['==', ['get', 'm'], 1], minzoom: 11, layout: { visibility: S.labels ? 'visible' : 'none', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': S.style === 'light' ? '#222' : '#f2f0ec', 'text-halo-color': S.style === 'light' ? '#fff' : '#000', 'text-halo-width': 1.2 } });
  if (S.sel) { const s = byId.get(S.sel); map.getSource('sel').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lng, s.lat] }, properties: {} }] }); }
}
let popup;
function hover(id) {
  if (!map) return;
  popup?.remove(); if (!id) return;
  const s = byId.get(id);
  popup = new maplibregl.Popup({ closeButton: false, className: 'popup', offset: 10 }).setLngLat([s.lng, s.lat]).setDOMContent(h('div', {}, h('b', {}, s.name), h('br'), h('small', {}, `${s.locality} · ${S.mode === 'buy' ? inr(s.price_min) : inr(s.rent_min) + '/mo'}`))).addTo(map);
}
function setStyle(mode) {
  S.style = mode;
  document.querySelectorAll('.layer-menu [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  map.setStyle(STYLES[mode]);
  map.once('style.load', () => { nightify(); addLayers(); });
}
function fitMatches() {
  if (!map || !matches.length) return;
  const b = new maplibregl.LngLatBounds();
  matches.forEach(s => b.extend([s.lng, s.lat]));
  const wide = window.innerWidth > 900;
  map.fitBounds(b, { padding: wide ? { left: 380, right: 460, top: 80, bottom: 60 } : { top: 60, bottom: window.innerHeight * 0.5, left: 30, right: 30 }, maxZoom: 15, duration: 900 });
}
function buildMap() {
  map = new maplibregl.Map({ container: 'map', style: STYLES.night, center: D.city.center, zoom: D.city.zoom, attributionControl: { compact: true }, maxPitch: 70, dragRotate: true });
  map.on('style.load', function first() { map.off('style.load', first); nightify(); addLayers(); });
  for (const l of ['soc-dot', 'soc-dim']) {
    map.on('click', l, e => openCard(e.features[0].properties.id, true));
    map.on('mouseenter', l, e => { map.getCanvas().style.cursor = 'pointer'; hover(e.features[0].properties.id); });
    map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; hover(null); });
  }
  $('#ctl-in').onclick = () => map.zoomIn();
  $('#ctl-out').onclick = () => map.zoomOut();
  $('#ctl-home').onclick = () => map.flyTo({ center: D.city.center, zoom: D.city.zoom, pitch: S.tilt ? 55 : 0, bearing: 0 });
  $('#ctl-tilt').onclick = () => {
    S.tilt = !S.tilt; $('#ctl-tilt').textContent = S.tilt ? '2D' : '3D';
    map.easeTo({ pitch: S.tilt ? 55 : 0, bearing: S.tilt ? -18 : 0, zoom: S.tilt ? Math.max(map.getZoom(), 13) : map.getZoom() });
    if (map.getLayer('shape-3d')) map.setLayoutProperty('shape-3d', 'visibility', S.tilt && S.bounds ? 'visible' : 'none');
  };
  $('#ctl-locate').onclick = () => {
    if (!navigator.geolocation) return toast('Location is not available');
    navigator.geolocation.getCurrentPosition(p => {
      const ll = [p.coords.longitude, p.coords.latitude];
      new maplibregl.Marker({ color: '#7fb3ff' }).setLngLat(ll).addTo(map); map.flyTo({ center: ll, zoom: 14 });
    }, () => toast('Could not get your location'));
  };
  $('#layers-btn').onclick = () => $('#layers').classList.toggle('open');
  document.querySelectorAll('.layer-menu [data-mode]').forEach(b => { b.classList.toggle('on', b.dataset.mode === S.style); b.onclick = () => setStyle(b.dataset.mode); });
  const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  $('#hl-glow').onchange = e => { S.glow = e.target.checked; vis('soc-glow', S.glow); };
  $('#hl-bounds').onchange = e => { S.bounds = e.target.checked; vis('shape-line', S.bounds); vis('shape-3d', S.bounds && S.tilt); };
  $('#hl-labels').onchange = e => { S.labels = e.target.checked; vis('soc-label', S.labels); };
}

/* ---------- research log ---------- */
function buildLog() {
  const feed = $('#feed'), evs = D.events;
  let i = 0;
  const row = e => { const s = byId.get(e.sid); return h('div', { class: 'ev' }, h('span', { class: 't' }, e.step), h('span', { class: 'who', onclick: () => openCard(e.sid, true) }, s ? s.name : e.sid), h('span', {}, e.finding, e.url ? ' ' : '', e.url ? h('a', { href: e.url, target: '_blank', rel: 'noopener' }, 'source ↗') : null)); };
  const tick = () => {
    if (i >= evs.length) { $('#log-mode').textContent = `${evs.length.toLocaleString('en-IN')} steps · ${new Date(D.generated_at).toLocaleDateString('en-IN')}`; return; }
    const n = Math.max(1, Math.round(evs.length / 400));
    for (let k = 0; k < n && i < evs.length; k++) feed.prepend(row(evs[i++]));
    while (feed.children.length > 250) feed.lastChild.remove();
    $('#log-mode').textContent = `replay ${Math.round(i / evs.length * 100)}%`;
    setTimeout(tick, 45);
  };
  tick();
  const toggle = on => { $('#log').classList.toggle('off', !on); document.body.classList.toggle('nolog', !on); $('#btn-log').classList.toggle('on', on); store.set('ff-log', on); };
  toggle(store.get('ff-log', window.innerWidth > 1200));
  $('#btn-log').onclick = () => toggle($('#log').classList.contains('off'));
  $('#log-close').onclick = () => toggle(false);
}

/* ---------- tour, guide, theme, misc ---------- */
let touring = null;
function tour() {
  if (touring) { clearTimeout(touring); touring = null; $('#btn-tour').classList.remove('on'); $('#btn-tour').textContent = 'Tour'; return; }
  const list = matches.slice(0, 12); if (!list.length) return toast('No matches to tour');
  let i = 0; $('#btn-tour').classList.add('on'); $('#btn-tour').textContent = 'Stop tour';
  const step = () => { if (i >= list.length) return tour(); const s = list[i++]; openCard(s.id); map.flyTo({ center: [s.lng, s.lat], zoom: 15.5, pitch: 55, bearing: (i * 37) % 360 - 180, speed: 0.8, offset: window.innerWidth > 900 ? [-120, 0] : [0, -80] }); touring = setTimeout(step, 4200); };
  step();
}
const GUIDE = [
  ['Every society in Mumbai, on one map', 'Each dot is a housing society or project across the Mumbai region, from Colaba to Virar and Navi Mumbai. Bright dots match your filters. Dim ones don\'t.'],
  ['Filter by what you can live with', 'Pick Buy or Rent, then BHK, home size and budget. Add amenities and what you want nearby (metro, local train, business districts, the sea). The count updates as you go.'],
  ['Then go live', 'Open a society to see prices, sizes, commute distances and amenities. "Live listings now" opens the current listings for that society on 99acres, Housing.com, Magicbricks, NoBroker and PROPi.'],
  ['Keep a shortlist', 'Star societies, or paste a list of names you got from a broker. Share the list as a link, or download everything as CSV.'],
];
function guide() {
  let i = 0; const m = $('#onboard'); m.hidden = false;
  const draw = () => {
    $('#ob-steps').replaceChildren(...GUIDE.map((_, k) => h('i', { class: k <= i ? 'on' : '' })));
    $('#ob-body').replaceChildren(h('h3', {}, GUIDE[i][0]), h('p', {}, GUIDE[i][1]));
    $('#ob-back').style.visibility = i ? 'visible' : 'hidden'; $('#ob-next').textContent = i === GUIDE.length - 1 ? 'Start' : 'Next';
  };
  const done = () => { m.hidden = true; store.set('ff-guided', 1); };
  $('#ob-next').onclick = () => i === GUIDE.length - 1 ? done() : (i++, draw());
  $('#ob-back').onclick = () => { i = Math.max(0, i - 1); draw(); };
  $('#ob-skip').onclick = done;
  draw();
}
function theme() {
  const light = document.documentElement.dataset.theme !== 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  store.set('ff-theme', light ? 'light' : 'dark');
  setStyle(light ? 'light' : 'night');
}
function mtab(t) {
  if (window.innerWidth > 900) return;
  document.querySelectorAll('#mtabs [data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  $('#card').style.display = t === 'society' && S.sel ? '' : 'none';
}
function downloads() {
  $('#dl-results').onclick = () => {
    const cols = ['name', 'developer', 'locality', 'status', 'bhk', 'size_min', 'size_max', 'price_min', 'price_max', 'rent_min', 'rent_max', 'lat', 'lng'];
    const esc = v => { v = v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    const csv = [cols.concat('metro_km', 'link_99acres', 'link_housing', 'link_magicbricks').join(','), ...matches.map(s => cols.map(c => esc(s[c])).concat(s.near.Metro?.km ?? '', esc(s.links['99acres']), esc(s.links['Housing.com']), esc(s.links.Magicbricks)).join(','))].join('\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'mumbai-flat-finder-results.csv' }); a.click();
  };
  const when = new Date(D.generated_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  $('#about').replaceChildren(
    `Data refreshed ${when}. `, D.seed ? 'Prices on this build come from a curated seed list and are indicative. The data pipeline replaces them with listed prices from Magicbricks. ' : `Prices are listed prices from ${D.sources.filter(x => !/OpenStreetMap/.test(x)).join(', ')}. `,
    'Rents marked "est." assume a ', `${(D.city_yield * 100).toFixed(1)}% gross yield. `,
    'Live listing links open the portals\' own current results. Map © OpenStreetMap contributors, tiles by OpenFreeMap.');
}

async function main() {
  if (store.get('ff-theme') === 'light') { document.documentElement.dataset.theme = 'light'; S.style = 'light'; }
  await load();
  buildFilters(); buildSearch(); buildList(); downloads();
  apply();
  buildMap(); if (S.style === 'light') map.once('load', () => setStyle('light'));
  buildLog();
  $('#btn-guide').onclick = guide; $('#btn-tour').onclick = tour; $('#btn-theme').onclick = theme;
  $('#btn-hide').onclick = () => { document.body.classList.toggle('hidepanels'); $('#btn-hide').textContent = document.body.classList.contains('hidepanels') ? 'Show panels' : 'Hide panels'; };
  document.querySelectorAll('#mtabs [data-t]').forEach(b => b.onclick = () => mtab(b.dataset.t));
  $('#m-collapse').onclick = () => document.body.classList.toggle('mcollapsed');
  if (!store.get('ff-guided')) guide();
}
main().catch(e => { console.error(e); document.body.append(h('div', { class: 'toast' }, 'Could not load data: ' + e.message)); });
