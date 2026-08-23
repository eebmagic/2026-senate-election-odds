# Responsive Layout

## ✅ Mobile layout produces a large, empty solid-color block
**Severity:** moderate
**Source:** visual design review

At narrow width (~390px CSS), the horizontal seat strip reflows into a vertical stacked list, which works reasonably well, but the trailing "31 R seats not up" segment renders as one large uninterrupted red rectangle roughly 280-300px tall with no content in it, followed by a gap and then the centered label below. It reads like a rendering glitch rather than "31 seats" of data.

**Suggested fix:** Give the not-up segments a fixed/capped height on mobile (or show a compressed pattern/count similar to the desktop bar) rather than letting them stretch to fill proportional space.

**Review notes:** Reproduced exactly as described at 386px CSS width. Both the "34 D seats not up" block at the top and the "31 R seats not up" block at the bottom of the stacked seat list render as large solid-color rectangles roughly 280-300px tall with no content inside, sitting above/below the individual per-state rows. It does read like a rendering glitch — visually indistinguishable from an empty/broken element rather than a data segment. Confirmed via screenshot at innerWidth 386.

**Decision:** Accept
**Implemented:** layout/mobile-empty-block — verified live at 390px CSS width (via an iframe test harness, since the browser extension's resize doesn't affect `window.innerWidth` in this environment): both "not up" blocks now render at a capped ~60px height instead of a ~280-300px empty rectangle.
**Merge status:** Merged into main (PR #6)

## ✅ Seat-bar labels overlap into unreadable text at mid-range viewport widths
**Severity:** significant
**Source:** interaction & usability review

At a browser width around 1000px (between the full desktop layout and the mobile stacked layout), the per-segment state abbreviation + percentage labels lose their spacing and run together into an illegible smear (e.g. "RINJNMCOORDEMAVAILGA…") across many segments, with the underlying US map also compressing oddly. There's no intermediate responsive handling between the two layouts.

**Suggested fix:** Add a breakpoint that either shrinks/hides labels or switches to the stacked layout earlier.

**Review notes:** Reproduced, though the description undersells how bad it is. Tested across the range between full desktop and the mobile stacked layout:
- ~1020px CSS width: horizontal bar renders cleanly, all state abbreviation/percentage/party labels legible with visible dividers.
- ~880-900px: state abbreviations run together into an unbroken string across many segments (e.g. "RINJNMCOORDEMAVA IL GANCMNNHMEIAKOHTX…"), confirmed via zoomed screenshot — this is the row of state codes overflowing their narrow segments and colliding with neighbors. The percentage/party row just below it stays readable.
- ~810px: same overlap bug.
- ~710px and narrower: layout has already switched to the mobile stacked list (one row per state), which is legible.
So the broken zone is roughly 768px-~950px CSS width, not just "around 1000px," and the underlying map also compresses in that same range as noted. The claim checks out and is worse/wider than the single width cited.

**Decision:** Accept
**Implemented:** layout/seat-bar-label-overlap
**Merge status:** Merged into main
