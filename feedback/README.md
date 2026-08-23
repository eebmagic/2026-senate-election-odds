# UI Feedback — 2026 Senate Races Dashboard

Collected by 3 parallel browser-driven review agents (visual design, interaction/usability, content/wording) against `localhost:8000` on 2026-08-22. No code changes were made during collection.

Each finding was then independently re-verified live against `localhost:8000` (DOM/CSS inspection, computed styles, source review) and given a decision, with the maintainer's final call recorded inline in each file. No code changes were made during review either — findings only.

21 findings across 7 files:

| File | Topic | Significant | Moderate | Minor | Accept | Discuss/Refine |
|---|---|---|---|---|---|---|
| [color-and-contrast.md](color-and-contrast.md) | Color coding & text contrast | 1 | 0 | 1 | 1 | 1 |
| [tooltips.md](tooltips.md) | Tooltip content & behavior | 1 | 1 | 2 | 2 | 2 |
| [legend-and-symbols.md](legend-and-symbols.md) | Legend clarity, symbol meaning | 0 | 4 | 1 | 4 | 1 |
| [responsive-layout.md](responsive-layout.md) | Layout at narrow/mid viewport widths | 1 | 1 | 0 | 2 | 0 |
| [map-and-interactivity.md](map-and-interactivity.md) | State map behavior | 0 | 1 | 1 | 2 | 0 |
| [accessibility.md](accessibility.md) | Keyboard focus & tooltip a11y | 1 | 1 | 0 | 0 | 2 |
| [content-clarity.md](content-clarity.md) | Wording, data presentation | 0 | 1 | 3 | 3 | 1 |
| **Total** | | **4** | **9** | **8** | **14** | **7** |

No findings were rejected outright — every reported issue reproduced live. Several agents found the described *mechanism* slightly off even where the core issue was real (e.g. the seat-bar focus ring exists but is clipped by `overflow: hidden`, not a z-index issue; tooltips are gated by JS mouse-event listeners, not CSS `:hover`) — see each item's "Review notes" for specifics before implementing a fix.

**Accepted, ready to act on:**
- Small bold labels on contested/solid cells fail WCAG AA contrast across the board (2.83–3.5:1, need 4.5:1) — [color-and-contrast.md](color-and-contrast.md)
- "Seats not up" tooltip truncates ~2/3 of its list with no way to reach the rest — worse than reported, since `pointer-events: none` also blocks scrolling — [tooltips.md](tooltips.md)
- Diagonal-stripe pattern conflates "split delegation" and "2026 toss-up," special elections (OH, FL) are undisclosed outside the tooltip, the "primary pending" marker is colored identically to the page background on 7 states, and the map has no adjacent legend — [legend-and-symbols.md](legend-and-symbols.md)
- Seat-bar labels overlap into an unreadable smear across ~768–950px viewport width (wider than the ~1000px originally reported), and the mobile "not up" blocks render as large empty rectangles at ~390px — [responsive-layout.md](responsive-layout.md)
- Map states show a pointer cursor and hover tooltip but have no click handler at all (seat-bar segments do); Rhode Island's on-screen hit target is ~11–17px with no fallback — [map-and-interactivity.md](map-and-interactivity.md)
- Map tooltip mixes an unrelated not-up-in-2026 incumbent into the 2026 race rows with no label; Nebraska shows a named candidate at a flat "0%" — [content-clarity.md](content-clarity.md)

**Discuss/Refine — needs a product decision or corrected scope before acting:**
- Contested-lean D/R colors are confirmed near-identical at the 50/50 midpoint (contrast ratio ~1.0), but whether fixing label contrast alone resolves it, or the gradient itself needs rework, is still open — [color-and-contrast.md](color-and-contrast.md)
- Map tooltip is missing only the "Click to view on Kalshi" link (not probabilities, contra the original report); keyboard-inaccessible tooltips are real but driven by missing JS focus handlers, not CSS — [tooltips.md](tooltips.md)
- "Solid" vs "Contested" isn't a probability cutoff at all — "Solid" means not up for election in 2026, "Contested" is a continuous gradient — so the suggested percentage-threshold fix needs to be reworded first — [legend-and-symbols.md](legend-and-symbols.md)
- No visible keyboard focus ring on seat-bar links (root cause: `.bar-wide { overflow: hidden }` clips a real, correctly-applied outline), and tooltips never fire on keyboard focus — both confirmed reproducible; deferred pending a call on whether keyboard support is in scope — [accessibility.md](accessibility.md)
- "Seats" vs "races" wording is inconsistently used across the page (real, but low-severity/subjective) — [content-clarity.md](content-clarity.md)
