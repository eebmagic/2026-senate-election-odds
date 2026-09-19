// Chamber-control "vs yesterday"/"vs 7 days ago" change readout, shown
// top-right above the chamber-control gauge bar. Tracks the change in
// whichever party currently leads the majority-control market's own win
// probability (not a relative-percent figure), the same convention the
// "Biggest movers" tables use for individual races -- just applied to the
// one chamber-wide market instead of per-state ones.
//
// Independent of movers.js and the main render: fetches from the same
// public snapshot-index.json / snapshots/*.json in R2 (see
// scripts/r2_store.py) on its own, and degrades to a blank readout -- never
// a broken page -- if history isn't available yet.

const SNAPSHOT_INDEX_URL = 'https://election-data.ebolton.site/snapshot-index.json';
const SNAPSHOT_BASE_URL = 'https://election-data.ebolton.site/';

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// "YYYY-MM-DD" `deltaDays` earlier (negative deltaDays moves it later).
function shiftDate(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

// The entry in `days` with the latest date at or before `targetDate`
// (excluding `excludeKey`, the currently-displayed snapshot), or null if
// history doesn't reach back that far yet.
function pickDayAtOrBefore(days, targetDate, excludeKey) {
  let best = null;
  for (const day of days) {
    if (day.key === excludeKey) continue;
    if (day.date <= targetDate && (!best || day.date > best.date)) best = day;
  }
  return best;
}

const WINDOWS = [
  { daysAgo: 1, elId: 'gauge-change-today', label: 'yesterday' },
  { daysAgo: 7, elId: 'gauge-change-week', label: '7 days ago' }
];

// `party` is whichever party the delta is measured for (see
// renderChamberChange -- always the CURRENT leader, so this stays correct
// even if control of the lead flips). Shown as a small colored badge so the
// reader doesn't have to guess which party's probability moved, matching
// the badge convention in the "Biggest movers" tables.
function renderChange(elId, deltaPp, label, party) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (deltaPp == null) {
    el.innerHTML = '';
    el.className = 'gauge-change';
    return;
  }
  const gained = deltaPp > 0;
  const sign = gained ? '+' : deltaPp < 0 ? '−' : '±';
  const cls = party === 'D' ? 'dem' : 'rep';
  el.innerHTML = `<span class="gauge-change-badge ${cls}">${party}</span>${sign}${Math.abs(deltaPp).toFixed(1)} vs ${label}`;
  el.className = 'gauge-change' + (deltaPp === 0 ? '' : gained ? ' up' : ' down');
}

export async function renderChamberChange(data) {
  const cm = data.controlsMarket;
  if (!cm) return;
  const currentDate = (data.fetchedAt || '').slice(0, 10);
  const demLeads = (cm.demProbability || 0) >= (cm.repProbability || 0);
  const currProb = demLeads ? cm.demProbability : cm.repProbability;
  const party = demLeads ? 'D' : 'R';

  let days;
  try {
    days = (await fetchJson(SNAPSHOT_INDEX_URL)).days || [];
  } catch (e) {
    for (const w of WINDOWS) renderChange(w.elId, null, w.label, party);
    return;
  }

  await Promise.all(WINDOWS.map(async w => {
    const targetDate = shiftDate(currentDate, -w.daysAgo);
    const entry = pickDayAtOrBefore(days, targetDate, data.snapshotKey);
    if (!entry) {
      renderChange(w.elId, null, w.label, party);
      return;
    }
    try {
      const snapshotUrl = SNAPSHOT_BASE_URL + entry.key.split('/').map(encodeURIComponent).join('/');
      const previousCm = (await fetchJson(snapshotUrl)).controlsMarket;
      if (!previousCm) {
        renderChange(w.elId, null, w.label, party);
        return;
      }
      const prevProb = demLeads ? previousCm.demProbability : previousCm.repProbability;
      renderChange(w.elId, (currProb - prevProb) * 100, w.label, party);
    } catch (e) {
      renderChange(w.elId, null, w.label, party);
    }
  }));
}
