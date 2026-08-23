# Accessibility

## No visible keyboard focus indicator on seat-bar links
**Severity:** significant
**Source:** interaction & usability review

Tabbing through the page moves `document.activeElement` correctly through the seat-bar's `<a class="seg-wide">` race links (confirmed via JS — bounding rect matches the on-screen segment, and computed style reports a 1px outline), but nothing is visually rendered at any tabbed position in screenshots/zooms. Keyboard-only users have no way to tell which race link is currently focused before pressing Enter.

**Suggested fix:** Investigate why the outline isn't painting (likely a covering sibling/overlay or z-index issue) and ensure a clearly visible focus ring.

**Review notes:** Reproduced directly. Tabbing to (or `el.focus()`-ing) any `a.seg-wide` segment in the "All 100 seats" bar does move `document.activeElement` to that link, and `getComputedStyle` confirms a real focus outline is applied (`outline: rgb(0, 95, 204) auto 1px`, `outline-offset: 1px`) — but zoomed screenshots at both an edge segment (RI) and a middle segment (near the "51 seats to control" line) show no visible ring at all. Root cause found: `index.html` defines `.bar-wide { position: relative; height: 88px; width: 100%; display: flex; border-radius: 4px; overflow: hidden; }` (line 42). Since each segment's box fills the bar's height/width edge-to-edge, the default outline drawn just outside the segment's border box is clipped away by this `overflow: hidden` on the parent. Confirmed causally: setting `document.querySelector('.bar-wide').style.overflow = 'visible'` in the live page makes the blue focus ring appear immediately around the focused segment. The actual cause is `overflow: hidden` clipping (not a covering sibling/z-index issue as guessed in the suggested fix), but the reported symptom and impact (no visible focus indicator for keyboard users) are fully valid.

**Decision:** Accept

## Tooltips are mouse-hover only, not tied to keyboard focus
**Severity:** moderate
**Source:** interaction & usability review

Confirmed by mismatch: with JS reporting `document.activeElement` on the GA/NC seat link, the on-screen tooltip still showed FL's data, left over from an earlier mouse position. Tooltips use CSS `:hover` rather than `:focus`, so keyboard users tabbing to a race link get no candidate-name/probability detail (only the small always-visible abbreviation label) until they activate the link.

**Suggested fix:** Wire tooltip visibility to `:focus-visible` as well as `:hover`.

**Review notes:** Confirmed at the source level, which settles the question more conclusively than a single live repro would: in `app.js`, both tooltip-binding helpers — `bindHover` (used for the solid, unlinked D/R blocks) and `bindLink` (used for real contested-race `<a>` segments) — attach only `mouseenter`/`mouseleave` listeners on non-touch devices (and only a `click` listener on touch devices). There is no `focus`, `focusin`, or `blur` listener anywhere in the file that calls the tooltip's `show()`/`hide()` functions. Also note the tooltip logic isn't CSS `:hover`-driven as the report speculates — it's JS-driven via explicit `mouseenter`/`mouseleave` handlers — but the effect described is exactly right: keyboard focus never triggers or dismisses the tooltip. A keyboard user tabbing through race links gets no candidate-name/probability popup at all, and if a tooltip is already open from a prior mouse hover elsewhere on the page, it will keep displaying that stale race's data indefinitely while focus moves elsewhere, since nothing about focus changes triggers `hide()` either. One small overstatement in the report: the always-visible label isn't just the state abbreviation — it also always shows the win probability and D/R letter (e.g. "GA 92 D") — but candidate names are indeed hover/click-only, so the core accessibility gap stands.

**Decision:** Accept
