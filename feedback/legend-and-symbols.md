# Legend & Symbol Clarity

## Diagonal stripes conflate two different meanings
**Severity:** moderate
**Source:** content & wording review

The map caption reads "Both seats combined per state. Diagonal stripes mark a split delegation or a 2026 toss-up race." One visual pattern is used for two unrelated conditions — a state whose two senators are already from different parties (e.g., Wisconsin: Baldwin D / Johnson R) and a state where both senators are the same party but the 2026 race is a toss-up (e.g., Texas, Alaska — both currently Republican). A reader can't tell which case they're looking at without hovering.

**Suggested fix:** Give these two conditions distinct treatments (e.g., a stripe pattern for split delegations and a dot/outline for toss-ups) or add a sentence clarifying "stripes mean one of two things: ...".

**Review notes:** Confirmed in source. `map.js`'s `fillFor()` returns the identical `url(#stripes)` pattern for both `status === 'tossup'` and `status === 'split'` (two conditions computed separately in `senate-shared.js`'s `buildStateSummaries()`: `split` = the state's two senators are permanently different parties regardless of any 2026 race, e.g. WI Baldwin D/Johnson R and PA Fetterman D/McCormick R, both with no 2026 race at all; `tossup` = the state's fixed senator and the 2026 race are same-party but the race's Democratic win probability falls in the 40–60% band, e.g. TX, IA, OH, AK, NC). Live data confirms both cases are currently on the map with the same fill. The caption text quoted in this item matches the live site exactly. Only the hover tooltip (listing actual senator names/parties or race candidates) discloses which case applies — there is no visual distinction on the map itself. The issue is real and precisely described.

**Decision:** Accept

## No stated thresholds for "Solid" vs. "Contested" categories
**Severity:** moderate
**Source:** content & wording review

The legend defines four categories — "Solid Democratic," "Contested, leans D," "Contested, leans R," "Solid Republican" — but never states the probability cutoffs separating them (e.g., is 80% "solid" or "contested"? KS at 80% R renders as solid red while IA at 59% R is still "contested"). A general reader has no way to know where the line falls.

**Suggested fix:** Add a parenthetical to the legend, e.g. "Solid (>80% or <20%) / Contested (20–80%)," using the site's actual thresholds.

**Review notes:** The underlying confusion is real, but the mechanism differs from what the item assumes, so the suggested fix as written would misdescribe the site. There is no probability threshold anywhere in the code separating "Solid" from "Contested." "Solid Democratic"/"Solid Republican" are the 65 seats structurally not up for election in 2026 (`SOLID_SEATS` in `senate-shared.js`) — a fixed, election-cycle-timing distinction, not a confidence cutoff. The "Contested" middle block covers the 35 seats that are up in 2026, and its color (`colorForDemProb`) is a continuous red→blue gradient keyed directly to each race's exact win probability — there is no coded split into "leans D" vs "leans R" sub-thresholds; the legend's two "Contested" swatches are just two sampled points on one continuous scale. The item's own example (KS 80% R vs. IA 59% R) is inaccurate on the live site: both KS and IA are in the 35-race contested block, not the solid endcaps (confirmed via live data), and the solid-block color (#8a2a22) and the contested gradient's reddest possible value (#b3372c) are coded as distinct — if similar — hues, so a very confident contested race isn't literally color-identical to a true solid seat. The real gap is that the 4-swatch legend visually implies four discrete confidence tiers when it's actually two fixed-color endcaps (by election-cycle timing) plus one continuous gradient (by probability), and nothing on the page states that distinction.

**Decision:** Discuss/Refine — the clarity problem is real, but the fix should explain that "Solid" = not up in 2026 (not a probability cutoff) and that "Contested" is a continuous gradient, rather than inventing specific percentage thresholds that don't exist in the app.

## Special-election seats aren't disclosed anywhere but the tooltip
**Severity:** moderate
**Source:** content & wording review

Hovering OH and FL reveals tooltip titles "OH — special election" and "FL — special election," but nothing in the visible legend, headline stats ("65 not up in 2026 · 35 contested"), or seat-bar labels tells a general reader that 2 of the 35 contested races are off-cycle special elections rather than regular 6-year-term races.

**Suggested fix:** Add a small marker/legend entry ("★ special election") next to those tiles, or a line in the intro noting "includes 2 special elections (OH, FL)."

**Review notes:** Confirmed exactly as described. The live data (`live-senate-data.json`) has exactly 2 of the 35 contested races flagged `"raceType":"special"` — OH and FL, matching the item precisely. In `app.js`, the " — special election" suffix is appended only to the hover-tooltip title (`buildRaceTooltip`); grepping the static markup and all site JS turns up no other surface (legend, headline stat text, or seat-bar label) that ever reads or displays `raceType`. A reader who never hovers OH or FL has no way to learn these are off-cycle races.

**Decision:** Accept

## "Primary not yet decided" indicator is too subtle to register as meaningful
**Severity:** minor
**Source:** visual design review

The small white sliver marking "primary not yet decided" appears as a 2-3px tall notch at the very bottom edge of a handful of cells (RI, DE, MA, NH, SC, OK). It's listed in the legend, but visually it's easy to mistake for a stray border/rendering artifact rather than an intentional status indicator.

**Suggested fix:** Use a more visible marker (e.g., a diagonal hash, dot, or icon) consistent in weight with the other legend symbols.

**Review notes:** Confirmed and, if anything, understated. Computed styles show `.pending-mark-h` renders at 5px tall against an 88px-tall cell (~6% of the cell's height), anchored to the bottom edge, with `background-color: rgb(250, 248, 244)` — which is exactly identical to the page's `body` background color (also `rgb(250, 248, 244)`). It has no border, icon, or pattern of its own in the chart (only the legend key's swatch has a 1px border); in the actual bar it is purely a page-colored cutout in the colored cell, i.e., visually indistinguishable from a rendering gap. It currently appears on 7 states: RI, DE, MA, NH, AK, SC, OK — the item lists 6 of these (misses AK), which doesn't change the substance.

**Decision:** Accept

## State map has no adjacent legend
**Severity:** moderate
**Source:** visual design review

The "State-level control" map (scrolled well below the seat-strip legend) reuses the same Solid D / Contested / Solid R color coding but has no legend of its own nearby — only a one-line caption about diagonal stripes. A viewer who scrolled straight to the map has to scroll back up to recall what each shade means.

**Suggested fix:** Repeat a compact legend (or at least the 4 color swatches) directly under the map heading.

**Review notes:** Confirmed visually. The "State-level control" section, several hundred pixels below the seat-strip chart, has only its one-line caption ("Both seats combined per state. Diagonal stripes mark a split delegation or a 2026 toss-up race.") — no color swatches are repeated near it. The full legend (Solid Democratic / Contested leans D / Contested leans R / Solid Republican, plus the independent-polling and primary-pending marker keys) lives only up in the seat-strip section. A viewer landing on or scrolling directly to the map has no adjacent key for the color coding.

**Decision:** Accept
