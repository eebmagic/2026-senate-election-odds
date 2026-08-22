// Fetches the live data artifact and renders the chamber-control gauge and
// the seat spectrum bar. Ported from design_handoff_senate_tracker's
// Senate Tracker.dc.html (its renderVals() derivation + <x-dc> template),
// using plain DOM instead of the prototype's streaming-component runtime.
// The wide (>=720px) and narrow (<720px) layouts are both built up front and
// switched with a CSS media query (see index.html) rather than a JS resize
// listener -- the README calls this out as the cleaner production approach
// since none of the layout math below depends on pixel width, only percentages.

import {
  SOLID_SEATS,
  colorForDemProb,
  fmtPct,
  seatPartyResolved,
  isMaterialIndependent,
  raceHasPendingPrimary
} from './senate-shared.js';
import { renderMap } from './map.js';

const CONTESTED_UNITS = 130;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tooltipHtml(payload) {
  const rows = payload.rows.map(r =>
    `<div class="row"><span>${escapeHtml(r.label)}</span><span class="value">${escapeHtml(r.value)}</span></div>`
  ).join('');
  return `<div class="title">${escapeHtml(payload.title)}</div>${rows}`;
}

function wireTooltip(containerEl, tooltipEl) {
  let active = false;

  function show(payload, event) {
    active = true;
    tooltipEl.innerHTML = tooltipHtml(payload);
    tooltipEl.style.display = 'block';
    move(event);
  }
  function move(event) {
    if (!active) return;
    const rect = containerEl.getBoundingClientRect();
    tooltipEl.style.left = (event.clientX - rect.left) + 'px';
    tooltipEl.style.top = (event.clientY - rect.top) + 'px';
  }
  function hide() {
    active = false;
    tooltipEl.style.display = 'none';
  }

  containerEl.addEventListener('mousemove', move);
  return { show, hide };
}

function buildRaceTooltip(r) {
  const rows = [
    { label: r.demCandidate + (r.demPrimaryPending ? ' (primary TBD)' : ''), value: 'D ' + fmtPct(r.demProbability) },
    { label: r.repCandidate + (r.repPrimaryPending ? ' (primary TBD)' : ''), value: 'R ' + fmtPct(r.repProbability) }
  ];
  if (isMaterialIndependent(r)) {
    r.otherTickers.forEach(o => rows.push({ label: o.candidate + ' (I)', value: fmtPct(o.probability) }));
  }
  let title = r.state + (r.raceType === 'special' ? ' — special election' : '');
  if (r.stale) title += ' (as of ' + formatDate(r.staleSince) + ')';
  return { title, rows };
}

function makeContestedSeg(r) {
  const leadDem = r.demProbability >= 0.5;
  return {
    state: r.state,
    race: r,
    color: colorForDemProb(r.demProbability),
    leadLabel: Math.round(Math.max(r.demProbability, r.repProbability) * 100),
    leadParty: leadDem ? 'D' : 'R',
    showIndependentMark: isMaterialIndependent(r),
    showPendingMark: raceHasPendingPrimary(r),
    tooltip: buildRaceTooltip(r)
  };
}

function formatDate(iso) {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
}

function computeVals(data) {
  const races = data.races || [];
  const dSolids = SOLID_SEATS.filter(s => seatPartyResolved(s) === 'D').sort((a, b) => a.state.localeCompare(b.state));
  const rSolids = SOLID_SEATS.filter(s => seatPartyResolved(s) === 'R').sort((a, b) => a.state.localeCompare(b.state));
  const contested = [...races].sort((a, b) => b.demProbability - a.demProbability);
  const segments = contested.map(makeContestedSeg);

  const demSolidCount = dSolids.length;
  const repSolidCount = rSolids.length;
  const totalUnits = demSolidCount + repSolidCount + CONTESTED_UNITS;
  const demSolidLabelPos = (demSolidCount / totalUnits / 2) * 100;
  const repSolidLabelPos = 100 - (repSolidCount / totalUnits / 2) * 100;
  const demBlockPct = (demSolidCount / totalUnits) * 100;
  const contestedPct = (CONTESTED_UNITS / totalUnits) * 100;
  const seatsIntoContested = 50 - demSolidCount;
  const majorityLinePos = demBlockPct + (seatsIntoContested / contested.length) * contestedPct;

  const demBlockTooltip = { title: demSolidCount + ' Democratic seats not up in 2026', rows: dSolids.map(s => ({ label: s.state, value: s.senator })) };
  const repBlockTooltip = { title: repSolidCount + ' Republican seats not up in 2026', rows: rSolids.map(s => ({ label: s.state, value: s.senator })) };

  const cm = data.controlsMarket || { demProbability: 0.5, repProbability: 0.5 };
  const demPct = Math.round(cm.demProbability * 1000) / 10;
  const repPct = Math.round(cm.repProbability * 1000) / 10;

  const fetchedDate = new Date(data.fetchedAt);
  const fetchedAtLabel = isNaN(fetchedDate)
    ? data.fetchedAt
    : fetchedDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

  return {
    races, segments, demSolidCount, repSolidCount,
    demSolidLabelPos, repSolidLabelPos, majorityLinePos,
    demBlockFlex: demSolidCount + ' 1 0%',
    repBlockFlex: repSolidCount + ' 1 0%',
    contestedWrapFlex: CONTESTED_UNITS + ' 1 0%',
    demBlockTooltip, repBlockTooltip,
    demPct, repPct,
    demPctLabel: 'Democratic ' + fmtPct(cm.demProbability),
    repPctLabel: 'Republican ' + fmtPct(cm.repProbability),
    fetchedAtLabel,
    failedStates: data.failedStates || []
  };
}

function segHtmlWide(seg, i) {
  return `
    <div class="seg-wide" style="background:${seg.color};" data-seg-index="${i}">
      <span class="seg-label-stack">
        <span class="seg-state">${escapeHtml(seg.state)}</span>
        <span class="seg-pct">${seg.leadLabel}</span>
        <span class="seg-party">${seg.leadParty}</span>
      </span>
      ${seg.showIndependentMark ? '<span class="ind-mark-h"></span>' : ''}
      ${seg.showPendingMark ? '<span class="pending-mark-h"></span>' : ''}
    </div>`;
}

function segHtmlNarrow(seg, i) {
  return `
    <div class="seg-narrow" style="background:${seg.color};" data-seg-index="${i}">
      <span class="seg-state">${escapeHtml(seg.state)}</span>
      <span class="seg-pct">${seg.leadLabel}</span>
      <span class="seg-party">${seg.leadParty}</span>
      ${seg.showIndependentMark ? '<span class="ind-mark-v"></span>' : ''}
      ${seg.showPendingMark ? '<span class="pending-mark-v"></span>' : ''}
    </div>`;
}

function renderGauge(vals) {
  const demEl = document.getElementById('gauge-dem');
  const repEl = document.getElementById('gauge-rep');
  demEl.style.width = vals.demPct + '%';
  repEl.style.width = vals.repPct + '%';
  demEl.textContent = vals.demPctLabel;
  repEl.textContent = vals.repPctLabel;
}

function renderWideBar(vals) {
  const container = document.getElementById('bar-wide-container');
  container.innerHTML = `
    <div class="bar-wrap-wide" id="bar-wide">
      <div class="callout" style="left:${vals.majorityLinePos}%; color:#211f1c;">51 seats to control</div>
      <div class="callout" style="left:${vals.demSolidLabelPos}%; color:#1c3f7a;">${vals.demSolidCount} D seats not up</div>
      <div class="callout" style="left:${vals.repSolidLabelPos}%; color:#8a2a22;">${vals.repSolidCount} R seats not up</div>
      <div class="bar-wide">
        <div class="solid-block dem" style="flex:${vals.demBlockFlex};" data-tip="dem-solid"></div>
        <div class="contested-wrap-wide" style="flex:${vals.contestedWrapFlex};">
          ${vals.segments.map(segHtmlWide).join('')}
        </div>
        <div class="solid-block rep" style="flex:${vals.repBlockFlex};" data-tip="rep-solid"></div>
      </div>
      <div class="majority-line-wide" style="left:${vals.majorityLinePos}%;"></div>
      <div class="tooltip" id="tooltip-wide"></div>
    </div>`;

  const barEl = document.getElementById('bar-wide');
  const tooltipEl = document.getElementById('tooltip-wide');
  const tip = wireTooltip(barEl, tooltipEl);

  barEl.querySelector('[data-tip="dem-solid"]').addEventListener('mouseenter', e => tip.show(vals.demBlockTooltip, e));
  barEl.querySelector('[data-tip="rep-solid"]').addEventListener('mouseenter', e => tip.show(vals.repBlockTooltip, e));
  barEl.querySelectorAll('[data-tip="dem-solid"], [data-tip="rep-solid"]').forEach(el => el.addEventListener('mouseleave', tip.hide));
  barEl.querySelectorAll('.seg-wide').forEach(el => {
    const seg = vals.segments[Number(el.dataset.segIndex)];
    el.addEventListener('mouseenter', e => tip.show(seg.tooltip, e));
    el.addEventListener('mouseleave', tip.hide);
  });
}

function renderNarrowBar(vals) {
  const container = document.getElementById('bar-narrow-container');
  container.innerHTML = `
    <div class="bar-wrap-narrow">
      <div class="bar-inner-narrow" id="bar-narrow">
        <div class="solid-caption dem">${vals.demSolidCount} D seats not up</div>
        <div class="bar-track-narrow">
          <div class="bar-narrow">
            <div class="solid-block-narrow dem" style="flex:${vals.demBlockFlex};" data-tip="dem-solid"></div>
            <div class="contested-wrap-narrow" style="flex:${vals.contestedWrapFlex};">
              ${vals.segments.map(segHtmlNarrow).join('')}
            </div>
            <div class="solid-block-narrow rep" style="flex:${vals.repBlockFlex};" data-tip="rep-solid"></div>
          </div>
          <div class="majority-line-narrow" style="top:${vals.majorityLinePos}%;"></div>
          <div class="majority-label-narrow" style="top:${vals.majorityLinePos}%;">51 to control</div>
        </div>
        <div class="solid-caption rep">${vals.repSolidCount} R seats not up</div>
        <div class="tooltip" id="tooltip-narrow"></div>
      </div>
    </div>`;

  const barEl = document.getElementById('bar-narrow');
  const tooltipEl = document.getElementById('tooltip-narrow');
  const tip = wireTooltip(barEl, tooltipEl);

  barEl.querySelector('[data-tip="dem-solid"]').addEventListener('mouseenter', e => tip.show(vals.demBlockTooltip, e));
  barEl.querySelector('[data-tip="rep-solid"]').addEventListener('mouseenter', e => tip.show(vals.repBlockTooltip, e));
  barEl.querySelectorAll('[data-tip="dem-solid"], [data-tip="rep-solid"]').forEach(el => el.addEventListener('mouseleave', tip.hide));
  barEl.querySelectorAll('.seg-narrow').forEach(el => {
    const seg = vals.segments[Number(el.dataset.segIndex)];
    el.addEventListener('mouseenter', e => tip.show(seg.tooltip, e));
    el.addEventListener('mouseleave', tip.hide);
  });
}

function renderMeta(vals) {
  const label = document.getElementById('fetched-at-label');
  label.textContent = 'Updated ' + vals.fetchedAtLabel;
  if (vals.failedStates.length) {
    const note = document.createElement('div');
    note.className = 'stale';
    note.textContent = `Showing last-known data for ${vals.failedStates.join(', ')}`;
    label.parentElement.appendChild(note);
  }
}

function render(data) {
  document.getElementById('status').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  const vals = computeVals(data);
  renderMeta(vals);
  renderGauge(vals);
  renderWideBar(vals);
  renderNarrowBar(vals);
  renderMap(vals.races);
}

function showError(err) {
  const statusEl = document.getElementById('status');
  const detail = err && err.message ? ': ' + err.message : '';
  statusEl.textContent = 'Unable to load market data' + detail + '. Try refreshing the page.';
  statusEl.classList.add('error');
}

async function main() {
  try {
    const res = await fetch('./live-senate-data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    render(data);
  } catch (err) {
    showError(err);
  }
}

main();
