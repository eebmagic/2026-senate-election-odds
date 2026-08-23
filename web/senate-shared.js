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
  return race.demProbability >= 0.5 ? 'D' : 'R';
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
      if (isTossUp(race.demProbability)) {
        status = 'tossup';
      } else {
        const leadParty = raceLeadParty(race);
        status = leadParty === otherParty ? 'solid' : 'split';
        party = leadParty === otherParty ? leadParty : undefined;
      }
      seats = [
        { party: otherParty, senator: solids[0].senator, isRace: false },
        { party: race.demProbability >= 0.5 ? 'D' : 'R', isRace: true, race }
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
