# Handoff: 2026 Senate Races Tracker

## Overview

A single-page visualization of the state of the 2026 U.S. Senate — all 100 seats — driven by Kalshi prediction-market implied probabilities. Three views on one page:

1. **Chamber control gauge** — market-implied probability of Democratic vs. Republican majority control.
2. **Seat spectrum bar** — all 100 seats on one axis: solid (not-up-in-2026) seats as blocks at each end, the 35 contested races between them sorted by Democratic win probability, with a majority line at the 50/51 seat boundary.
3. **State-level map** — US choropleth of combined per-state delegation control.

Tone is deliberately neutral and data-forward: no editorial framing, no "surge"/"collapse" language.

## About the design files

The files in this bundle are **design references created in HTML** — a working prototype showing intended look, data model, and behavior. They are **not production code to copy directly**.

The task is to **recreate these designs in the target codebase's existing environment** (React, Vue, Svelte, etc.) using its established patterns, component library, and charting conventions. If no environment exists yet, pick an appropriate stack — this design maps naturally onto React + d3 (or React + `react-simple-maps` for the map).

`Senate Tracker.dc.html` is written for a proprietary streaming-component runtime (`support.js`, `<x-dc>`, `{{ }}` template holes, `<sc-for>`/`<sc-if>`). **Do not try to port that runtime.** Read it as a spec: the `<x-dc>` template block is the markup/styling reference, and the `class Component extends DCLogic` block at the bottom is the derivation/layout logic reference (`renderVals()` is effectively a `useMemo` that computes everything the template renders). `support.js` is included only so the prototype opens in a browser; it has no bearing on the implementation.

`data.js` is different — it is **plain, portable ES-module JavaScript** with no runtime dependency. Its color scale, threshold constants, and derivation helpers can be lifted essentially as-is.

## Fidelity

**High fidelity.** Colors, typography, spacing, thresholds, and interaction behavior are final and should be reproduced closely. Exact values are in the Design Tokens section below.

## The main task: hooking this up to a live server

The prototype hardcodes its data as exports in `data.js`. In production, the three data concerns should be split as described in the original brief:

| Concern | Cadence | Where it should live |
|---|---|---|
| 65 seats not up in 2026 (`SOLID_SEATS`) | Static; changes only on appointment/death/resignation | Checked-in config (JSON or DB seed) |
| 35 races + Kalshi tickers | Semi-static; changes when candidates are set | Checked-in config (JSON or DB) |
| Live probabilities per race + chamber control | Nightly | Server-generated artifact the frontend fetches |

### Required backend behavior

- **A nightly cron job** pulls fresh prices from Kalshi and writes a `live-senate-data.json`-shaped artifact. No Kalshi calls from the client — the client only ever reads the generated artifact.
- **Probability derivation**: Kalshi gives a `last_price` per outcome ticker (in cents, or dollars depending on the endpoint). For each race, read the `-D` ticker, the `-R` ticker, and any independent tickers, then **normalize across that race's outcomes so they sum to 1.0**. The prototype's numbers were produced this way from the raw market snapshots.
- **Stale-data fallback is a hard requirement.** If a race's fetch fails (`fetchError` non-null, or the state appears in `failedStates`), the job must carry forward the last-known-good probability for that race. Missing data must **never** be rendered as 0% — that would silently show a race as hopeless. The prototype's `lastSeenProbability` field on `otherTickers` exists for exactly this purpose. Recommended: persist each successful fetch, and on failure emit the previous value plus a `stale: true` / `staleSince` marker so the UI can flag it.
- **Serve `fetchedAt`** (ISO 8601, UTC) with the artifact. The UI displays it so users know the snapshot age. This matters because the data refreshes only once a day.
- Suggested API shape: a single `GET /api/senate-2026` returning `{ fetchedAt, controlsMarket, races, failedStates }` — the exact `live-senate-data.json` schema from the brief. Cache it aggressively (it changes once a day); an ETag or `Last-Modified` is plenty.

### Frontend changes for live data

- Replace the `import('./data.js')` in `componentDidMount` with a fetch of the live endpoint. The component already renders a loading state (`ready: false`) while data is pending — preserve that, and add an error state, which the prototype does not have.
- Merge live probabilities onto the static race config by `state` + `raceType` (a state can have both a regular and a special race in the same cycle — Florida and Ohio do in 2026, so **`state` alone is not a unique key**).
- Consider surfacing per-race staleness in the tooltip when `stale` is true (e.g. "as of Aug 3") — currently the design shows only one global `fetchedAt`.

## Data model

### `SOLID_SEATS[]` — 65 seats not up in 2026
```js
{ state: 'ME', party: 'I', caucus: 'D', senator: 'Angus King' }
```
- `party`: `'D' | 'R' | 'I'`. When `'I'`, `caucus` (`'D' | 'R'`) says which conference they sit with.
- A state appears twice if neither seat is up, once if it has a 2026 race.
- **Independents are resolved to their caucus everywhere in the UI** (`seatPartyResolved()`), keeping both visualizations binary blue/red. This was a deliberate call — a third color for two senators added noise without adding information.
- Current split: **34 D** (incl. King and Sanders caucusing D), **31 R**.

### `RACES[]` — 35 seats up in 2026
```js
{
  state: 'NE', raceType: 'regular',
  demProbability: 0.003, repProbability: 0.718,
  demCandidate: 'Cindy Burbank', repCandidate: 'Pete Ricketts',
  otherTickers: [{ candidate: 'Dan Osborn', affiliation: 'independent', probability: 0.279 }]
}
```
- `raceType`: `'regular' | 'special'`. Specials in 2026: **FL, OH**.
- `otherTickers` present only where a real third candidate exists: **ID, MT, NE**.
- Probabilities are 0–1 floats, market-implied.

### `controlsMarket`
```js
{ eventTicker: 'CONTROLS-2026', demProbability: 0.46, repProbability: 0.54, fetchError: null }
```

## Derivation logic (port this exactly)

```js
TOSSUP_LOW  = 0.40
TOSSUP_HIGH = 0.60

isTossUp(p)              → p > 0.40 && p < 0.60
isMaterialIndependent(r) → r.otherTickers?.some(t => t.probability > 0.10)
seatPartyResolved(seat)  → seat.party === 'I' ? seat.caucus : seat.party
raceLeadParty(r)         → r.demProbability >= 0.50 ? 'D' : 'R'
```

**Pending-primary detection.** Kalshi lists a generic party name as the "candidate" when that party's primary hasn't resolved. The prototype detects this by string match against a placeholder list — `'Democratic Party'`, `'Republican Party'`, `'Democratic (DFL) Party'` — via `isPrimaryPending(name)`, and `raceHasPendingPrimary(r)` is true if either side matches. **This is a fragile heuristic and should be replaced server-side** with an explicit `primaryPending: boolean` (or per-side flags) on each race, derived from the ticker metadata rather than the display string. Races currently affected: AK, DE(R), FL, KS, MA(R), MI, MN, NH, OK, RI(R), SC(R), TN, VA(R), WY.

**Color scale** — continuous blue↔red interpolation on `demProbability`, with **no gray or white midpoint**: a 50/50 race renders purple.
```js
colorForDemProb(p) → lerpRGB('#b3372c', '#2f5aa8', p)   // p=0 → red, p=1 → blue
```
Solid blocks use the endpoints exactly (`#2f5aa8` for D, `#b3372c` for R) so the whole bar reads as one continuous gradient. Equivalent in d3: `d3.scaleLinear().domain([0,1]).range(['#b3372c','#2f5aa8']).interpolate(d3.interpolateRgb)`.

**`buildStateSummaries()`** collapses seats + races into one entry per state for the map: `{ state, status, party, seats, race }` where `status` is `'solid' | 'split' | 'tossup'`. A state is `tossup` if it has a 2026 race inside the toss-up band; `split` if its two seats resolve to different parties; otherwise `solid` with a `party`.

## Component 1: Chamber control gauge

- Section heading "Chamber control", 15px/700.
- Bar: 60px tall, full width, `border-radius: 6px`, `overflow: hidden`, `box-shadow: inset 0 0 0 1px #e2ded5`, `margin-top: 8px`.
- Two flex children sized by percentage: D segment `#2f5aa8` with label left-aligned (`padding-left: 18px`), R segment `#b3372c` with label right-aligned (`padding-right: 18px`). Labels are white, 15px/700, `white-space: nowrap`, reading "Democratic 46%" / "Republican 54%".
- **50% divider**: 2px wide, `#211f1c`, absolutely positioned at `left: 50%` with `transform: translateX(-1px)`, extending **8px above and below** the bar (`top: -8px; bottom: -8px`). `pointer-events: none`.
- Caption below, 12px `#5b574f`: "Market-implied probability of majority control after the 2026 elections, from Kalshi's CONTROLS-2026 event."

## Component 2: Seat spectrum bar

Two layouts, switched at a **720px viewport breakpoint** (`window.innerWidth < 720`, re-evaluated on `resize`). The prototype does this in JS because it needs the orientation in the data layer; in production a CSS media query plus a container query is cleaner if the tooltip math allows it.

### Header row
- Left: "All 100 seats", 15px/700. Right: "65 not up in 2026 · 35 contested, sorted by Democratic win probability", 12px `#5b574f`. `flex-wrap: wrap`, `gap: 8px`.

### Wide layout (≥720px)
- Container: `position: relative`, 108px tall, `padding-top: 20px` reserving a label row.
- Bar itself: 88px tall, `display: flex`, `border-radius: 4px`, `overflow: hidden`.
- **Three children, flex-weighted** (this is what makes the state labels fit — the 65 solid seats are collapsed into two blocks instead of 65 slivers):
  - D solid block: `flex: 34 1 0%`, `#2f5aa8`
  - contested wrapper: `flex: 130 1 0%`, `border-left: 1px solid rgba(250,248,244,0.5)`, `box-sizing: border-box`
  - R solid block: `flex: 31 1 0%`, `#b3372c`
  - The contested block is given **130 units for 35 seats** — a deliberate ~3.7× exaggeration of its true share. It is the informative part of the chart; giving it proportional width made the labels illegible. Preserve this weighting (`CONTESTED_UNITS = 130`).
- **Contested segments**: each `flex: 1 1 0%`, `border-right: 1px solid rgba(250,248,244,0.5)`, `box-sizing: border-box`, background from the color scale, text `#000`.
  - Label stack is **absolutely positioned** at `top: 50%; left: 50%; transform: translate(-50%, -50%)`, `display: flex; flex-direction: column; align-items: center; gap: 2px; width: 100%`. Three lines, all `text-align: center`: state code (11px/700, `letter-spacing: 0.02em`), rounded leading percentage as a **bare number, no `%` sign** (9px/600), leading party letter (8px/700, `opacity: 0.85`).
  - **Important implementation note:** the independent and pending-primary markers must be **absolutely-positioned overlay spans, not borders.** They were originally `border-top`/`border-bottom`, which shrank the content box and made the centered label visibly off-center. Use `position: absolute` overlays that don't affect layout.
    - Independent marker: `top: 0; left: 0; right: 0; height: 3px; background: #c98a2c`
    - Pending-primary marker: `bottom: 0; left: 0; right: 0; height: 5px; background: #faf8f4` (solid, not dashed)
- **Three labels in the 20px header row**, each `position: absolute; top: 0; height: 20px`, flex-centered, 11px/700, `white-space: nowrap`, `transform: translateX(-50%)`, `pointer-events: none`:
  - "34 D seats not up" at the D block's midpoint, color `#1c3f7a`
  - "51 seats to control" at the majority line, color `#211f1c`
  - "31 R seats not up" at the R block's midpoint, color `#8a2a22`
- **Majority line**: 2px `#211f1c`, `top: 12px; bottom: -8px`, `transform: translateX(-1px)`, `pointer-events: none`. Position is **not 50%** — because the solid blocks are compressed, the 50/51-seat boundary falls partway into the contested block:
  ```js
  demBlockPct        = demSolidCount / totalUnits * 100          // totalUnits = 34 + 31 + 130
  contestedPct       = CONTESTED_UNITS / totalUnits * 100
  seatsIntoContested = 50 - demSolidCount                        // = 16
  majorityLinePos    = demBlockPct + (seatsIntoContested / 35) * contestedPct
  ```
  Recompute from the data — do not hardcode the resulting percentage.

### Narrow layout (<720px)
Same structure rotated 90°: the bar runs top-to-bottom, D block at top, R block at bottom.
- Outer wrapper centered, `max-width: 300px`, 780px tall; inner bar 700px tall, `flex-direction: column`.
- Solid-seat counts become plain centered captions above and below the bar (11px/700, same colors) instead of absolutely-positioned callouts.
- Contested rows: `flex-direction: row` content, `align-items: center; justify-content: center; gap: 5px` — state code (10px/700), number (9px/600), party letter (8px/700) sit **side by side on one line** rather than stacked.
- Segment dividers become `border-bottom`; the contested wrapper gets `border-top`.
- Markers rotate: independent is a 3px vertical bar on the **left** edge (`top: 0; bottom: 0; left: 0; width: 3px`); pending-primary is a 5px vertical bar on the **right** edge.
- Majority line becomes horizontal: `top: {majorityLinePos}%; left: -8px; right: -8px; height: 2px`, `transform: translateY(-1px)`, with a "51 to control" label (10px/700) to its right, outside the bar.

### Legend
Single `flex-wrap` row, `gap: 22px`, `margin-top: 14px`, 12px `#5b574f`. Six entries, each a swatch + label with `gap: 6px`:

| Label | Swatch |
|---|---|
| Solid Democratic | 12×12, `radius: 2px`, `#2f5aa8` |
| Contested, leans D | 12×12, `linear-gradient(90deg,#8a5a8f,#2f5aa8)` |
| Contested, leans R | 12×12, `linear-gradient(90deg,#b3372c,#8a5a8f)` |
| Solid Republican | 12×12, `radius: 2px`, `#b3372c` |
| Independent polling above 10% | 12×3, `#c98a2c` |
| Primary not yet decided | 12×5, `#faf8f4`, `1px solid #5b574f` |

## Component 3: State map

Currently an `<iframe src="./us-map.html">`, 560px tall, `border: none`, `scrolling="no"`. **The iframe is a prototype convenience — inline it as a real component in production.**

Implementation in `us-map.html`:
- **d3-geo + topojson-client**, `us-atlas@3/states-10m.json` from CDN, `d3.geoAlbersUsa()` projection `.fitSize([960, 600], geo)`. Albers-USA includes Alaska and Hawaii as insets — required, they must not be dropped. In production, **vendor the topology locally** rather than hitting a CDN, and consider `react-simple-maps` if the codebase already uses React.
- SVG `viewBox="0 0 975 610"`, `width: 100%; height: 100%`. The page sets `html, body { height: 100%; overflow: hidden }` so the map scales to fit and never introduces a second scrollbar.
- **FIPS→postal mapping** is done client-side from a hardcoded table (topology features are keyed by FIPS id). DC and PR are in the topology but have no Senate seats — they render with the neutral fill and are **excluded from tooltips**.
- Fills: solid `#2f5aa8` / `#b3372c` for uniform delegations; `url(#stripes)` for split delegations and toss-up races.
- **Stripe pattern**, defined once in `<defs>` and reused: `width: 8, height: 8`, `patternTransform="rotate(45)"`, `patternUnits="userSpaceOnUse"`; an 8×8 red rect with a 4×8 blue rect over its left half.
- State paths: `stroke: #faf8f4`, `stroke-width: 1`; on hover `stroke: #211f1c`, `stroke-width: 1.5`.
- Section heading "State-level control" (15px/700) + caption "Both seats combined per state. Diagonal stripes mark a split delegation or a 2026 toss-up race." (12px `#5b574f`).

## Interactions

### Tooltips
Both components share one dark tooltip treatment: `#211f1c` background, `#faf8f4` text, `padding: 10px 13px`, `border-radius: 4px`, 12.5px, `line-height: 1.5`, `min-width: 150px`, `box-shadow: 0 8px 20px rgba(0,0,0,0.28)`.
- Title 13.5px/700, `margin-bottom: 3px`.
- Rows: `display: flex; justify-content: space-between; gap: 14px`, `font-variant-numeric: tabular-nums`; value in `#cfcac0`.
- **No text wrapping** — `white-space: nowrap` on title and rows, and no `max-width`. The tooltip grows as wide as its content. `max-height: 260px` with `overflow-y: auto` handles the long solid-block rosters.
- Positioned at cursor with `transform: translate(-50%, -100%)`, i.e. centered above the pointer; coordinates come from `clientX/Y` minus the bar's `getBoundingClientRect()`. `pointer-events: none`.

Tooltip contents:
- **Contested seat** — title is the state code, plus `" — special election"` for specials. Rows: `demCandidate` / "D 46%", `repCandidate` / "R 54%", and one row per independent (`"Name (I)"`) when `isMaterialIndependent`. Candidates whose primary is pending get `" (primary TBD)"` appended.
- **Solid block** — title "34 Democratic seats not up in 2026"; one row per seat, state code → senator name.
- **Map state** — state name as title; one row per senator with a D/R marker, plus D/R/independent odds rows if that state has a 2026 race.

### Responsive
Single breakpoint at 720px, described above. The map is fluid at all widths.

### Not implemented (worth adding)
- **Touch support.** Everything is `mouseenter`/`mousemove`; there is no tap-to-show-tooltip. Since the narrow layout exists specifically for phones, this is the most important gap to close — wire up `touchstart`/`click` with tap-outside-to-dismiss.
- Keyboard focus and `aria` labels on segments and states.
- Loading and error states beyond the current binary `ready` flag.

## State management

The prototype holds four pieces of state; all layout is derived, not stored.
```js
{ data, hover, mouseX, mouseY, isNarrow }
```
- `data` — the loaded data module; `null` until resolved (drives the `ready` gate). **Becomes the fetch result in production.**
- `hover` — the currently displayed tooltip payload (`{ title, rows }`), or `null`.
- `mouseX` / `mouseY` — cursor position relative to the active bar container.
- `isNarrow` — `window.innerWidth < 720`, updated on `resize` (listener removed on unmount).

Everything else — segment list, colors, flex weights, label positions, majority line position, tooltip payloads — is computed per render from `data` + `isNarrow`. In React, that whole block is one `useMemo` keyed on those two.

## Design tokens

### Colors
| Token | Value | Use |
|---|---|---|
| Democratic | `#2f5aa8` | D solid blocks, gauge, scale max |
| Democratic (dark) | `#1c3f7a` | "D seats not up" label text |
| Republican | `#b3372c` | R solid blocks, gauge, scale min |
| Republican (dark) | `#8a2a22` | "R seats not up" label text |
| Purple (midpoint) | `#8a5a8f` | legend gradient midpoint (scale output at p=0.5) |
| Independent | `#c98a2c` | material-independent marker |
| Neutral | `#c7c4bd` | map fill for non-Senate territories |
| Background | `#faf8f4` | page, segment dividers, pending-primary marker |
| Ink | `#211f1c` | body text, majority line, tooltip background |
| Ink soft | `#5b574f` | captions, secondary text |
| Line | `#e2ded5` | header rule, gauge inset border |
| Tooltip value | `#cfcac0` | right-hand values in tooltips |

### Typography
Helvetica, Arial, sans-serif throughout. Timestamp block uses `ui-monospace, monospace`.

| Role | Size / weight |
|---|---|
| Page title | 34px / 700 |
| Eyebrow ("2026 Election Cycle") | 13px / 600, uppercase, `letter-spacing: 0.06em` |
| Section heading | 15px / 700 |
| Gauge label | 15px / 700 |
| Caption / legend | 12px / 400 |
| Metadata block | 12.5px / 400, monospace |
| Callout labels | 11px / 700 |
| Segment state code | 11px / 700 (10px narrow) |
| Segment percentage | 9px / 600 |
| Segment party letter | 8px / 700, `opacity: 0.85` |
| Tooltip title | 13.5px / 700 |
| Tooltip row | 12.5px / 400, tabular numerals |

### Layout
- Page: `max-width: 1180px`, centered, `padding: 48px 32px 80px`.
- Header: `space-between`, `align-items: flex-end`, `border-bottom: 1px solid #e2ded5`, `padding-bottom: 20px`, `margin-bottom: 32px`. Right side is right-aligned monospace: "Kalshi prediction-market odds" / "Updated {fetchedAt}", formatted `en-US` as `{month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'}`.
- Section spacing: gauge `margin-bottom: 44px`, spectrum `margin-bottom: 52px`.
- Radii: 6px (gauge), 4px (bar, tooltip), 2px (legend swatches).
- Breakpoint: 720px.

## Assets

None. No images, icons, or custom fonts — all visuals are CSS and SVG. External dependencies are `d3` v7.9.0, `topojson-client` v3.1.0, and the `us-atlas` state topology, all currently from CDN with SRI hashes; vendor these locally in production.

## Files in this bundle

| File | Role |
|---|---|
| `Senate Tracker.dc.html` | Main design reference — template (markup + inline styles) and logic class (`renderVals()`). Read as spec, not as portable code. |
| `data.js` | **Portable.** Data model, color scale, thresholds, derivation helpers. Lift directly. |
| `us-map.html` | Map implementation — d3-geo + topojson, projection setup, FIPS mapping, stripe pattern, tooltip. Mostly portable logic. |
| `support.js` | Prototype runtime only. **Ignore entirely.** |

## Data provenance caveat

The 35 contested races and their probabilities come from real Kalshi market snapshots. The 65 solid seats — senator names and which class each is in — were **reconstructed from known Senate composition, not from a Kalshi feed**, since only the contested races carried tickers. Verify that roster against an authoritative source (Senate.gov, or a maintained dataset) before shipping, particularly any seats affected by appointments or resignations since the snapshot.
