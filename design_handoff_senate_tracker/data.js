// Shared data + helpers for the 2026 Senate Races Tracker.
// Values derived from Kalshi market snapshots (last_price_dollars on the -D/-R/independent
// tickers for each SENATE##-26 event, normalized to sum to 1 across a race's outcomes).

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

export const CONTROLS_MARKET = {
  eventTicker: 'CONTROLS-2026',
  demProbability: 0.46,
  repProbability: 0.54,
  fetchError: null
};

export const FETCHED_AT = '2026-08-04T06:12:00Z';

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

// 35 seats up for election in 2026, with live (nightly-refreshed) market probabilities merged in.
export const RACES = [
  { state: 'AK', raceType: 'regular', demProbability: 0.545, repProbability: 0.455, demCandidate: 'Democratic Party', repCandidate: 'Dan Sullivan' },
  { state: 'AL', raceType: 'regular', demProbability: 0.046, repProbability: 0.954, demCandidate: 'Everett Wess', repCandidate: 'Barry Moore' },
  { state: 'AR', raceType: 'regular', demProbability: 0.042, repProbability: 0.958, demCandidate: 'Hallie Shoffner', repCandidate: 'Tom Cotton' },
  { state: 'CO', raceType: 'regular', demProbability: 0.967, repProbability: 0.033, demCandidate: 'John Hickenlooper', repCandidate: 'Mark Baisley' },
  { state: 'DE', raceType: 'regular', demProbability: 0.989, repProbability: 0.011, demCandidate: 'Chris Coons', repCandidate: 'Republican Party' },
  { state: 'FL', raceType: 'special', demProbability: 0.149, repProbability: 0.851, demCandidate: 'Democratic Party', repCandidate: 'Ashley Moody' },
  { state: 'GA', raceType: 'regular', demProbability: 0.909, repProbability: 0.091, demCandidate: 'Jon Ossoff', repCandidate: 'Mike Collins' },
  { state: 'IA', raceType: 'regular', demProbability: 0.426, repProbability: 0.574, demCandidate: 'Josh Turek', repCandidate: 'Ashley Hinson' },
  { state: 'ID', raceType: 'regular', demProbability: 0.016, repProbability: 0.906, demCandidate: 'David Roth', repCandidate: 'Jim Risch',
    otherTickers: [{ candidate: 'Todd Achilles', affiliation: 'independent', probability: 0.078 }] },
  { state: 'IL', raceType: 'regular', demProbability: 0.980, repProbability: 0.020, demCandidate: 'Juliana Stratton', repCandidate: 'Don Tracy' },
  { state: 'KS', raceType: 'regular', demProbability: 0.158, repProbability: 0.842, demCandidate: 'Democratic Party', repCandidate: 'Roger Marshall' },
  { state: 'KY', raceType: 'regular', demProbability: 0.053, repProbability: 0.947, demCandidate: 'Charles Booker', repCandidate: 'Andy Barr' },
  { state: 'LA', raceType: 'regular', demProbability: 0.061, repProbability: 0.939, demCandidate: 'Jamie Davis', repCandidate: 'Julia Letlow' },
  { state: 'MA', raceType: 'regular', demProbability: 0.965, repProbability: 0.035, demCandidate: 'Ed Markey', repCandidate: 'Republican Party' },
  { state: 'ME', raceType: 'regular', demProbability: 0.640, repProbability: 0.360, demCandidate: 'Troy Jackson', repCandidate: 'Susan Collins' },
  { state: 'MI', raceType: 'regular', demProbability: 0.657, repProbability: 0.343, demCandidate: 'Democratic Party', repCandidate: 'Republican Party' },
  { state: 'MN', raceType: 'regular', demProbability: 0.914, repProbability: 0.086, demCandidate: 'Democratic (DFL) Party', repCandidate: 'Republican Party' },
  { state: 'MS', raceType: 'regular', demProbability: 0.070, repProbability: 0.930, demCandidate: 'Scott Colom', repCandidate: 'Cindy Hyde-Smith' },
  { state: 'MT', raceType: 'regular', demProbability: 0.018, repProbability: 0.818, demCandidate: 'Alani Bankhead', repCandidate: 'Kurt Alme',
    otherTickers: [{ candidate: 'Seth Bodnar', affiliation: 'independent', probability: 0.164 }] },
  { state: 'NC', raceType: 'regular', demProbability: 0.901, repProbability: 0.099, demCandidate: 'Roy Cooper', repCandidate: 'Michael Whatley' },
  { state: 'NE', raceType: 'regular', demProbability: 0.003, repProbability: 0.718, demCandidate: 'Cindy Burbank', repCandidate: 'Pete Ricketts',
    otherTickers: [{ candidate: 'Dan Osborn', affiliation: 'independent', probability: 0.279 }] },
  { state: 'NH', raceType: 'regular', demProbability: 0.861, repProbability: 0.139, demCandidate: 'Democratic Party', repCandidate: 'Republican Party' },
  { state: 'NJ', raceType: 'regular', demProbability: 0.952, repProbability: 0.048, demCandidate: 'Cory Booker', repCandidate: 'Justin Murphy' },
  { state: 'NM', raceType: 'regular', demProbability: 0.961, repProbability: 0.039, demCandidate: 'Ben Ray Luján', repCandidate: 'Larry E. Marker' },
  { state: 'OH', raceType: 'special', demProbability: 0.535, repProbability: 0.465, demCandidate: 'Sherrod Brown', repCandidate: 'Jon Husted' },
  { state: 'OK', raceType: 'regular', demProbability: 0.040, repProbability: 0.960, demCandidate: 'Democratic Party', repCandidate: 'Kevin Hern' },
  { state: 'OR', raceType: 'regular', demProbability: 0.957, repProbability: 0.043, demCandidate: 'Jeff Merkley', repCandidate: 'David Brock Smith' },
  { state: 'RI', raceType: 'regular', demProbability: 0.955, repProbability: 0.045, demCandidate: 'Jack Reed', repCandidate: 'Republican Party' },
  { state: 'SC', raceType: 'regular', demProbability: 0.110, repProbability: 0.890, demCandidate: 'Annie Andrews', repCandidate: 'Republican Party' },
  { state: 'SD', raceType: 'regular', demProbability: 0.060, repProbability: 0.940, demCandidate: 'Julian Beaudion', repCandidate: 'Mike Rounds' },
  { state: 'TN', raceType: 'regular', demProbability: 0.035, repProbability: 0.965, demCandidate: 'Democratic Party', repCandidate: 'Bill Hagerty' },
  { state: 'TX', raceType: 'regular', demProbability: 0.455, repProbability: 0.545, demCandidate: 'James Talarico', repCandidate: 'Ken Paxton' },
  { state: 'VA', raceType: 'regular', demProbability: 0.955, repProbability: 0.045, demCandidate: 'Mark Warner', repCandidate: 'Republican Party' },
  { state: 'WV', raceType: 'regular', demProbability: 0.066, repProbability: 0.934, demCandidate: 'Rachel Fetty Anderson', repCandidate: 'Shelley Moore Capito' },
  { state: 'WY', raceType: 'regular', demProbability: 0.027, repProbability: 0.973, demCandidate: 'Democratic Party', repCandidate: 'Republican Party' }
];

export function isTossUp(demProbability) {
  return demProbability > TOSSUP_LOW && demProbability < TOSSUP_HIGH;
}

const GENERIC_CANDIDATE_LABELS = new Set(['Democratic Party', 'Republican Party', 'Democratic (DFL) Party']);

export function isPrimaryPending(candidateName) {
  return GENERIC_CANDIDATE_LABELS.has(candidateName);
}

export function raceHasPendingPrimary(race) {
  return isPrimaryPending(race.demCandidate) || isPrimaryPending(race.repCandidate);
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
  return Math.round(p * 100) + '%';
}

export function seatPartyResolved(seat) {
  return seat.party === 'I' ? seat.caucus : seat.party;
}

export function raceLeadParty(race) {
  return race.demProbability >= 0.5 ? 'D' : 'R';
}

// One entry per state: current/likely control, for the map.
export function buildStateSummaries() {
  const solidByState = {};
  SOLID_SEATS.forEach(s => {
    (solidByState[s.state] = solidByState[s.state] || []).push(s);
  });
  const raceByState = {};
  RACES.forEach(r => { raceByState[r.state] = r; });

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
