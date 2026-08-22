# Election Map — 2026 Senate Tracker

A static page showing Kalshi prediction-market odds for the 2026 U.S. Senate races: chamber-control gauge, a 100-seat spectrum bar, and a state-level choropleth map.

## Layout

```
design_handoff_senate_tracker/   design reference (spec + prototype, not shipped code — see its own README)
scripts/
  event_ticker_map.json          event_ticker -> { state, raceType }, checked-in, changes rarely
  build_live_data.py             transform: latest_kalshi_discovery.json -> web/live-senate-data.json
latest_kalshi_discovery.json     raw Kalshi discovery dump the fetch script is expected to keep updated
web/                             the published site (static, no build step)
  index.html / app.js / map.js / senate-shared.js
  vendor/                        d3, topojson-client, us-atlas topology (vendored, no CDN)
  live-senate-data.json          generated artifact, fetched by the page at runtime
```

## UI

Three components on one page, ported from `design_handoff_senate_tracker`'s design spec to plain JS + d3 (no framework, no bundler — matches the rest of this repo):

- **Chamber control gauge** — a two-segment bar showing market-implied Democratic vs. Republican probability of Senate control.
- **Seat spectrum bar** — all 100 seats on one axis: the 65 seats not up in 2026 collapsed into two solid blocks at each end, the 35 contested races in between sorted by Democratic win probability, with a majority line at the 50/51-seat boundary. Switches between a wide (≥720px) and narrow (<720px) layout via a CSS media query.
- **State map** — a US choropleth (d3-geo + topojson, Albers USA projection) showing combined per-state control, with diagonal stripes marking a split delegation or a toss-up race.

Both the spectrum bar and the map show tooltips on hover (candidate names, odds, "(primary TBD)" markers where a party's primary hasn't resolved yet, independent candidates polling above 10%). Colors, spacing, and thresholds follow `design_handoff_senate_tracker/README.md`'s design tokens.

`app.js` fetches `live-senate-data.json` on load; the page shows a loading state until that resolves and an error state if the fetch fails.

## Rebuild logic

`web/live-senate-data.json` is a generated artifact, not hand-edited. To refresh it:

1. Something keeps `latest_kalshi_discovery.json` up to date with a fresh pull from Kalshi (same shape as the historical `kalshi_discovery_*_results.json` dumps: a dict of `event_ticker` → raw market objects). That part isn't owned by this repo's web layer — see `script.py`.
2. Run `python3 scripts/build_live_data.py`. It reads `latest_kalshi_discovery.json` plus the checked-in `scripts/event_ticker_map.json`, normalizes each race's outcome prices to sum to 1.0, derives `demPrimaryPending`/`repPrimaryPending` per race, and writes `web/live-senate-data.json`. If a race's data is missing or unusable, it carries forward that race's last-known-good values from the previous `live-senate-data.json` (flagged `stale`/`staleSince`) rather than ever showing 0% — and lists the state in `failedStates`.
3. Nothing else needs to change — `web/`'s HTML/CSS/JS never touch the data pipeline. Serve `web/` as a static directory (any static host works; no build step) and each run of step 2 is the only thing that needs to happen to pick up new odds.

Run it locally with e.g. `python3 -m http.server` from inside `web/`.
