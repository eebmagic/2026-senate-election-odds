# Election Map — 2026 Senate Tracker

A static page showing Kalshi prediction-market odds for the 2026 U.S. Senate races: chamber-control gauge, a 100-seat spectrum bar, and a state-level choropleth map.

## Layout

```
script.py                        fetches Kalshi + writes web/live-senate-data.json (see "Rebuild logic")
scripts/
  event_ticker_map.json          event_ticker -> { state, raceType }, checked-in, changes rarely
  build_live_data.py             the transform script.py calls: raw discovery dict -> live-senate-data.json shape
  build_state_topology.sh        regenerates web/vendor/us-states-simplified.json from us-atlas (run rarely)
live_data_snapshots/             tracked per-run audit trail written by script.py, newest N kept (see --keep-snapshots)
web/                             the published site (static, no build step)
  index.html / app.js / map.js / senate-shared.js
  vendor/                        d3, topojson-client, us-states-simplified.json (simplified us-atlas topology; see scripts/build_state_topology.sh)
  live-senate-data.json          generated artifact, fetched by the page at runtime
```

## UI

Three components on one page, in plain JS + d3 (no framework, no bundler — matches the rest of this repo):

- **Chamber control gauge** — a two-segment bar showing market-implied Democratic vs. Republican probability of Senate control.
- **Seat spectrum bar** — all 100 seats on one axis: the 65 seats not up in 2026 collapsed into two solid blocks at each end, the 35 contested races in between sorted by Democratic win probability, with a majority line at the 50/51-seat boundary. Switches between a wide (≥720px) and narrow (<720px) layout via a CSS media query.
- **State map** — a US choropleth (d3-geo + topojson, Albers USA projection) showing combined per-state control, with diagonal stripes marking a split delegation or a toss-up race.

Both the spectrum bar and the map show tooltips on hover (candidate names, odds, "(primary TBD)" markers where a party's primary hasn't resolved yet, independent candidates polling above 10%). Colors, spacing, and thresholds are defined in `web/senate-shared.js` (`COLORS`, `TOSSUP_LOW`/`TOSSUP_HIGH`, `STRONG_LEAN`).

Every contested-race segment in the spectrum bar (wide and narrow layouts alike) links out to that race's actual Kalshi market page. On desktop, hover previews the tooltip and a click opens the link in a new tab. On touch devices (detected via `(hover: none), (pointer: coarse)`) there's no hover, so the first tap on a segment shows the preview instead of navigating; a second tap on that same segment follows the link. Tapping elsewhere dismisses the open preview. The solid D/R blocks aren't linked — no single market backs an aggregate of 34/31 seats.

`app.js` fetches `live-senate-data.json` on load; the page shows a loading state until that resolves and an error state if the fetch fails.

## Rebuild logic

`web/live-senate-data.json` is a generated artifact, not hand-edited. To refresh it, run `python3 script.py`. It:

1. Fetches every 2026 Senate race's markets from Kalshi (event tickers read from the checked-in `scripts/event_ticker_map.json`, so the fetch list and the transform step can't drift apart) plus the `CONTROLS-2026` chamber-control market, retrying on rate limits/5xx/network errors.
2. Transforms the result in-memory via `scripts/build_live_data.build()`: normalizes each race's outcome prices to sum to 1.0, derives `demPrimaryPending`/`repPrimaryPending` per race, and computes each race's `kalshiUrl` (`https://kalshi.com/markets/{series}/{event}`, series being the event ticker with its trailing `-XX` stripped — verified live, the human slug segment isn't required for Kalshi's redirect to resolve). Most events price one market per party, so the ticker suffix (`-D`/`-R`) identifies the lane; an event priced per *candidate* instead — Alaska, which has no party primaries at all (see `docs/election-processes.md`) — carries a `candidateParties` map in `scripts/event_ticker_map.json` assigning each real contender to a lane, and candidates at or below 5% are dropped before normalization. If a race's data is missing or unusable, it carries forward that race's last-known-good values from the previous `live-senate-data.json` (flagged `stale`/`staleSince`) rather than ever showing 0% — and lists the state in `failedStates`.
3. Writes a timestamped copy to `live_data_snapshots/` (an audit trail, pruned to the newest 100 by default), then atomically repoints `web/live-senate-data.json` at it — unless more than 25% of tickers failed this run, in which case the snapshot is written but `web/live-senate-data.json` is left on the previous good run (`--force-promote` overrides).

`scripts/build_live_data.py` also runs standalone (`python3 scripts/build_live_data.py --input <dump> --output <out>`) if you ever need to rebuild from a manually saved raw discovery dump.

Nothing else needs to change — `web/`'s HTML/CSS/JS never touch the data pipeline. Serve `web/` as a static directory (any static host works; no build step) and each run of `script.py` is the only thing that needs to happen to pick up new odds.

Run it locally with e.g. `python3 -m http.server` from inside `web/`.
