// Shared constants, probability helpers, and the tooltip positioner used by
// app.js (seat bar) and map.js (choropleth). SOLID_SEATS is static config;
// the live race data is fetched by app.js and passed into
// buildStateSummaries().

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

// One-sided cutoff: a race is "strong" for a party when that party's own
// leader is at or above this. Splits the seat bar into Strong D / middle /
// Strong R; unrelated to the TOSSUP_LOW/HIGH color scale.
export const STRONG_LEAN = 0.80;

// Touchscreens have no hover: tooltips open on tap and mouse events are
// ignored (synthetic ones around a tap would dismiss a tooltip mid-tap).
export const isTouchDevice = window.matchMedia('(hover: none), (pointer: coarse)').matches;

// Grace period before a mouseleave hide fires, so a cursor crossing the few
// px between trigger and tooltip doesn't dismiss it. Makes the tooltip's own
// link reachable.
export const HIDE_DELAY_MS = 150;

// USPS code -> full state name, for tooltip headers.
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

// Pending-primary detection is done server-side (build_live_data.py); this
// just ORs the resulting booleans.
export function raceHasPendingPrimary(race) {
  return !!(race.demPrimaryPending || race.repPrimaryPending);
}

export function isMaterialIndependent(race) {
  return !!(race.otherTickers && race.otherTickers.some(t => t.probability > 0.10));
}

// Total probability held by non-major-party candidates (prices sum to 1.0).
export function otherProbability(race) {
  return (race.otherTickers || []).reduce((sum, t) => sum + (t.probability || 0), 0);
}

// Most likely winner across all three lanes -> { party: 'D'|'R'|'I',
// probability }. Max(dem, rep) would miss a leading independent.
export function raceLeader(race) {
  const lanes = [
    { party: 'D', probability: race.demProbability },
    { party: 'R', probability: race.repProbability },
    ...(race.otherTickers || []).map(t => ({ party: 'I', probability: t.probability || 0 }))
  ];
  return lanes.reduce((best, lane) => (lane.probability > best.probability ? lane : best));
}

// Position on the D<->R axis the seat bar is ordered/colored by (1.0 = D,
// 0.0 = R): the leader's own probability mirrored onto the leader's side
// (D-led -> demProb, R-led -> 1 - repProb; identical for a two-way race).
// Using demProb alone would assign an independent's whole share to the R end
// -- e.g. Nebraska (R ~71%, independent ~29%) would sort right of Wyoming's
// 98%. A leading independent has no side, so it falls back to center-weighted
// (no 2026 race hits this, but there's no fixed independent-suffix rule).
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

// Continuous red<->blue scale by Democratic win probability (50/50 = purple).
export function colorForDemProb(p) {
  return hexLerp(COLORS.rep, COLORS.dem, p);
}

export function fmtPct(p) {
  const rounded = Math.round(p * 100);
  if (rounded <= 0 && p > 0) return '<1%';
  if (rounded >= 100 && p < 1) return '>99%';
  return rounded + '%';
}

// Escapes text for interpolation into tooltip HTML, including attribute
// context (`"` -> &quot; for the hint link's href).
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function seatPartyResolved(seat) {
  return seat.party === 'I' ? seat.caucus : seat.party;
}

// Positions a `.tooltip` anchored above `anchorEl` (flipping below when there
// isn't room), nudges it back on-screen, and aims its ::after tail at the
// anchor's horizontal center. `originEl` is the positioned ancestor the
// tooltip's left/top are relative to. The on-screen clamp bounds X by the
// viewport by default; the map passes clampWithinOrigin because its
// #map-wrap is narrower than the viewport. Shared by app.js and map.js.
export function positionTooltip(tipEl, anchorEl, originEl, { gap = 6, clampWithinOrigin = false } = {}) {
  const originRect = originEl.getBoundingClientRect();
  const anchorRect = anchorEl.getBoundingClientRect();
  const centerX = anchorRect.left + anchorRect.width / 2 - originRect.left;

  tipEl.classList.remove('below');
  tipEl.style.left = centerX + 'px';
  tipEl.style.top = (anchorRect.top - gap - originRect.top) + 'px';

  const spaceAbove = anchorRect.top;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  if (spaceAbove < tipEl.getBoundingClientRect().height + gap && spaceBelow > spaceAbove) {
    tipEl.classList.add('below');
    tipEl.style.top = (anchorRect.bottom + gap - originRect.top) + 'px';
  }

  const margin = 8;
  const minX = clampWithinOrigin ? originRect.left + margin : margin;
  const maxX = clampWithinOrigin ? originRect.right - margin : window.innerWidth - margin;
  const r = tipEl.getBoundingClientRect();
  let dx = 0, dy = 0;
  if (r.left < minX) dx = minX - r.left;
  else if (r.right > maxX) dx = maxX - r.right;
  if (r.top < margin) dy = margin - r.top;
  else if (r.bottom > window.innerHeight - margin) dy = (window.innerHeight - margin) - r.bottom;
  if (dx || dy) {
    tipEl.style.left = (parseFloat(tipEl.style.left) + dx) + 'px';
    tipEl.style.top = (parseFloat(tipEl.style.top) + dy) + 'px';
  }

  // Tail against the post-clamp left edge, clamped inside the rounded corners.
  const tail = 10;
  const finalRect = tipEl.getBoundingClientRect();
  const finalLeft = finalRect.left - originRect.left;
  const tailX = Math.max(tail, Math.min(finalRect.width - tail, centerX - finalLeft));
  tipEl.style.setProperty('--tail-x', tailX + 'px');
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
      // Toss-up test and lead party both use the three-lane derivations, so a
      // race classifies the same way it's positioned and colored. A leading
      // independent falls out as 'split' (never equals otherParty).
      const leadParty = raceLeader(race).party;
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
