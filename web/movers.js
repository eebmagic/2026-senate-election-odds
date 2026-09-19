// "Biggest movers" tables: which races' leading candidate has gained or
// lost the most ground since yesterday and since 7 days ago (calendar days,
// UTC). Reads the live data's own snapshot history in the R2 bucket rather
// than anything computed server-side.
//
// script.py maintains snapshot-index.json (see scripts/r2_store.py) --
// {"days": [{"date", "key", "fetchedAt"}, ...]}, one entry per UTC calendar
// day (that day's last snapshot) -- because the bucket's public custom
// domain only serves individual objects, not the S3 list API, so the
// browser can't discover snapshot keys on its own. This module fetches that
// index once, looks up the closest available day at or before each target
// date, fetches just those two snapshots, and diffs each race's leading
// candidate's own win probability against the currently-displayed data --
// once per absolute (percentage-point) ranking and once per relative
// (percent-of-prior) ranking, off the same fetched pair.
//
// Design (table layout, column widths, badge/color treatment) follows
// biggest-movers-mock.html, a design-agent mock the repo owner reviewed and
// asked to have implemented in place of the previous candidate-vs-candidate
// card layout.
//
// Independent of app.js's main render: a missing/incomplete history (e.g.
// freshly deployed, or a target that predates the oldest snapshot) just
// hides the section or shows a per-table empty state -- it never blocks or
// breaks the rest of the page.

import { STATE_NAMES, escapeHtml } from './senate-shared.js';

const SNAPSHOT_INDEX_URL = 'https://election-data.ebolton.site/snapshot-index.json';
const SNAPSHOT_BASE_URL = 'https://election-data.ebolton.site/';

const MAX_ROWS = 10;
// Below this, a move is noise (e.g. price rounding) rather than a real swing
// -- applies to both tables (the relative table ranks by percent-of-prior,
// but still needs a percentage-point floor so a rounding blip on a tiny
// base, e.g. 0.1% -> 0.6%, can't rank as a "500% move").
const MIN_DELTA_PP = 0.5;

// One entry per comparison window (today/7-day). Each window renders into
// two tables that share the same pair of snapshots: `abs` (ranked by raw
// percentage-point change) and `rel` (ranked by change relative to the
// prior probability, so a 49% -> 52% swing outranks a 100% -> 95% one --
// the same 5-ish point move matters more the closer the race already was).
const WINDOWS = [
  {
    daysAgo: 1,
    abs: { bodyId: 'movers-today-body', rowsId: 'movers-today-rows', emptyId: 'movers-today-empty', vsId: 'movers-today-vs' },
    rel: { bodyId: 'relmovers-today-body', rowsId: 'relmovers-today-rows', emptyId: 'relmovers-today-empty', vsId: 'relmovers-today-vs' }
  },
  {
    daysAgo: 7,
    abs: { bodyId: 'movers-week-body', rowsId: 'movers-week-rows', emptyId: 'movers-week-empty', vsId: 'movers-week-vs' },
    rel: { bodyId: 'relmovers-week-body', rowsId: 'relmovers-week-rows', emptyId: 'relmovers-week-empty', vsId: 'relmovers-week-vs' }
  }
];

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

// "YYYY-MM-DD" -> "Sep 17".
function formatDateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// The entry in `days` with the latest date at or before `targetDate`
// (excluding `excludeKey`, the currently-displayed snapshot), or null if
// history doesn't reach back that far yet. Date strings are zero-padded
// ISO ("YYYY-MM-DD"), so plain string comparison orders them correctly.
function pickDayAtOrBefore(days, targetDate, excludeKey) {
  let best = null;
  for (const day of days) {
    if (day.key === excludeKey) continue;
    if (day.date <= targetDate && (!best || day.date > best.date)) best = day;
  }
  return best;
}

// Every race with a same-state match in both snapshots, as the CURRENT
// leader's own win probability (whichever party leads today) now vs. at the
// comparison snapshot -- not a Democratic-probability delta -- so "the
// leader gained/slipped" always means exactly what it says. Independent
// leaders aren't tracked (this only ever compares demProbability vs.
// repProbability, no otherTickers), so only D/R ever appear here. Both the
// absolute and relative tables rank a filtered/sorted view of this same
// list -- see `computeAbsoluteMovers`/`computeRelativeMovers` below.
function leaderDeltas(currentRaces, previousRaces) {
  const prevByState = new Map(previousRaces.map(r => [r.state, r]));
  const deltas = [];
  for (const race of currentRaces) {
    const prev = prevByState.get(race.state);
    if (!prev) continue; // race didn't exist yet in the comparison snapshot
    const demLeads = race.demProbability >= race.repProbability;
    const party = demLeads ? 'D' : 'R';
    const prevProb = demLeads ? prev.demProbability : prev.repProbability;
    const currProb = demLeads ? race.demProbability : race.repProbability;
    const deltaPp = (currProb - prevProb) * 100;
    if (Math.abs(deltaPp) < MIN_DELTA_PP) continue;
    deltas.push({ race, party, prevProb, currProb, deltaPp });
  }
  return deltas;
}

// Ranked by raw percentage-point change -- the original "biggest movers"
// metric.
function computeAbsoluteMovers(currentRaces, previousRaces) {
  const movers = leaderDeltas(currentRaces, previousRaces);
  movers.sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp));
  return movers.slice(0, MAX_ROWS);
}

// Ranked by change relative to the prior probability (deltaPp / prevProb),
// so equal-sized point moves rank higher the closer the race already was --
// a 49% -> 52% swing (a jump toward a toss-up) outranks a 100% -> 95% one
// (still a lock either way), even though the latter is a bigger raw move.
// A comparison starting at exactly 0% has no defined ratio and is dropped
// (it can never happen for a party that's currently leading in practice).
function computeRelativeMovers(currentRaces, previousRaces) {
  const movers = leaderDeltas(currentRaces, previousRaces)
    .filter(m => m.prevProb > 0)
    .map(m => ({ ...m, deltaPct: (m.deltaPp / (m.prevProb * 100)) * 100 }));
  movers.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
  return movers.slice(0, MAX_ROWS);
}

function rowHtml(mover, deltaField, deltaSuffix) {
  const { race, party, prevProb, currProb } = mover;
  const deltaValue = mover[deltaField];
  const gained = deltaValue > 0;
  const cls = party === 'D' ? 'dem' : 'rep';
  const deltaCls = gained ? 'up' : 'down';
  const sign = gained ? '+' : '−';
  const stateCode = escapeHtml(race.state);
  const stateName = escapeHtml(STATE_NAMES[race.state] || race.state);
  const name = escapeHtml((party === 'D' ? race.demCandidate : race.repCandidate) || party);
  const tag = race.kalshiUrl ? 'a' : 'div';
  const linkAttrs = race.kalshiUrl
    ? ` href="${escapeHtml(race.kalshiUrl)}" target="_blank" rel="noopener noreferrer"`
    : '';
  return `<${tag} class="mover-row ${cls}"${linkAttrs}>
    <div class="mover-state"><span class="full-label">${stateName}</span><span class="short-label">${stateCode}</span></div>
    <div class="mover-candidate">
      <span class="mover-badge ${cls}">${party}</span>
      <span class="mover-name ${cls}">${name}</span>
    </div>
    <div class="mover-prev">${Math.round(prevProb * 100)}%</div>
    <div class="mover-arrow">&rarr;</div>
    <div class="mover-now">${Math.round(currProb * 100)}%</div>
    <div class="mover-delta ${deltaCls}">${sign}${Math.abs(deltaValue).toFixed(1)}${deltaSuffix}</div>
  </${tag}>`;
}

function renderTable(rowsId, emptyId, movers, deltaField, deltaSuffix, emptyMessage) {
  const rowsEl = document.getElementById(rowsId);
  const emptyEl = document.getElementById(emptyId);
  if (!rowsEl || !emptyEl) return;
  if (!movers.length) {
    rowsEl.innerHTML = '';
    emptyEl.textContent = emptyMessage;
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  rowsEl.innerHTML = movers.map(m => rowHtml(m, deltaField, deltaSuffix)).join('');
}

// Desktop shows a pair of tables side by side, so a short table (fewer
// notable movers) shouldn't end up visibly shorter than its neighbor.
// min-height is reset before measuring so a re-render (e.g. next data
// refresh) doesn't compound on the previous equalization, and the narrow
// (<720px, stacked) layout overrides it back to 0 in CSS.
function equalizeBodyHeights(ids) {
  const els = ids.map(id => document.getElementById(id)).filter(Boolean);
  if (els.length < 2) return;
  els.forEach(el => { el.style.minHeight = ''; });
  const maxHeight = Math.max(...els.map(el => el.offsetHeight));
  els.forEach(el => { el.style.minHeight = maxHeight + 'px'; });
}

export async function renderMovers(data) {
  const absSection = document.getElementById('movers-section');
  const relSection = document.getElementById('relative-movers-section');
  if (!absSection && !relSection) return;
  try {
    const index = await fetchJson(SNAPSHOT_INDEX_URL);
    const days = index.days || [];
    const currentDate = (data.fetchedAt || '').slice(0, 10);
    const currentRaces = data.races || [];

    const snapshotLine = document.getElementById('movers-snapshot-line');
    if (snapshotLine) {
      const time = new Date(data.fetchedAt).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', timeZone: 'UTC'
      });
      snapshotLine.textContent = `Snapshot taken ${formatDateLabel(currentDate)}, ${data.fetchedAt.slice(0, 4)} ${time} UTC.`;
    }

    for (const w of WINDOWS) {
      const targetDate = shiftDate(currentDate, -w.daysAgo);
      const comparisonEntry = pickDayAtOrBefore(days, targetDate, data.snapshotKey);
      const vsText = comparisonEntry ? `changes since ${formatDateLabel(comparisonEntry.date)}` : '';
      const absVsEl = document.getElementById(w.abs.vsId);
      const relVsEl = document.getElementById(w.rel.vsId);
      if (absVsEl) absVsEl.textContent = vsText;
      if (relVsEl) relVsEl.textContent = vsText;

      if (!comparisonEntry) {
        renderTable(w.abs.rowsId, w.abs.emptyId, [], 'deltaPp', '', 'Not enough history yet.');
        renderTable(w.rel.rowsId, w.rel.emptyId, [], 'deltaPct', '%', 'Not enough history yet.');
        continue;
      }
      try {
        const snapshotUrl = SNAPSHOT_BASE_URL
          + comparisonEntry.key.split('/').map(encodeURIComponent).join('/');
        const previous = await fetchJson(snapshotUrl);
        const previousRaces = previous.races || [];
        renderTable(w.abs.rowsId, w.abs.emptyId, computeAbsoluteMovers(currentRaces, previousRaces), 'deltaPp', '', 'No notable movement.');
        renderTable(w.rel.rowsId, w.rel.emptyId, computeRelativeMovers(currentRaces, previousRaces), 'deltaPct', '%', 'No notable movement.');
      } catch (e) {
        renderTable(w.abs.rowsId, w.abs.emptyId, [], 'deltaPp', '', 'Unable to load comparison data.');
        renderTable(w.rel.rowsId, w.rel.emptyId, [], 'deltaPct', '%', 'Unable to load comparison data.');
      }
    }
    if (absSection) absSection.style.display = 'block';
    if (relSection) relSection.style.display = 'block';
    equalizeBodyHeights(WINDOWS.map(w => w.abs.bodyId));
    equalizeBodyHeights(WINDOWS.map(w => w.rel.bodyId));
  } catch (e) {
    // No snapshot-index.json yet (fresh deploy, ahead of the next script.py
    // run) or it failed to load -- hide both sections rather than show
    // permanently-broken tables.
    if (absSection) absSection.style.display = 'none';
    if (relSection) relSection.style.display = 'none';
  }
}
