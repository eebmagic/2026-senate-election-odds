# Color & Contrast

## Contested-lean colors are nearly indistinguishable at the critical midpoint
**Severity:** significant
**Source:** visual design review

In the "All 100 seats" strip, the "Contested, leans D" and "Contested, leans R" swatches are both muted purple/mauve and read as almost the same hue, especially where they sit adjacent (e.g., MI 60D, AK 60D, OH 52D next to TX 52R, IA 59R). This is exactly the zone — around the 51-seat control line — where color is supposed to communicate which way a race leans, but a viewer has to read the small "D"/"R" letter instead of relying on color.

**Suggested fix:** Push the leans-D and leans-R contested colors further apart in hue/saturation (e.g., keep leans-D closer to blue and leans-R closer to red-orange rather than both converging on gray-purple).

**Review notes:** Confirmed via `getComputedStyle` on the "All 100 seats" strip. The contested-seat cell color is a continuous gradient interpolated by D win-probability (legend swatches themselves are `linear-gradient(90deg, rgb(179,55,44)→rgb(138,90,143))` for "leans R" and `linear-gradient(90deg, rgb(138,90,143)→rgb(47,90,168))` for "leans D" — both pivot through the same purple `rgb(138,90,143)` at the 50/50 point). Measured actual cell backgrounds at the exact pair called out: OH (52D) = `rgb(111,73,108)` vs TX (52R) = `rgb(116,72,103)` — a WCAG contrast ratio of only 1.007 and a Euclidean RGB distance of ~7/441, i.e. essentially the same color. A zoomed screenshot of the ME/MI/AK/OH/TX/IA/KS run visually confirms OH and TX are indistinguishable mauve blocks, distinguished only by the tiny "D"/"R" glyph. MI 60D vs IA 59R (a less extreme pair) is more separated (Euclidean ~36, contrast 1.02) but still a subtle, muted hue shift rather than a clear color-coded signal. This validates the claim precisely — the "critical midpoint" is a real, measurable near-collision, not just a subjective impression.

**Decision:** Discuss/Refine - Would the second issue here (text contrast color) resolve some of this by making the D/R note more obvious? Could the described solution above display the colors in a continuous way even between constested/solid races?

## ✅ Borderline text contrast on solid-color and contested cells
**Severity:** minor–moderate
**Source:** visual design review

The small bold state-abbreviation/probability/party labels are rendered in near-black text directly on the solid red ("Solid Republican") and muted purple ("Contested") cell backgrounds. At this text size the contrast looks close to the edge of comfortable readability (particularly on the mid-saturation purple contested cells).

**Suggested fix:** Verify contrast ratios for each cell-background/text pairing against WCAG AA (4.5:1 for text this small); lighten label color or darken/desaturate backgrounds where any fall short.

**Review notes:** Measured programmatically across all 35 contested-seat labels in the "All 100 seats" strip (state abbreviation / probability / party letter, `.seg-state` and siblings). Text color is pure black `rgb(0,0,0)`, font is 11px / weight 700 — well under the WCAG "large text" threshold, so the 4.5:1 AA minimum applies, not the relaxed 3:1. Computed contrast ratios against each cell's actual background ranged from **2.83 to 3.5** across all 35 cells — every single one fails AA, none reach even the lower 3:1 large-text bar with real margin. Notably the failure isn't confined to "mid-saturation purple contested cells" as the note suggests: even the most saturated, near-pure-color contested seats (e.g. RI at 99% D, deep solid-looking blue) only reach ~3.15 contrast, and the worst offender (MI, 60% D, contrast 2.83) is in the purple zone as expected. One correction to the item's framing: the 65 "not up in 2026" seats rendered as flat "Solid Democratic"/"Solid Republican" blocks do NOT carry per-state text labels at all (no state abbreviation/number is drawn on them) — only the 35 contested seats have labels, and their color happens to range from near-pure blue/red at the extremes to purple in the middle. So "text directly on solid red background" isn't literally happening in the strip today, but the substance of the complaint (near-black bold small text failing AA) is real and, if anything, understated — it's a uniform failure across the whole contested range, not a borderline/occasional one.

**Decision:** Accept — and severity should likely be bumped from "minor–moderate" to "moderate/significant" given it's a 100%-of-cases AA failure (2.83–3.5:1, never reaching 4.5:1) rather than an edge case.

**Implemented:** contrast/contested-label-color
