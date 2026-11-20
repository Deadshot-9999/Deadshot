# Flat Finder · Mumbai

Every housing society in Mumbai on one night map. Filter by BHK, buy or rent budget, home size,
amenities and what is nearby (metro, local train, business districts, hospitals, the sea), then
jump straight to the **live listings** for that society on 99acres, Housing.com, Magicbricks,
NoBroker and PROPi.

A Mumbai take on [flat-finder.pages.dev](https://flat-finder.pages.dev/) (Gurugram).

## What's in it

- MapLibre map with OpenFreeMap tiles: Night / Dark / Day styles, glow, building outlines, names, 2D/3D, locate, fly-to
- Filters: Buy/Rent, type, BHK, home size, budget (switches to monthly rent), amenities, nearby, ready to move, exact location only
- Live count with facet counts, sortable results (best match, price, ₹/sq ft, closest to metro, most listings)
- Society card: buy and rent ranges, ₹/sq ft, sizes, BHK, RERA, commute distances, amenities, sources, **live listing links**
- My list: star societies, paste names from a broker (fuzzy matched), share as a link
- Research log replay that shows where every data point came from
- Guided intro, fly-through tour, CSV downloads, light/dark, mobile layout

## Run locally

```bash
npm run serve          # http://localhost:5173
```

## Data

`public/data/mumbai.json` is built by `pipeline/build.mjs`:

1. **Source adapters** in `pipeline/sources/` write `pipeline/raw/<source>.json`.
   - `magicbricks.mjs`: opens the public "New Projects in Mumbai" pages in Chromium and keeps the project JSON the page loads (~3,700 Mumbai projects).
2. **Build** merges projects across sources, geocodes each one with OpenStreetMap Nominatim (building first, then locality, cached in `pipeline/.cache`), pulls building outlines, computes distance to metro/rail/airport/business districts/hospitals/sea, and writes the JSON, GeoJSON and CSV.
3. With no raw files present, the build falls back to `pipeline/seed-projects.json`, a curated list of 81 well-known projects with **indicative** prices (shown with an "Indicative prices" badge).

```bash
npm install
npx playwright install chromium
npm run refresh        # fetch Magicbricks, then rebuild public/data
```

If the adapter captures nothing, run `node pipeline/sources/magicbricks.mjs --headed --inspect` to see the raw record shape and adjust the field mapping in `normalize()`.

### Live data, honestly

- **99acres and Housing.com** block automated access from cloud servers (Akamai / bot protection), and they publish no public API. The site doesn't scrape them. Each society card links straight into their live search for that society instead, so you always see their current listings.
- **Magicbricks** is fetched by the adapter. `.github/workflows/refresh-data.yml` re-runs it every 6 hours and commits fresh data. Cloudflare Pages redeploys on each commit.
- **PROPi** is a broker network behind a login. It's linked, not scraped.
- Respect each site's terms of use. Keep request rates low (the adapter waits between pages).

## Deploy (Cloudflare Pages)

Connect the repo, set **build command** to none and **output directory** to `public`.
