# UI Feedback — 2026 Senate Races Dashboard

Collected by 3 parallel browser-driven review agents (visual design, interaction/usability, content/wording) against `localhost:8000` on 2026-08-22. No code changes were made — review only.

21 findings across 7 files:

| File | Topic | Significant | Moderate | Minor |
|---|---|---|---|---|
| [color-and-contrast.md](color-and-contrast.md) | Color coding & text contrast | 1 | 0 | 1 |
| [tooltips.md](tooltips.md) | Tooltip content & behavior | 1 | 1 | 2 |
| [legend-and-symbols.md](legend-and-symbols.md) | Legend clarity, symbol meaning | 0 | 4 | 1 |
| [responsive-layout.md](responsive-layout.md) | Layout at narrow/mid viewport widths | 1 | 1 | 0 |
| [map-and-interactivity.md](map-and-interactivity.md) | State map behavior | 0 | 1 | 1 |
| [accessibility.md](accessibility.md) | Keyboard focus & tooltip a11y | 1 | 1 | 0 |
| [content-clarity.md](content-clarity.md) | Wording, data presentation | 0 | 1 | 3 |

**Standouts worth prioritizing first:**
- Contested-lean D/R colors nearly indistinguishable at the map's most important decision boundary
- Seat-bar labels become unreadable at ~1000px viewport width (no intermediate breakpoint)
- "Seats not up" tooltip silently truncates ~2/3 of its list with no indicator
- Keyboard focus ring isn't rendering on seat-bar links despite being present in computed styles
