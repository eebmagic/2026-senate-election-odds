# Tooltips

## ✅ Truncated "seats not up" tooltip has no scroll or overflow indicator
**Severity:** significant
**Source:** interaction & usability review

Hovering the large solid-color block on the seat bar (e.g. "34 D seats not up" / "31 R seats not up") opens a list tooltip of all senators in that group. It renders only the first ~12 of 34 names (through "MA — Elizabeth Warren") and then hard-cuts with a clean rounded border — no scrollbar, fade, or "+22 more" indicator — so roughly two-thirds of the list is simply inaccessible.

**Suggested fix:** Give the tooltip a scrollable body (with a visible affordance) or truncate with an explicit "+N more" note.

**Review notes:** Reproduced exactly at http://localhost:8000. Hovering the solid "34 D seats not up" block shows ~13 of 34 rows (AZ Mark Kelly through MA Elizabeth Warren, matching the described cutoff point almost exactly), then cuts off with a clean flat bottom edge — no scrollbar, fade, or "+N more" indicator, confirmed visually. Checked the CSS in `web/index.html` line 86: `.tooltip { ... max-height: 260px; overflow-y: auto; ... pointer-events: none; ... }`. The `overflow-y: auto` turns out to be dead code in practice: because the tooltip has `pointer-events: none`, it can never be the hit-test target for a wheel event, so scrolling while hovering it scrolls the underlying page instead (confirmed empirically — a real mouse-wheel scroll over the open tooltip moved `window.scrollY` and left the tooltip's own `scrollTop` at 0, then closed the tooltip entirely since the cursor fell off the trigger element). So this isn't just a missing visual affordance — the remaining ~21 names are completely unreachable by any means. If anything this is worse than described.

**Decision:** Accept

**Implemented:** tooltips/seats-not-up-scroll

**Merge status:** Merged into main

## ✅ Hover tooltip has no visual anchor to its trigger
**Severity:** minor
**Source:** visual design review

The dark tooltip that appears on hovering a seat cell (e.g., "FL — special election, Angie Nixon D 7%, Ashley Moody R 93%") floats above-right of the cursor with no pointer/caret connecting it back to the specific cell, and it can overlap neighboring cell labels underneath it. In the densely packed strip this makes the association between tooltip and target state ambiguous at a glance.

**Suggested fix:** Add a small directional arrow/caret on the tooltip pointing at its source cell, or highlight the source cell while its tooltip is open.

**Review notes:** Reproduced. Hovering a seat cell (checked VA, GA, OH) shows the dark card positioned above/left of the cursor with no caret, pointer, or connecting element — confirmed in CSS that `.tooltip` defines no `::before`/`::after` arrow. It does visually overlap and obscure the row of cell labels directly beneath it (a VA hover covered the state-code text for the NJ/NM/CO/OR/DE/MA/VA cells in the row below in one screenshot). That said, since the tooltip actively tracks the cursor position (`move()` in app.js sets `tooltip.style.left/top` to `event.clientX/Y` on every `mousemove`), the cursor itself stays a fairly strong proximity cue in practice — the ambiguity is real but probably milder than "minor" implies in a dense strip, since the pointer is always right at the tooltip's corner.

**Decision:** Accept

**Implemented:** tooltips/visual-anchor

Highlighted the hovered cell (a bright inset ring, `.tip-source` in `web/index.html`) while its tooltip is open, toggled in `show()`/`hide()` in `web/app.js`'s `wireTooltip()`. Chose this over a caret since the tooltip already tracks the cursor via `move()`, and a fixed-position caret pointing at the source cell would require separate positioning logic that conflicts with that behavior. Verified live on VA, GA, and OH seat-bar cells.

## Map tooltip and seat-bar tooltip differ in richness, inconsistently
**Severity:** minor
**Source:** interaction & usability review

Map tooltips show state name + both senators/candidates but no "Click to view on Kalshi" link or win-probability numbers, while seat-bar tooltips show race type, per-candidate probabilities, and a Kalshi link. Given the two tooltip styles otherwise look identical (same dark card), the differing content/actions is easy to miss and compounds the "map looks clickable but isn't" confusion (see [[map-and-interactivity]]).

**Suggested fix:** Align tooltip content across map and seat bar, or visually differentiate the two tooltip types if their capabilities are meant to differ.

**Review notes:** Partially confirmed via code and live testing. `map.js` implements a fully separate `tooltipHtml()` from app.js's `buildRaceTooltip`/`tooltipHtml` — the two only share the CSS `.tooltip` class (`web/index.html` line 85: "Tooltip (shared by spectrum + map)"), which is why they look identical. Confirmed the map tooltip never includes a "Click to view on Kalshi" link — `map.js`'s `tooltipHtml()` has no href/hint logic at all, unlike app.js's version which conditionally appends `.hint` when `payload.href` is set. However, the claim that map tooltips lack win-probability numbers does not hold up: hovering a contested state on the map (e.g., Ohio) shows "Sherrod Brown D 52%" / "Jon Husted R 48%" — the same probability data as the seat-bar tooltip — because `map.js`'s `tooltipHtml()` calls `fmtPct(r.demProbability)`/`fmtPct(r.repProbability)` per race row. Solid/uncontested states (e.g., California) correctly show no probability on either tooltip type, since there's no live race there. So the real, valid gap is narrower than described: only the missing Kalshi link, not a broader richness/probability gap.

**Decision:** Discuss/Refine — the missing Kalshi link on map tooltips is real and worth a decision (add the link, or confirm map tooltips are meant to be link-free), but the "no win-probability numbers" part of the claim should be corrected/dropped before scoping a fix.

## Tooltips are keyboard-inaccessible (mouse-hover only)
**Severity:** moderate
**Source:** interaction & usability review

See [[accessibility]] — tooltips are wired to CSS `:hover` only, so keyboard users tabbing to a race link never see the tooltip detail.

**Review notes:** The end conclusion is valid, but the stated mechanism is factually wrong, which matters for scoping the fix. Grepped the whole `web/` source: there are no CSS `:hover` rules that show/hide `.tooltip` at all — the only two `:hover` rules in `index.html` are `a:hover { color }` and `path.state:hover { stroke }`, purely cosmetic and unrelated to tooltip visibility. Tooltips are actually shown/hidden entirely through JS mouse-event listeners: `app.js`'s `bindHover`/`bindLink` wire `mouseenter`/`mouseleave`, and `map.js` wires `.on('mousemove', ...)`/`.on('mouseleave', ...)`. There are zero `focus`, `blur`, or `keydown` handlers anywhere in `app.js`, `map.js`, or `senate-shared.js`. Practically this makes the problem broader than described: contested-race cells are real `<a href>` elements (reachable by Tab) that simply never show their tooltip on focus; the solid D/R block that opens the big 34/31-name list tooltip is a plain non-interactive element with no `href`/`tabindex`, so it isn't reachable by keyboard at all; and the whole SVG map is plain `<path>` elements with no `tabindex`/`href`, so none of its tooltips are keyboard-reachable either.

**Decision:** Discuss/Refine — the keyboard-inaccessibility conclusion is valid and should be fixed (Accept-worthy on substance), but the "CSS `:hover` only" framing should be corrected to "JS mouse-event-only, no focus/keydown equivalent" before this is handed off, since the actual fix is adding `focus`/`blur` handlers (and possibly `tabindex`/keyboard triggers on the non-link solid blocks and map paths), not touching any CSS.
