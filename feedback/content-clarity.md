# Content & Data Clarity

## ✅ Map tooltip mixes an unrelated incumbent with the actual 2026 race, unlabeled
**Severity:** moderate
**Source:** content & wording review

Hovering Oklahoma on the map shows three unlabeled rows: "Markwayne Mullin R" (his seat isn't up in 2026, no percentage shown), then "Democratic party (primary TBD) D 2%" and "Kevin Hern R 98%" (the seat that is up). Nothing distinguishes "senator not on the ballot" from "2026 race candidates" — a reader could easily think all three are competing against each other, or wonder why one row has no percentage.

**Suggested fix:** Split into two labeled groups, e.g. "Not up in 2026: Markwayne Mullin (R)" and "2026 race: ...".

**Review notes:** Reproduced on the live site. Hovering Oklahoma on the "State-level control" map (bottom of page) shows exactly three unlabeled rows: "Markwayne Mullin R" (no percentage), "Democratic party (TBD) D 2%", and "Kevin Hern R 98%" — nothing visually or textually separates the not-up-in-2026 senator from the 2026 race candidates. (Site copy reads "Democratic party (TBD)", not "(primary TBD)" as quoted in the item, but the substance is identical.) Spot-checked other states with a split/toss-up delegation (e.g. Ohio: "Bernie Moreno R" / "Sherrod Brown D 52%" / "Jon Husted R 48%"; Arkansas: "John Boozman R" / "Hallie Shoffner D 6%" / "Tom Cotton R 94%") and the same unlabeled pattern holds — this is systemic to the map tooltip component, not an Oklahoma-only quirk.

**Decision:** Accept
**Implemented:** clarity/map-tooltip-grouping — verified live: hovering Oklahoma now shows a "NOT UP IN 2026" group ("Markwayne Mullin R") separated from a "2026 RACE" group ("Democratic party (TBD) D 2%", "Kevin Hern R 98%"); confirmed on Michigan as well.
**Merge status:** Merged into main (PR #4, `clarity/map-tooltip-grouping`)

## Named candidate shown at a flat "0%"
**Severity:** minor
**Source:** content & wording review

The Nebraska tooltip lists "Cindy Burbank D 0%" alongside "Pete Ricketts R 70%" and "Dan Osborn (I) 30%". Displaying a named, major-party candidate at an exact 0% reads like a data error or glitch to a general reader rather than "negligible odds."

**Suggested fix:** Display as "<1%" (or similar) for any value that rounds to zero, or footnote that odds under some threshold are shown as 0%.

**Review notes:** Reproduced exactly. Hovering NE in the "All 100 seats" bar chart shows "Cindy Burbank D 0%", "Pete Ricketts R 70%", "Dan Osborn (I) 30%" verbatim as described. A named, major-party candidate shown at a flat "0%" next to two candidates with real percentages does read as a data glitch rather than a deliberately negligible outcome.

**Decision:** Accept

## "Seats" vs. "races" used inconsistently
**Severity:** minor
**Source:** content & wording review

The page title is "U.S. Senate Races," but nearly every other label uses "seats" ("All 100 seats," "51 seats to control," "34 D seats not up," "35 contested"), while the map caption switches back to "a 2026 toss-up race." Not incorrect, but the mixed usage may read as sloppy to a careful reader.

**Suggested fix:** Standardize on "seats" for count-based UI elements and reserve "race(s)" for individual contest descriptions (as in "toss-up race"), or vice versa, applied consistently.

**Review notes:** Confirmed. Browser tab title is "2026 U.S. Senate Races" and the on-page H1 reads "U.S. Senate Races," while every count-based label uses "seats": "All 100 seats," "51 seats to control" (shortened to "51 to control" on the compact bar), "34 D seats not up," "31 R seats not up." The "State-level control" section caption reads "Diagonal stripes mark a split delegation or a 2026 toss-up race" — confirming the switch to "race" described in the item. The usage is inconsistent as described, though it reads as a defensible editorial choice (title/description in "Races," UI counts in "seats") rather than an obvious error.

**Decision:** Discuss/Refine — the inconsistency is real but low-severity/subjective; worth a product decision on which term to standardize per context rather than a mechanical find-replace.

## "51 seats to control" omits the tie-breaker nuance
**Severity:** minor
**Source:** content & wording review

The chamber-control bar marks "51 seats to control" as the majority threshold. In reality the U.S. Senate only requires 50 seats plus the Vice President's tie-breaking vote for majority control, so "51" is a simplification that could confuse a reader who knows this.

**Suggested fix:** Either footnote "(50 with VP tiebreak)" or rephrase to "majority threshold" without implying 51 is strictly required.

**Review notes:** Confirmed wording on the live site: the chamber-control divider on the "All 100 seats" bar is labeled "51 seats to control" (and abbreviated "51 to control" directly on the bar itself). The item's underlying fact is correct — 50 seats plus a VP tiebreak is sufficient for control, so "51" is a simplification. It's not inaccurate (51 is a valid majority threshold on its own), just incomplete for a reader who knows about the tiebreak.

**Decision:** Accept - Use the "majority threshold" terminology or similar.

