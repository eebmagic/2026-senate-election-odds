# Election Map — 2026 Senate Tracker

A static page showing Kalshi prediction-market odds for the 2026 U.S. Senate races: chamber-control gauge, a 100-seat spectrum bar, and a state-level choropleth map.

## Layout

```
script.py                        fetches Kalshi + uploads to the R2 bucket (see "Rebuild logic")
scripts/
  event_ticker_map.json          event_ticker -> { state, raceType }, checked-in, changes rarely
  build_live_data.py             the transform script.py calls: raw discovery dict -> live-senate-data.json shape
  r2_store.py                    R2 client used by script.py (latest.json + snapshots/), config from .env
  requirements.txt               script.py's R2 deps (boto3, python-dotenv); build_live_data.py stays stdlib-only
  build_state_topology.sh        regenerates web/vendor/us-states-simplified.json from us-atlas (run rarely)
.env.example                     template for the R2 credentials script.py reads from .env
live_data_snapshots/             tracked per-run audit trail, only written on `script.py --write-local`
web/                             the published site (static, no build step)
  index.html / app.js / map.js / senate-shared.js
  vendor/                        d3, topojson-client, us-states-simplified.json (simplified us-atlas topology; see scripts/build_state_topology.sh)
  live-senate-data.json          stale local build (only written by `script.py --write-local`); the deployed UI reads R2, not this file
```

## UI

Three components on one page, in plain JS + d3 (no framework, no bundler — matches the rest of this repo):

- **Chamber control gauge** — a two-segment bar showing market-implied Democratic vs. Republican probability of Senate control.
- **Seat spectrum bar** — all 100 seats on one axis: the 65 seats not up in 2026 collapsed into two solid blocks at each end, the 35 contested races in between sorted by Democratic win probability, with a majority line at the 50/51-seat boundary. Switches between a wide (≥720px) and narrow (<720px) layout via a CSS media query.
- **State map** — a US choropleth (d3-geo + topojson, Albers USA projection) showing combined per-state control, with diagonal stripes marking a split delegation or a toss-up race.

Both the spectrum bar and the map show tooltips on hover (candidate names, odds, "(primary TBD)" markers where a party's primary hasn't resolved yet, independent candidates polling above 10%). Colors, spacing, and thresholds are defined in `web/senate-shared.js` (`COLORS`, `TOSSUP_LOW`/`TOSSUP_HIGH`, `STRONG_LEAN`).

Every contested-race segment in the spectrum bar (wide and narrow layouts alike) links out to that race's actual Kalshi market page. On desktop, hover previews the tooltip and a click opens the link in a new tab. On touch devices (detected via `(hover: none), (pointer: coarse)`) there's no hover, so the first tap on a segment shows the preview instead of navigating; a second tap on that same segment follows the link. Tapping elsewhere dismisses the open preview. The solid D/R blocks aren't linked — no single market backs an aggregate of 34/31 seats.

`app.js` fetches the live data on load from `LIVE_DATA_URL` (the Cloudflare R2 bucket's public `latest.json`; kept in sync with a `<link rel="preload">` in `index.html`); the page shows a loading state until that resolves and an error state if the fetch fails.

## Rebuild logic

The live data is a generated artifact, not hand-edited. To refresh it, run `python3 script.py` (needs `pip install -r scripts/requirements.txt` and an `.env` — see below). It:

1. Fetches every 2026 Senate race's markets from Kalshi (event tickers read from the checked-in `scripts/event_ticker_map.json`, so the fetch list and the transform step can't drift apart) plus the `CONTROLS-2026` chamber-control market, retrying on rate limits/5xx/network errors.
2. Transforms the result in-memory via `scripts/build_live_data.build()`: normalizes each race's outcome prices to sum to 1.0, derives `demPrimaryPending`/`repPrimaryPending` per race, and computes each race's `kalshiUrl` (`https://kalshi.com/markets/{series}/{event}`, series being the event ticker with its trailing `-XX` stripped — verified live, the human slug segment isn't required for Kalshi's redirect to resolve). Most events price one market per party, so the ticker suffix (`-D`/`-R`) identifies the lane; an event priced per *candidate* instead — Alaska, which has no party primaries at all (see `docs/election-processes.md`) — carries a `candidateParties` map in `scripts/event_ticker_map.json` assigning each real contender to a lane, and candidates at or below 5% are dropped before normalization. If a race's data is missing or unusable, it carries forward that race's last-known-good values from the previous run's `latest.json` (flagged `stale`/`staleSince`) rather than ever showing 0% — and lists the state in `failedStates`. The payload also gets a `snapshotKey` (this run's history key) and `previousSnapshot` (the key of the run it supersedes, from `latest.json`'s `fetchedAt`; `null` on the first run) for future latest-vs-previous diffing.
3. Uploads to the Cloudflare R2 bucket (`election-map`) via `scripts/r2_store.py`: first the immutable history entry `snapshots/<fetchedAt>.json` (ISO-8601 UTC, e.g. `snapshots/2026-09-07T18:30:00Z.json`), then — only if that succeeded — replaces `latest.json` with the same payload. If the history upload fails, `latest.json` is left untouched. If more than 25% of tickers failed this run, the history entry is still uploaded but `latest.json` is left on the previous good run (`--force-promote` overrides).

`script.py --write-local` additionally (or, with no R2 config, solely) writes the old on-disk artifacts: `web/live-senate-data.json` and a timestamped copy under `live_data_snapshots/` (pruned to the newest 100 by `--keep-snapshots`). `scripts/build_live_data.py` also runs standalone (`python3 scripts/build_live_data.py --input <dump> --output <out>`) if you ever need to rebuild from a manually saved raw discovery dump; it's stdlib-only.

### R2 config

Copy `.env.example` to `.env` (gitignored) and fill in an R2 API token (Cloudflare dashboard → R2 → *Manage R2 API Tokens*, Object Read & Write on the `election-map` bucket): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Real environment variables override the file, so CI injects these as secrets directly.

**Public URL:** the UI fetches `latest.json` from a custom domain bound to the bucket, `https://election-data.ebolton.site/latest.json` — set as `LIVE_DATA_URL` in `web/app.js` and preloaded in `web/index.html` (keep the two in sync). History entries live at `<base>/snapshots/<fetchedAt>.json` (the `:` in the timestamp needs percent-encoding as `%3A` in a browser fetch; `latest.json` has no such issue). Set `R2_PUBLIC_BASE_URL` in `.env` and `script.py` prints the resolved URL after each run.

The bucket needs a CORS policy allowing `GET` from the site origin (and `http://localhost:*` for local dev) or the browser blocks the cross-origin fetch — configure it in the dashboard under R2 → the bucket → Settings → CORS Policy.

Run it locally with e.g. `python3 -m http.server` from inside `web/`.
