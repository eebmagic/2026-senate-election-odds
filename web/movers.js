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
// candidate's own win probability against the currently-displayed data.
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
// -- a percentage-point floor, checked before the relative ranking below, so
// a rounding blip on a tiny base (e.g. 0.1% -> 0.6%) can't rank as a "500%
// move". Kept low (rather than the old 0.5pp) since prev/now now render to
// one decimal place -- see rowHtml -- so a real tenth-of-a-point move is
// visible instead of looking like a false "no change".
const MIN_DELTA_PP = 0.1;

const TABLES = [
  { daysAgo: 1, bodyId: 'movers-today-body', rowsId: 'movers-today-rows', emptyId: 'movers-today-empty', vsId: 'movers-today-vs' },
  { daysAgo: 7, bodyId: 'movers-week-body', rowsId: 'movers-week-rows', emptyId: 'movers-week-empty', vsId: 'movers-week-vs' }
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

// "YYYY-MM-DD" -> "Thursday, Sep 17" -- used for the per-table "changes
// since" subtitle, where the day of the week disambiguates "yesterday"/
// "7 days ago" without the reader having to do date math against today.
function formatDateWithWeekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
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

// Ranks by the CURRENT leader's own win probability move (whichever party
// leads today, its probability now vs. at the comparison snapshot) relative
// to how far it had to move, not the raw percentage-point delta -- so a
// 49% -> 52% swing (toward a toss-up) outranks a 100% -> 95% one (still a
// lock either way), even though the latter is the bigger raw move. That
// relative figure (`deltaPct`) is used only to rank/select the top movers;
// the "Change" column itself displays the raw percentage-point delta
// (`deltaPp`), since a relative-percent figure reads as confusing next to
// two probabilities that are themselves percentages -- see rowHtml. Rows
// under 0.5pp of raw movement are dropped as noise first; a comparison
// starting at exactly 0% has no defined ratio and is dropped too (it can't
// happen in practice for a party that's currently leading). Independent
// leaders aren't tracked (this only ever compares demProbability vs.
// repProbability, no otherTickers), so only D/R ever appear here.
function computeMovers(currentRaces, previousRaces) {
  const prevByState = new Map(previousRaces.map(r => [r.state, r]));
  const movers = [];
  for (const race of currentRaces) {
    const prev = prevByState.get(race.state);
    if (!prev) continue; // race didn't exist yet in the comparison snapshot
    const demLeads = race.demProbability >= race.repProbability;
    const party = demLeads ? 'D' : 'R';
    const prevProb = demLeads ? prev.demProbability : prev.repProbability;
    const currProb = demLeads ? race.demProbability : race.repProbability;
    const deltaPp = (currProb - prevProb) * 100;
    if (Math.abs(deltaPp) < MIN_DELTA_PP) continue;
    if (prevProb <= 0) continue;
    const deltaPct = (deltaPp / (prevProb * 100)) * 100;
    movers.push({ race, party, prevProb, currProb, deltaPp, deltaPct });
  }
  movers.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
  return movers.slice(0, MAX_ROWS);
}

function rowHtml({ race, party, prevProb, currProb, deltaPp }) {
  const gained = deltaPp > 0;
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
    <div class="mover-prev">${(prevProb * 100).toFixed(1)}%</div>
    <div class="mover-arrow">&rarr;</div>
    <div class="mover-now">${(currProb * 100).toFixed(1)}%</div>
    <div class="mover-delta ${deltaCls}">${sign}${Math.abs(deltaPp).toFixed(1)}</div>
  </${tag}>`;
}

function renderTable(rowsId, emptyId, movers, emptyMessage) {
  const rowsEl = document.getElementById(rowsId);
  const emptyEl = document.getElementById(emptyId);
  if (!movers.length) {
    rowsEl.innerHTML = '';
    emptyEl.textContent = emptyMessage;
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  rowsEl.innerHTML = movers.map(rowHtml).join('');
}

// Desktop shows the two tables side by side, so a short table (fewer
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
  const section = document.getElementById('movers-section');
  if (!section) return;
  try {
    const index = await fetchJson(SNAPSHOT_INDEX_URL);
    const days = index.days || [];
    const currentDate = (data.fetchedAt || '').slice(0, 10);
    const currentRaces = data.races || [];

    for (const t of TABLES) {
      const vsEl = document.getElementById(t.vsId);
      const targetDate = shiftDate(currentDate, -t.daysAgo);
      const comparisonEntry = pickDayAtOrBefore(days, targetDate, data.snapshotKey);
      if (!comparisonEntry) {
        if (vsEl) vsEl.textContent = '';
        renderTable(t.rowsId, t.emptyId, [], 'Not enough history yet.');
        continue;
      }
      if (vsEl) vsEl.textContent = `changes since ${formatDateWithWeekday(comparisonEntry.date)}`;
      try {
        const snapshotUrl = SNAPSHOT_BASE_URL
          + comparisonEntry.key.split('/').map(encodeURIComponent).join('/');
        const previous = await fetchJson(snapshotUrl);
        const movers = computeMovers(currentRaces, previous.races || []);
        renderTable(t.rowsId, t.emptyId, movers, 'No notable movement.');
      } catch (e) {
        renderTable(t.rowsId, t.emptyId, [], 'Unable to load comparison data.');
      }
    }
    section.style.display = 'block';
    equalizeBodyHeights(TABLES.map(t => t.bodyId));
  } catch (e) {
    // No snapshot-index.json yet (fresh deploy, ahead of the next script.py
    // run) or it failed to load -- hide the section rather than show two
    // permanently-broken tables.
    section.style.display = 'none';
  }
}
