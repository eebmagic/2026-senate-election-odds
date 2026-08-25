# Nonstandard election processes in the 2026 Senate map

*Research note. Written 2026-08-25 against `web/live-senate-data.json` as of
`fetchedAt: 2026-08-23T23:38:06Z`, plus a live read of the Kalshi API on
2026-08-25. No code was changed for this document.*

The tracker quietly assumes that every Senate race in the country works the
same way: each major party holds a primary, the primary produces one named
nominee per party, and the November general election is a plurality contest
between those two nominees. That assumption is baked into the data pipeline
(`demPrimaryPending` / `repPrimaryPending`) and into three separate places in
the UI (the seat-bar "?" badge, both tooltip builders, and the legend).

Alaska breaks it outright — it has no party primaries at all — and the page
currently tells the reader something false about Alaska as a result. Three
other states in the 2026 map bend the assumption in smaller ways. This note
establishes what each state actually does, traces what the code does with it
today, and lays out options.

---

## 1. What Alaska actually does

Alaska replaced its old partisan primaries in 2020, when voters approved
Ballot Measure 2. Since 2022 the state has run what its Division of Elections
calls the **Top Four Primary**: every candidate for an office, regardless of
party, appears on a single ballot in one August election, and "the top four
vote getters will advance to the RCV General Election."
([elections.alaska.gov](https://www.elections.alaska.gov/ranked-choice-voting/))
There is no Democratic primary and no Republican primary. Party labels appear
next to candidates' names, but they are self-declared registrations, not
nominations — a party cannot field "a nominee" in Alaska, and nothing about
the primary narrows a party's field to one person.

The November general election is then decided by **ranked-choice voting**.
Voters rank up to four candidates. If someone takes a majority of first
choices in round one, they win outright. Otherwise the last-place candidate is
eliminated, ballots that ranked that candidate first transfer to their next
surviving choice, and the process repeats until a candidate holds a majority
of continuing ballots. A tie for last place in a round is broken "by lot" —
literally a coin flip, drawn name, or drawn straws, at the director's
discretion.
([Alaska Division of Elections RCV materials](https://www.elections.alaska.gov/RCV.php/))

Two consequences matter for a display that is fundamentally about *party
control of a seat*:

**The general election is not necessarily D-vs-R.** In 2022, three of the four
finalists were Republicans — Lisa Murkowski, Kelly Tshibaka, and Buzz Kelley
(who withdrew but stayed on the ballot) — alongside Democrat Pat Chesbro. The
race went three rounds, Chesbro was eliminated in the final round with 11.2%,
and Murkowski beat Tshibaka 53.7% to 46.3%.
([Wikipedia, 2022 Alaska Senate election](https://en.wikipedia.org/wiki/2022_United_States_Senate_election_in_Alaska))
A market priced purely on "will a Republican win Alaska" would have sat near
100% for the entire cycle while the actual contest — which Republican —
went entirely unrepresented.

**2026 looks more conventional, but only by luck of the draw.** The
nonpartisan primary was held August 18, 2026. With about 80% counted, the AP
projected Democrat Mary Peltola (48.1%) and Republican incumbent Dan Sullivan
(42.7%) advancing; the third and fourth finalists were still unresolved as of
this writing.
([Wikipedia, 2026 Alaska Senate election](https://en.wikipedia.org/wiki/2026_United_States_Senate_election_in_Alaska);
[Alaska Beacon](https://alaskabeacon.com/2026/08/18/in-alaskas-u-s-senate-race-its-sullivan-and-peltola-in-front-and-house-also-shows-no-surprises/))
So the 2026 Alaska race probably *does* resolve to a Peltola-vs-Sullivan
top-two fight — but it will be settled by RCV rounds against two other names
still on the ballot, not by a plurality head-to-head.

One more wrinkle worth knowing about: a **repeal initiative is on the same
November 3, 2026 ballot**, which would abolish top-four/RCV and reinstate
closed partisan primaries. It qualified with 42,837 verified signatures
against a 34,098 requirement. The previous repeal attempt, in 2024, failed
49.9% to 50.1% — the narrowest margin in state history.
([Ballotpedia](https://ballotpedia.org/Alaska_Repeal_Top-Four_Ranked-Choice_Voting_Initiative_(2026));
[Alaska Beacon](https://alaskabeacon.com/2026/07/29/alaskans-to-vote-on-ballot-measure-that-would-overhaul-state-election-system/))
It does not affect the 2026 Senate race itself, but it does mean any
Alaska-specific wording shipped now has a real chance of being wrong for 2028.

---

## 2. What the code does with it today

### Where the flag comes from

`scripts/build_live_data.py` derives the pending-primary state entirely from a
string match on the market's candidate label:

```python
GENERIC_CANDIDATE_RE = re.compile(r"^(democratic|republican)( \(\w+\))? party$", re.IGNORECASE)

def is_primary_pending(market) -> bool:
    name = (market.get("yes_sub_title") or "").strip()
    return bool(GENERIC_CANDIDATE_RE.match(name))
```

`build_race()` calls this once per side and writes `demPrimaryPending` /
`repPrimaryPending` into each race. `script.py` invokes the same `build()`
in-memory on every run, so there is exactly one place this is decided.

The heuristic's own docstring is honest about what it is measuring: Kalshi
lists a generic party name "when that party's primary hasn't resolved yet."
That inference is correct for most states. It is wrong for Alaska, because
**Kalshi's Alaska market is party-level by design, not by pendency.**
Confirmed live on 2026-08-25, a full week after the Alaska primary:

```
SENATEAK-26-R | Republican party | Will Republicans win the Senate race in Alaska? | active
SENATEAK-26-D | Democratic party | Will Democratics win the Senate race in Alaska? | active
```

The market title is a question about a *party*, not about a candidate. There
is no primary left to resolve, and this label will very likely still read
"Democratic party" on election day. Alaska's pending flags are therefore not a
transient state that will clear on its own — they are a **permanent false
positive**.

Compare with the states where the same flag is correct. As of the current
snapshot, seven races carry a pending flag: AK, DE, MA, NH, RI, OK (D side
only), and SC (R side only). All except Alaska have a genuinely unresolved
nomination — SC's is a good illustration, since Lindsey Graham's death in July
2026 forced a special Republican primary that went to an August 25, 2026
runoff between appointed Senator Darline Graham and Rep. Ralph Norman.
([NBC News](https://www.nbcnews.com/politics/2026-election/appointed-sen-darline-graham-advances-gop-senate-primary-runoff-south-rcna591628))
The heuristic is right six times out of seven. It is the seventh case that
needs a fix.

### Where it surfaces in the UI

Three independent render paths consume the flags, and all three assert the
same false thing about Alaska:

| File | Function | Output for Alaska |
|---|---|---|
| `web/app.js` | `makeContestedSeg()` → `segHtmlWide()` / `segHtmlNarrow()` | a "?" badge on the AK segment, `title="Primary not yet decided"` |
| `web/app.js` | `buildRaceTooltip()` | rows reading `Democratic party (primary TBD)` and `Republican party (primary TBD)` |
| `web/map.js` | `tooltipHtml()` | the same rows, abbreviated to `(TBD)` |
| `web/index.html` | legend markup | `? Primary not yet decided` |

`web/senate-shared.js` supplies the one shared predicate,
`raceHasPendingPrimary(race)`, which `app.js` uses for the badge. `map.js`
doesn't use it — it reads `r.demPrimaryPending` / `r.repPrimaryPending`
directly — so a fix has to touch both files, which is exactly the split
CLAUDE.md warns about for tooltip content.

The rest of the Alaska rendering is, notably, **fine**.
`buildStateSummaries()` in `senate-shared.js` resolves the race seat to
`race.demProbability >= 0.5 ? 'D' : 'R'`, and `colorForDemProb()` shades the
map on the same number. Since Kalshi's Alaska market resolves on *which party
holds the seat* — which is exactly what the choropleth and the seat bar are
trying to show — the geometry, the color, and the seat-bar position are all
correct. Only the words are wrong.

### Structural fragilities specific to nonstandard states

Four things in `build_race()` would misbehave if Kalshi ever remodelled a race
the way the underlying process actually works:

1. **A race with no `-D` and `-R` pair is dropped entirely.** `build_race()`
   returns `None` unless both a `-D`-suffixed and an `-R`-suffixed market
   exist. If Kalshi ever recut Alaska as four per-candidate markets (the
   natural modelling for a top-four RCV race), Alaska would vanish from
   `races`, land in `failedStates`, and be carried forward as `stale` forever
   — with no error, because that path is indistinguishable from a fetch
   failure.
2. **Every non-D/R outcome is hardcoded as `"affiliation": "independent"`**,
   and both tooltip builders render it as `(I)`. That fallback is deliberate
   and correct for the current data (see CLAUDE.md on the unstable ticker
   suffixes `TACH` / `IND` / `DOSB` / `BBEN`), but in an Alaska-style field a
   second Republican or an Alaskan Independence Party candidate would be
   labelled "independent," which is simply false.
3. **`normalize_outcomes()` forces the listed outcomes to sum to 1.0.** With
   only D and R markets present, any residual probability mass that the market
   might implicitly assign to "neither" gets silently redistributed between
   the two parties. Harmless in a two-party race; wrong in principle for a
   state where a non-major-party win is a live path.
4. **`isMaterialIndependent()` uses a 0.10 threshold on market probability,
   but the legend calls it "Independent polling above 10%."** That is a
   mislabel — it is not polling, it is an implied win probability. Nebraska
   (Dan Osborn at ~29%) is the case where a reader is most likely to notice.

None of these are broken today. They are listed because any change to how
nonstandard states are represented will run into them.

---

## 3. The other states in the 2026 map

I checked the full 35-race list against the systems commonly cited as
nonstandard. Summary first, detail after.

| State | Process | In the 2026 map? | Does the code mishandle it? |
|---|---|---|---|
| **Alaska** | Top-four nonpartisan primary + RCV general | Yes | **Yes** — false "primary pending" |
| **Maine** | RCV in the general, federal offices only | Yes | Not wrong, but unmarked |
| **Georgia** | Majority required in the general; runoff four weeks later | Yes | Not wrong, but unmarked |
| **Louisiana** | *New for 2026:* closed party primaries; plurality general | Yes | No — LA is now conventional |
| **Mississippi** | Primary runoff only; general is plurality for U.S. Senate | Yes | No |
| AL, AR, NC, OK, SC, TX | Primary runoffs | Yes | No — only affects flag timing |
| California, Washington | Top-two "jungle" primary | **No** — neither seat is up in 2026 | N/A |
| Nebraska | Ordinary partisan primaries for federal office | Yes | No |

### Maine — RCV in the general election

Maine uses ranked-choice voting for **all state-level primaries** and, in
general elections, "ONLY for federal offices, including the office of U.S.
President." The state constitution requires a plurality winner for Governor
and the Legislature, which is why the general-election use is federal-only.
Tabulation is conditional: if no candidate has a majority on election night in
a race with three or more candidates, ballots go to Augusta for central
tabulation in rounds.
([Maine Secretary of State RCV FAQ](https://www.maine.gov/sos/elections-voting/ranked-choice-voting-frequently-asked-questions))

So Maine's 2026 Senate general — Susan Collins seeking a sixth term against
Troy Jackson — will be decided by RCV if any third candidate holds enough
first choices to deny a majority. The current display shows the race as a
plain two-way with named candidates and no pending flag, which is *accurate as
far as it goes*: Kalshi prices the party of the eventual winner, and RCV
rounds don't change who that is. The gap is only that a reader has no way to
know the seat could flip between round one and the final round. Maine is
also the state where the D+R normalization noted above would bite hardest if a
strong independent entered late — Maine has elected independents to this
chamber twice, and Angus King currently holds the other seat.

### Georgia — majority required in the general

Georgia is the one state that requires an absolute majority in a **general**
election for federal office. If no candidate clears 50% on November 3, 2026,
the top two meet in a runoff "4 weeks after the general election."
([georgia.gov](https://georgia.gov/vote-runoff-elections)) SB 202 (2021)
shortened that window from nine weeks to four but left the threshold alone.
That puts the 2026 Georgia runoff, if one is needed, on December 1, 2026.

This has no effect on the probabilities — Kalshi's Georgia market resolves on
who ultimately holds the seat, runoff included — but it does mean the seat
count implied by the page is not necessarily knowable on election night.
Georgia has gone to a Senate runoff twice in the last three cycles, so this is
not a hypothetical. Today the page says nothing about it.

### Louisiana — the jungle primary is gone as of 2026

This one is easy to get wrong from memory. Louisiana's famous all-party
"jungle primary" held on general-election day, with a December runoff if
nobody cleared 50%, **no longer applies to U.S. Senate races.** Act 1 of the
2024 First Extraordinary Session moved U.S. House, U.S. Senate, the Louisiana
Supreme Court, the Public Service Commission, and BESE to **closed party
primaries** starting in 2026. Only registered Democrats and Republicans vote
in their own party's primary; unaffiliated voters may pick one; voters
registered with a third party are excluded. If no candidate wins a majority in
the closed primary, "the top two vote-getters will be required to participate
in a runoff election." The general election is then decided on a plurality:
"The candidate with the greatest number of votes in the general will be
declared the winner, with no majority required."
([Louisiana Secretary of State](https://www.sos.la.gov/elections-voting/closed-party-primary-elections);
[270toWin](https://www.270towin.com/content/changes-to-louisiana-primaries-effective-in-2026))
For 2026 the primary was May 16 with a June 27 runoff.
([Louisiana Illuminator](https://lailluminator.com/2026/04/20/party-primary-louisiana/))

The upshot for this repo: **Louisiana is now an ordinary state** as far as the
display logic is concerned, and the current data reflects that correctly
(named candidates Jamie Davis and Julia Letlow, no pending flags). Worth
recording explicitly, because the repo already carries a Louisiana-specific
landmine — `SENATELA-26` is Kalshi's mislabeled *Kentucky* event, with real
Louisiana at `KXSENATELA-26NOV` — and a future reader who half-remembers the
jungle primary might "fix" something that isn't broken.

### Mississippi — plurality for U.S. Senate, despite what some sources say

Several secondary sources assert that Mississippi requires a majority in the
U.S. Senate general election and would hold a December 1, 2026 runoff. **That
appears to be wrong**, and it is worth stating why so nobody has to re-derive
it.

Mississippi's general-election runoff requirement comes from HB 1276 (2023),
which amended Miss. Code § 23-15-193 to require a majority and a runoff. That
section is titled "Officers to be elected at general state election," and it
enumerates Governor, Lieutenant Governor, Secretary of State, Auditor,
Treasurer, Attorney General, the Public Service and Transportation
Commissioners, Insurance and Agriculture Commissioners, state legislators,
district attorneys, sheriffs, coroners, assessors, surveyors, supervisors,
justice court judges, and constables. **It does not list U.S. Senator.**
([FindLaw, Miss. Code § 23-15-193](https://codes.findlaw.com/ms/title-23-elections/ms-code-sect-23-15-193/))
MultiState's runoff survey agrees, describing Mississippi's general-election
runoff as covering "statewide officers (Governor, Lt. Governor, AG, etc.)"
only, since 2024.
([MultiState](https://www.multistate.us/elections/runoffs-101))
Wikipedia's 2026 Mississippi Senate page mentions no runoff requirement, and
the historical case cuts the same way: Thad Cochran won the 1978 Senate race
with 45% and no runoff.

Mississippi does have a **primary** runoff at 50%+1, like most of the South.
That affects only when a pending flag clears, not how the general is decided.

### Primary-runoff states, and why they matter a little

Nine states hold primary runoffs — Alabama, Arkansas, Georgia, Louisiana,
Mississippi, North Carolina, Oklahoma, South Carolina, and Texas — at a 50%+1
threshold everywhere except North Carolina, where the threshold is 30% and the
runoff is requested rather than automatic.
([MultiState](https://www.multistate.us/elections/runoffs-101))
Eight of those states have a 2026 Senate race on this map.

The only implication for the tracker is timing: "primary pending" can stay
true for weeks or months after a state's nominal primary date, which makes the
badge's persistence unremarkable in those states and easy to confuse with
Alaska's permanent case. South Carolina is the current live example.

### Top-two states are not in this cycle

California and Washington run top-two primaries, which would raise the same
"the general may not be D-vs-R" problem as Alaska. Neither has a Senate seat
up in 2026 — `SOLID_SEATS` in `senate-shared.js` lists Padilla and Schiff for
California and Murray and Cantwell for Washington, all not up. So top-two is
genuinely out of scope for this cycle, and any fix designed for Alaska should
be checked against it only as a forward-looking concern.

---

## 4. Options

All five options assume the map coloring and seat-bar placement stay as they
are. That part is already right: Kalshi resolves the Alaska market on party of
the winner, which is precisely the quantity the choropleth and the seat bar
display.

### Option A — Do nothing but suppress the false flag

Add an explicit exclusion so Alaska never gets `demPrimaryPending` /
`repPrimaryPending`. Alaska then renders as an ordinary race whose candidate
labels happen to read "Democratic party" and "Republican party," with no "?"
badge and no "(primary TBD)."

*For:* smallest possible change; one place to edit (`is_primary_pending()` or
its caller); removes a statement that is flatly untrue; no new UI vocabulary,
no new legend entry, no new symbols to explain.

*Against:* the labels "Democratic party / Republican party" still look like
placeholder data to a reader who doesn't know Alaska's system, and now there is
no marker at all to explain why. It trades a wrong explanation for a missing
one. It also hardcodes a state name in the transform, which is the kind of
special case that accumulates.

### Option B — Suppress the flag and relabel the rows honestly

Same suppression, plus change the Alaska rows to say what the market actually
is — e.g. "Any Democrat" / "Any Republican," or "Democratic nominee (no
primary — top-four)." The tooltip title could carry a one-line process note.

*For:* the display becomes true rather than merely not-false; a reader learns
something instead of being confused; still no new symbology or legend entry.

*Against:* the wording has to be duplicated in `buildRaceTooltip()` in
`app.js` and `tooltipHtml()` in `map.js` unless it is factored into
`senate-shared.js` first. Also still Alaska-specific, and the copy has a shelf
life given the November repeal initiative.

### Option C — Reframe the flag as what the data actually measures

Rename the concept. The signal `is_primary_pending()` genuinely detects is
"Kalshi is pricing a party, not a named candidate" — a superset of "primary
pending." Rename to something like `demCandidateTBD`, change the badge tooltip
and the legend from "Primary not yet decided" to "No named candidate yet," and
have the transform additionally record *why* (`"reason": "primary-pending"`
vs. `"reason": "party-level-market"`), driven by a small checked-in table
rather than by a state-name `if`.

*For:* the flag stops asserting a fact about election law that the data does
not support, and becomes an accurate statement about the market. It stays a
single code path, correct for all seven flagged states with no per-state
exceptions in the render layer. The legend gains no entries — one existing
entry gets more honest wording.

*Against:* touches the JSON schema, so `build_live_data.py`, `senate-shared.js`
(`raceHasPendingPrimary`), `app.js` (two call sites), `map.js`, and the legend
copy all move together. Also somewhat abstract — "no named candidate yet" is
true but tells a reader less about Alaska than Option B does.

### Option D — Add a general per-state process annotation

Introduce a checked-in `scripts/state_processes.json` (sibling to
`event_ticker_map.json`), keyed by state, carrying a short process note and an
optional flag or two: Alaska = top-four nonpartisan primary + RCV general;
Maine = RCV general; Georgia = majority required, runoff four weeks later;
Louisiana = closed party primaries as of 2026. `build()` attaches it to each
race; both tooltip builders render it as one extra line.

*For:* solves the whole class rather than the Alaska instance, including the
two states (Maine, Georgia) that are currently unmarked and arguably should
be; keeps the facts in checked-in data with a place for sources, exactly like
`event_ticker_map.json`, so updating them doesn't mean editing render code;
extends naturally to a top-two state in 2028.

*Against:* the largest change, and it needs a real editorial decision about how
much text belongs in a tooltip that is already carrying four to five rows plus
a Kalshi link. It also creates a small maintenance surface that will go stale
if nobody remembers it exists — the Alaska repeal initiative could invalidate
its Alaska entry as soon as November.

### Option E — Model the RCV field directly

Show all four Alaska finalists with per-candidate probabilities.

*Not currently possible.* Kalshi publishes exactly two Alaska markets, both
party-level (verified live above). There is no per-candidate data to render,
and inventing one would mean sourcing Alaska from somewhere other than Kalshi
— which breaks the single-source premise the whole pipeline rests on. Listed
only to record that it was considered and ruled out on data availability, not
on design grounds.

---

## 5. Recommendation

**Ship Option C, and keep Option D as a follow-up if the Maine and Georgia
gaps turn out to bother anyone.**

The reason to prefer C over A or B is that the bug here is not really "Alaska
is special." It is that the pipeline names a derived signal after an inference
it cannot actually make. `is_primary_pending()` sees a party name where a
person's name should be, and concludes "a primary hasn't happened yet." For
six of seven flagged races that inference is correct; for Alaska it is
structurally impossible for it ever to become correct, because Alaska has no
primary to pend on. Renaming the flag to describe the observation
("no named candidate in this market") rather than the guess ("primary not yet
decided") makes every one of the seven correct, with no per-state branch in
the render layer and no new legend vocabulary. The optional `reason` field
then carries the state-specific nuance for anyone who wants to surface it
later, without any UI committing to it now.

The reason not to reach for D immediately is proportionality. Maine and
Georgia are *unmarked*, not *wrong* — the page shows accurate probabilities
for both, and Kalshi's markets already resolve on the post-runoff,
post-RCV-rounds outcome. That is a genuine content gap, but it's the kind that
belongs in a `feedback/`-style item with its own discussion about tooltip
density, not bundled into a correctness fix. And Alaska's entry in any such
table has a live chance of needing a rewrite the moment the November 3 repeal
initiative is decided.

Concretely, the recommended change set:

1. In `scripts/build_live_data.py`, rename the derived fields and the helper
   to describe the observation, not the inference, and record a reason
   sourced from a small checked-in table rather than a hardcoded state check.
2. In `web/senate-shared.js`, rename `raceHasPendingPrimary()` to match.
3. In `web/app.js` and `web/map.js`, update both `tooltipHtml()`-family
   builders — remembering that these are deliberately separate implementations
   and each needs its own edit.
4. In `web/index.html`, change the legend entry and the badge `title` from
   "Primary not yet decided" to wording that covers both cases, and fix
   "Independent polling above 10%" to say market-implied probability rather
   than polling.
5. **Do not** change the choropleth, the seat-bar ordering, or the toss-up
   thresholds for Alaska. They are already correct.

None of the four structural fragilities in §2 need fixing as part of this.
They should be revisited if Kalshi ever recuts the Alaska market by candidate
— at which point item 1 in that list (the silent drop when no `-D`/`-R` pair
exists) becomes an outage rather than a fragility.

---

## Sources

- Alaska Division of Elections — [Ranked Choice Voting / Top Four Primary](https://www.elections.alaska.gov/ranked-choice-voting/), [RCV implementation](https://www.elections.alaska.gov/RCV.php/)
- [2026 United States Senate election in Alaska](https://en.wikipedia.org/wiki/2026_United_States_Senate_election_in_Alaska) — Wikipedia
- [2022 United States Senate election in Alaska](https://en.wikipedia.org/wiki/2022_United_States_Senate_election_in_Alaska) — Wikipedia
- Alaska Beacon — [Sullivan and Peltola lead the August 18 primary](https://alaskabeacon.com/2026/08/18/in-alaskas-u-s-senate-race-its-sullivan-and-peltola-in-front-and-house-also-shows-no-surprises/), [2026 repeal ballot measure](https://alaskabeacon.com/2026/07/29/alaskans-to-vote-on-ballot-measure-that-would-overhaul-state-election-system/)
- Ballotpedia — [Alaska Repeal Top-Four Ranked-Choice Voting Initiative (2026)](https://ballotpedia.org/Alaska_Repeal_Top-Four_Ranked-Choice_Voting_Initiative_(2026))
- Maine Secretary of State — [Ranked-Choice Voting FAQ](https://www.maine.gov/sos/elections-voting/ranked-choice-voting-frequently-asked-questions)
- Georgia.gov — [Vote in Runoff Elections](https://georgia.gov/vote-runoff-elections)
- Louisiana Secretary of State — [Closed Party Primary Elections](https://www.sos.la.gov/elections-voting/closed-party-primary-elections)
- 270toWin — [Changes to Louisiana Primaries Effective in 2026](https://www.270towin.com/content/changes-to-louisiana-primaries-effective-in-2026)
- Louisiana Illuminator — [Party primary primer: what Louisiana voters need to know for the May 16 election](https://lailluminator.com/2026/04/20/party-primary-louisiana/)
- FindLaw — [Miss. Code § 23-15-193](https://codes.findlaw.com/ms/title-23-elections/ms-code-sect-23-15-193/)
- MultiState — [Runoff Elections](https://www.multistate.us/elections/runoffs-101)
- NBC News — [South Carolina GOP Senate special primary runoff](https://www.nbcnews.com/politics/2026-election/appointed-sen-darline-graham-advances-gop-senate-primary-runoff-south-rcna591628)
- Nebraska Secretary of State — [How nonpartisan voting works in Nebraska primary elections](https://sos.nebraska.gov/elections/how-nonpartisan-voting-works-nebraska-primary-elections)
- Kalshi trade API, `event_ticker=SENATEAK-26`, read 2026-08-25
