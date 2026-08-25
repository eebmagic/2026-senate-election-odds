// Shared data + helpers for the 2026 Senate Races Tracker.
// Ported from design_handoff_senate_tracker/data.js. COLORS, thresholds, and
// the derivation helpers are lifted essentially as-is (per that file's own
// header comment, they're portable). SOLID_SEATS is the 65 seats not up in
// 2026 -- static config, checked in here, updated only on
// appointment/death/resignation (see the README's data provenance caveat).
//
// RACES / CONTROLS_MARKET / FETCHED_AT are NOT here: those are the live,
// nightly-refreshed pieces, fetched at runtime from live-senate-data.json
// (see app.js). buildStateSummaries() therefore takes races as a parameter
// instead of closing over a module-level RACES export.

export const COLORS = {
  demSolid: '#1c3f7a',
  dem: '#2f5aa8',
  repSolid: '#8a2a22',
  rep: '#b3372c',
  neutral: '#c7c4bd',
  independent: '#c98a2c',
  bg: '#faf8f4',
  ink: '#211f1c',
  inkSoft: '#5b574f',
  line: '#e2ded5'
};

export const TOSSUP_LOW = 0.40;
export const TOSSUP_HIGH = 0.60;

// A race counts as "strong" for one party once that party's *own* leading
// candidate is at or above this. Deliberately separate from TOSSUP_LOW/HIGH:
// those drive the continuous color scale (and are stated in terms of the
// Democratic probability), while this is the one-sided cutoff the seat bar
// uses to split its ordered race list into Strong D / lean-and-tossup /
// Strong R groups.
export const STRONG_LEAN = 0.80;

// No hover on touchscreens, so tooltips there open on tap instead, and
// mouseenter/mouseleave are ignored entirely -- mobile browsers still fire
// synthetic mouse events on tap, and acting on them would dismiss a tooltip
// mid-tap, before its link could be hit. See wireTooltip() in app.js and the
// state-node handlers in map.js. Detected once, at module load.
export const isTouchDevice = window.matchMedia('(hover: none), (pointer: coarse)').matches;

// Grace period before a mouseleave-triggered hide actually takes effect.
// Tooltips are anchored a few pixels off their trigger (see the `gap` in
// positionAboveOrBelowRow() in app.js / positionTooltip() in map.js), and a
// mouse moving toward the tooltip can land in that gap for a moment -- on
// neither the trigger nor the tooltip -- which would otherwise fire an
// instant mouseleave and dismiss the tooltip before the cursor ever reaches
// it. Deferring the hide gives that crossing time to land on one of them and
// cancel it. This is what makes a tooltip's own link clickable at all.
export const HIDE_DELAY_MS = 150;

// USPS postal code -> full state name, for tooltip headers (app.js's
// buildRaceTooltip()) that would otherwise show a redundant abbreviation
// right next to the segment's own on-cell abbreviation label. Mirrors the
// set map.js's FIPS_TO_POSTAL covers (50 states + DC + PR), though only the
// 50 states + DC ever actually appear in live race data.
export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  PR: 'Puerto Rico'
};

// 65 seats not up for election in 2026.
export const SOLID_SEATS = [
  // -- other senator in each of the 35 states with a 2026 race --
  { state: 'AK', party: 'R', senator: 'Lisa Murkowski' },
  { state: 'AL', party: 'R', senator: 'Katie Britt' },
  { state: 'AR', party: 'R', senator: 'John Boozman' },
  { state: 'CO', party: 'D', senator: 'Michael Bennet' },
  { state: 'DE', party: 'D', senator: 'Lisa Blunt Rochester' },
  { state: 'FL', party: 'R', senator: 'Rick Scott' },
  { state: 'GA', party: 'D', senator: 'Raphael Warnock' },
  { state: 'IA', party: 'R', senator: 'Chuck Grassley' },
  { state: 'ID', party: 'R', senator: 'Mike Crapo' },
  { state: 'IL', party: 'D', senator: 'Tammy Duckworth' },
  { state: 'KS', party: 'R', senator: 'Jerry Moran' },
  { state: 'KY', party: 'R', senator: 'Rand Paul' },
  { state: 'LA', party: 'R', senator: 'John Kennedy' },
  { state: 'MA', party: 'D', senator: 'Elizabeth Warren' },
  { state: 'ME', party: 'I', caucus: 'D', senator: 'Angus King' },
  { state: 'MI', party: 'D', senator: 'Elissa Slotkin' },
  { state: 'MN', party: 'D', senator: 'Amy Klobuchar' },
  { state: 'MS', party: 'R', senator: 'Roger Wicker' },
  { state: 'MT', party: 'R', senator: 'Tim Sheehy' },
  { state: 'NC', party: 'R', senator: 'Ted Budd' },
  { state: 'NE', party: 'R', senator: 'Deb Fischer' },
  { state: 'NH', party: 'D', senator: 'Maggie Hassan' },
  { state: 'NJ', party: 'D', senator: 'Andy Kim' },
  { state: 'NM', party: 'D', senator: 'Martin Heinrich' },
  { state: 'OH', party: 'R', senator: 'Bernie Moreno' },
  { state: 'OK', party: 'R', senator: 'Markwayne Mullin' },
  { state: 'OR', party: 'D', senator: 'Ron Wyden' },
  { state: 'RI', party: 'D', senator: 'Sheldon Whitehouse' },
  { state: 'SC', party: 'R', senator: 'Tim Scott' },
  { state: 'SD', party: 'R', senator: 'John Thune' },
  { state: 'TN', party: 'R', senator: 'Marsha Blackburn' },
  { state: 'TX', party: 'R', senator: 'Ted Cruz' },
  { state: 'VA', party: 'D', senator: 'Tim Kaine' },
  { state: 'WV', party: 'R', senator: 'Jim Justice' },
  { state: 'WY', party: 'R', senator: 'John Barrasso' },
  // -- both seats, 15 states with no 2026 race --
  { state: 'AZ', party: 'D', senator: 'Mark Kelly' },
  { state: 'AZ', party: 'D', senator: 'Ruben Gallego' },
  { state: 'CA', party: 'D', senator: 'Alex Padilla' },
  { state: 'CA', party: 'D', senator: 'Adam Schiff' },
  { state: 'CT', party: 'D', senator: 'Richard Blumenthal' },
  { state: 'CT', party: 'D', senator: 'Chris Murphy' },
  { state: 'HI', party: 'D', senator: 'Brian Schatz' },
  { state: 'HI', party: 'D', senator: 'Mazie Hirono' },
  { state: 'IN', party: 'R', senator: 'Todd Young' },
  { state: 'IN', party: 'R', senator: 'Jim Banks' },
  { state: 'MD', party: 'D', senator: 'Chris Van Hollen' },
  { state: 'MD', party: 'D', senator: 'Angela Alsobrooks' },
  { state: 'MO', party: 'R', senator: 'Josh Hawley' },
  { state: 'MO', party: 'R', senator: 'Eric Schmitt' },
  { state: 'NV', party: 'D', senator: 'Catherine Cortez Masto' },
  { state: 'NV', party: 'D', senator: 'Jacky Rosen' },
  { state: 'NY', party: 'D', senator: 'Chuck Schumer' },
  { state: 'NY', party: 'D', senator: 'Kirsten Gillibrand' },
  { state: 'ND', party: 'R', senator: 'John Hoeven' },
  { state: 'ND', party: 'R', senator: 'Kevin Cramer' },
  { state: 'PA', party: 'R', senator: 'Dave McCormick' },
  { state: 'PA', party: 'D', senator: 'John Fetterman' },
  { state: 'UT', party: 'R', senator: 'Mike Lee' },
  { state: 'UT', party: 'R', senator: 'John Curtis' },
  { state: 'VT', party: 'I', caucus: 'D', senator: 'Bernie Sanders' },
  { state: 'VT', party: 'D', senator: 'Peter Welch' },
  { state: 'WA', party: 'D', senator: 'Patty Murray' },
  { state: 'WA', party: 'D', senator: 'Maria Cantwell' },
  { state: 'WI', party: 'D', senator: 'Tammy Baldwin' },
  { state: 'WI', party: 'R', senator: 'Ron Johnson' }
];

export function isTossUp(demProbability) {
  return demProbability > TOSSUP_LOW && demProbability < TOSSUP_HIGH;
}

// Kept for any display-time formatting that still wants it (e.g. a tooltip
// suffix), but the authoritative pending-primary detection now happens once,
// server-side, in scripts/build_live_data.py -- races carry explicit
// demPrimaryPending / repPrimaryPending booleans instead of the client
// re-deriving it from candidate name strings on every render.
export function raceHasPendingPrimary(race) {
  return !!(race.demPrimaryPending || race.repPrimaryPending);
}

export function isMaterialIndependent(race) {
  return !!(race.otherTickers && race.otherTickers.some(t => t.probability > 0.10));
}

// Total probability held by candidates who are neither the Democratic nor the
// Republican nominee. Each race's outcome prices are normalized to sum to 1.0
// (see scripts/build_live_data.py), so dem + rep + other == 1.
export function otherProbability(race) {
  return (race.otherTickers || []).reduce((sum, t) => sum + (t.probability || 0), 0);
}

// The candidate actually most likely to win, across all three lanes. Returns
// { party: 'D' | 'R' | 'I', probability }. The seat bar's cell label used to
// derive this as Math.max(demProbability, repProbability), which ignores
// independents entirely -- an independent leading a race would still have
// shown the runner-up major party's number and letter.
export function raceLeader(race) {
  const lanes = [
    { party: 'D', probability: race.demProbability },
    { party: 'R', probability: race.repProbability },
    ...(race.otherTickers || []).map(t => ({ party: 'I', probability: t.probability || 0 }))
  ];
  return lanes.reduce((best, lane) => (lane.probability > best.probability ? lane : best));
}

// Where a race sits on the Democratic<->Republican axis that the seat bar is
// ordered by and that both the bar and the map are colored by. 1.0 is the
// Democratic end, 0.0 the Republican end.
//
// The key is the leader's own probability, mirrored onto that leader's side:
// a D-led race sits at demProbability, an R-led race at 1 - repProbability.
// For a straight two-way race those are the same number, so nothing about the
// 31 two-way races changes.
//
// What it fixes is the three-way case. Ordering by demProbability alone
// silently assigns an independent's entire probability mass to the Republican
// end, which made Nebraska -- where the Republican sits at only ~71% precisely
// because an independent is at ~29% -- render as the single safest Republican
// seat on the board, further right than Wyoming at 98%.
//
// Anchoring to the leader instead keeps the bar's printed percentages in step
// with its ordering: each cell is labeled with its leader's real probability
// (see raceLeader), and because that same number places the cell, the labels
// now run monotonically outward from the center on both sides. NE reads 71 R
// and sits between IA at 59 R and KS at 80 R, exactly where 71 belongs. The
// alternative -- positioning by demProbability + other/2 -- orders the bar
// sensibly too, but leaves NE's printed 71 stranded between 80 and 88.
//
// The number is always a real candidate's odds, never a synthesized blend.
// The independent's share is what the asterisk marks; it is not folded into
// either party's figure.
//
// Edge case: if an independent is the outright favorite the leader has no side
// to anchor to, so the race falls back to the center-weighted position. No
// race in the 2026 map currently hits this -- Osborn leads no state -- but
// build_race() has no fixed suffix convention for independents, so the branch
// must exist rather than assume a D or R leader.
export function raceAxisProb(race) {
  const leader = raceLeader(race);
  if (leader.party === 'D') return race.demProbability;
  if (leader.party === 'R') return 1 - race.repProbability;
  return race.demProbability + otherProbability(race) / 2;
}

function hexLerp(a, b, t) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

// Continuous blue<->red scale driven by Democratic win probability (a 50/50 race reads as purple).
export function colorForDemProb(p) {
  return hexLerp(COLORS.rep, COLORS.dem, p);
}

export function fmtPct(p) {
  const rounded = Math.round(p * 100);
  if (rounded <= 0 && p > 0) return '<1%';
  if (rounded >= 100 && p < 1) return '>99%';
  return rounded + '%';
}

export function seatPartyResolved(seat) {
  return seat.party === 'I' ? seat.caucus : seat.party;
}

export function raceLeadParty(race) {
  return raceLeader(race).party;
}

// One entry per state: current/likely control, for the map.
export function buildStateSummaries(races) {
  const solidByState = {};
  SOLID_SEATS.forEach(s => {
    (solidByState[s.state] = solidByState[s.state] || []).push(s);
  });
  const raceByState = {};
  races.forEach(r => { raceByState[r.state] = r; });

  const states = Array.from(new Set([...Object.keys(solidByState), ...Object.keys(raceByState)]));
  return states.map(state => {
    const solids = solidByState[state] || [];
    const race = raceByState[state];
    let seats, status, party;
    if (race) {
      const otherParty = seatPartyResolved(solids[0]);
      // Both the toss-up test and the lead party read the three-lane
      // derivations rather than demProbability directly, so a race with a
      // material independent classifies the same way it's positioned and
      // colored. A leading independent falls out as 'split' (it can never
      // equal otherParty, which is always D or R) -- correct: the delegation
      // isn't uniformly either party's.
      const leadParty = raceLeadParty(race);
      if (isTossUp(raceAxisProb(race))) {
        status = 'tossup';
      } else {
        status = leadParty === otherParty ? 'solid' : 'split';
        party = leadParty === otherParty ? leadParty : undefined;
      }
      seats = [
        { party: otherParty, senator: solids[0].senator, isRace: false },
        { party: leadParty, isRace: true, race }
      ];
    } else {
      const parties = solids.map(seatPartyResolved);
      status = parties[0] === parties[1] ? 'solid' : 'split';
      party = parties[0] === parties[1] ? parties[0] : undefined;
      seats = solids.map(s => ({ party: seatPartyResolved(s), senator: s.senator, isRace: false }));
    }
    return { state, status, party, seats, race };
  });
}
