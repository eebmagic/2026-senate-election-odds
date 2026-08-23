# Map & Interactivity

## ✅ Map states look clickable but do nothing on click
**Severity:** moderate
**Source:** interaction & usability review

SVG state paths on the "State-level control" map have `cursor: pointer` computed style and show an info tooltip on hover, visually matching the seat-bar segments — but they have no click handler and are not wrapped in a link (verified via DOM inspection and by clicking, which produced no navigation or new tab). Since the seat-bar segments with an identical look/tooltip style *do* link out to Kalshi, users reasonably expect the same from the map and get nothing.

**Suggested fix:** Either make map states link to the relevant race like the bar does, or drop the pointer cursor so the affordance doesn't overpromise.

**Review notes:** Reproduced directly. DOM inspection of `#map-svg path.state` confirms `cursor: pointer` in computed style and confirms the only event listeners bound to state paths are `mousemove` and `mouseleave` (verified via the D3 internal `__on` listener registry) — there is no `click` listener anywhere on the path, no `onclick`, and the path is not wrapped in an `<a>` (`closest('a')` returns null). A synthetic click dispatched at a state's center produced no `window.open` call and no `location.href` change. By contrast, seat-bar segments (`.seg-wide`) are genuinely wrapped in `<a href="https://kalshi.com/markets/...">` tags, and hovering them shows a tooltip ending in "Click to view on Kalshi ↗" — the map's hover tooltip has no such affordance or link. So the report is accurate on every point: identical cursor/hover affordance, no click behavior, and a real behavioral gap versus the seat bar.

**Decision:** Accept
**Merge status:** Merged into main (PR #7, `interactivity/map-click-link`)

**Implemented:** interactivity/map-click-link — states with a 2026 race are now wrapped in a real `<a href="kalshiUrl">` (mirroring `.seg-wide`/`.seg-narrow`), the map tooltip gained a matching "Click to view on Kalshi ↗" hint, and `cursor: pointer` is now scoped via a `.linked` class to only those states (solid/uncontested states, with no single race to link to, are no longer styled as clickable). Verified live: clicking a contested state (Michigan) opened its Kalshi market page in a new tab; computed `cursor` is `pointer` on `.state.linked` and `auto` on plain `.state`.

## Small New England states are hard to hit on the map
**Severity:** minor
**Source:** interaction & usability review

RI, CT, and coastal MA render as a few pixels on the state map with no zoomed inset, callout, or enlarged hit-area fallback. A hover attempt just past Cape Cod (intending to reach RI) landed on open water and produced no tooltip at all, requiring pixel-precise aim on very small shapes.

**Suggested fix:** Consider a small-state inset/callout as many election maps use.

**Review notes:** Confirmed via DOM measurement. At a typical desktop map width (~950px rendered SVG), Rhode Island's bounding box measures roughly 11–13px × 16–17px on screen — by far the smallest of the mainland states (for comparison, Connecticut is ~27×27px, Massachusetts ~50–58px wide, Delaware ~18×27px). A point picked just past Massachusetts' coastline (simulating an overshoot toward RI/Cape Cod) landed on the bare `<svg>` background rather than any `path.state` element, meaning the cursor genuinely misses all state geometry there and no hover tooltip fires — consistent with the report's description of landing on "open water" with no tooltip. The claim that RI/CT/MA render as "a few pixels" is a bit of an overstatement for CT and MA specifically (they're small but not sub-pixel), but RI in particular is a legitimately tiny, easy-to-miss target with no zoom/inset/enlarged-hit-area fallback.

**Decision:** Discuss/Refine

## Map tooltip and seat-bar tooltip differ in richness
See [[tooltips]] for details — related to the "looks clickable" issue above since the two elements share a visual language but not behavior/content.

**Review notes:** This item is a pointer to `tooltips.md` rather than a standalone finding, so full evaluation belongs there. For this file's purposes: spot-checked map tooltips (hovering Ohio, Minnesota, Kansas, Oklahoma) show only candidate names and percentages, with no call-to-action. The seat-bar tooltip, by contrast, ends with a "Click to view on Kalshi ↗" link line. This confirms the two tooltips do differ in content/richness despite matching visual styling (dark card, same typography), which is an accurate premise for the cross-referenced discussion.

**Decision:** Discuss/Refine (as an accurate pointer — see `tooltips.md` for the detailed writeup)

## Map has no adjacent legend
See [[legend-and-symbols]] for details.

**Review notes:** This item is a pointer to `legend-and-symbols.md` rather than a standalone finding, so full evaluation belongs there. For this file's purposes: on the live page, the color/pattern legend (Solid Democratic, Contested leans D/R, Solid Republican, Independent polling, Primary not yet decided) is positioned directly below the seat bar and above the "State-level control" heading — i.e., well above the map itself, separated from it by a section heading and a line of descriptive text. So while a legend exists on the page and does cover the map's color encoding, it is not visually adjacent to the map, confirming the premise of this cross-referenced item.

**Decision:** Accept (as an accurate pointer — see `legend-and-symbols.md` for the detailed writeup)
