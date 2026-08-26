import {
  SOLID_SEATS,
  STATE_NAMES,
  colorForDemProb,
  fmtPct,
  seatPartyResolved,
  isMaterialIndependent,
  raceAxisProb,
  raceLeader,
  raceHasPendingPrimary,
  STRONG_LEAN,
  isTouchDevice,
  HIDE_DELAY_MS
} from './senate-shared.js';
import { renderMap } from './map.js';

const CONTESTED_UNITS = 130;

const GROUP_GAP_UNITS = 0.9;

const LEAN_GAP_UNITS = 0.45;

const NARROW_TRACK_HEIGHT = 900;
const NARROW_SOLID_BLOCK_HEIGHT = 60;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rowValueHtml(r) {
  if (r.party !== undefined) {
    return `<span class="value split"><span class="party">${escapeHtml(r.party)}</span><span class="pct">${escapeHtml(r.pct)}</span></span>`;
  }
  return `<span class="value">${escapeHtml(r.value)}</span>`;
}

function tooltipHtml(payload) {
  const rows = payload.rows.map(r =>
    `<div class="row"><span>${escapeHtml(r.label)}</span>${rowValueHtml(r)}</div>`
  ).join('');
  const hint = payload.href
    ? `<a class="hint" href="${escapeHtml(payload.href)}" target="_blank" rel="noopener noreferrer">${isTouchDevice ? 'Tap again to view on ' : 'Click to view on '}<span class="hint-link">Kalshi ↗</span></a>`
    : '';
  return `<div class="title">${escapeHtml(payload.title)}</div><div class="rows">${rows}</div>${hint}`;
}

function wireTooltip(containerEl, tooltipEl, { anchorToRow = false } = {}) {
  let active = false;
  let armedEl = null;
  let activeTriggerEl = null;
  let hideTimer = null;

  function cancelHide() {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }
  function scheduleHide() {
    cancelHide();
    hideTimer = setTimeout(hide, HIDE_DELAY_MS);
  }

  function show(payload, event, el) {
    cancelHide();
    active = true;
    activeTriggerEl = el || null;
    tooltipEl.innerHTML = tooltipHtml(payload);
    tooltipEl.classList.toggle('scrollable', !!payload.scrollable);
    tooltipEl.style.display = 'block';
    if (anchorToRow && el) {
      positionAboveOrBelowRow(el);
    } else {
      tooltipEl.classList.remove('below');
      move(event);
    }
  }
  function move(event) {
    if (!active || anchorToRow) return;
    if (event.type === 'mousemove' && tooltipEl.classList.contains('scrollable')) return;
    const rect = containerEl.getBoundingClientRect();
    tooltipEl.style.left = (event.clientX - rect.left) + 'px';
    tooltipEl.style.top = (event.clientY - rect.top) + 'px';
    clampToViewport();
  }

  function positionAboveOrBelowRow(el) {
    const containerRect = containerEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const gap = 4;
    const centerX = (elRect.left + elRect.width / 2) - containerRect.left;

    tooltipEl.classList.remove('below');
    tooltipEl.style.left = centerX + 'px';
    tooltipEl.style.top = (elRect.top - gap - containerRect.top) + 'px';

    const tHeight = tooltipEl.getBoundingClientRect().height;
    const spaceAbove = elRect.top;
    const spaceBelow = window.innerHeight - elRect.bottom;

    if (spaceAbove < tHeight + gap && spaceBelow > spaceAbove) {
      tooltipEl.classList.add('below');
      tooltipEl.style.top = (elRect.bottom + gap - containerRect.top) + 'px';
    }

    clampToViewport();
    pointTailAt(centerX);
  }

  function pointTailAt(targetCenterX) {
    const containerRect = containerEl.getBoundingClientRect();
    const tRect = tooltipEl.getBoundingClientRect();
    const tooltipLeft = tRect.left - containerRect.left;
    const margin = 10;
    const tailX = Math.max(margin, Math.min(tRect.width - margin, targetCenterX - tooltipLeft));
    tooltipEl.style.setProperty('--tail-x', tailX + 'px');
  }

  function clampToViewport() {
    const margin = 8;
    const tRect = tooltipEl.getBoundingClientRect();
    let dx = 0, dy = 0;
    if (tRect.left < margin) dx = margin - tRect.left;
    else if (tRect.right > window.innerWidth - margin) dx = (window.innerWidth - margin) - tRect.right;
    if (tRect.top < margin) dy = margin - tRect.top;
    else if (tRect.bottom > window.innerHeight - margin) dy = (window.innerHeight - margin) - tRect.bottom;
    if (dx || dy) {
      tooltipEl.style.left = (parseFloat(tooltipEl.style.left) + dx) + 'px';
      tooltipEl.style.top = (parseFloat(tooltipEl.style.top) + dy) + 'px';
    }
  }
  function hide() {
    cancelHide();
    active = false;
    armedEl = null;
    activeTriggerEl = null;
    tooltipEl.style.display = 'none';
    tooltipEl.classList.remove('below');
  }

  if (!anchorToRow) {
    containerEl.addEventListener('mousemove', move);
  }

  if (isTouchDevice) {
    document.addEventListener('click', e => {
      if (!containerEl.contains(e.target)) hide();
    });
  }

  tooltipEl.addEventListener('mouseenter', () => cancelHide());
  tooltipEl.addEventListener('mouseleave', e => {
    if (!active) return;
    if (activeTriggerEl && e.relatedTarget === activeTriggerEl) return;
    scheduleHide();
  });

  function bindHover(el, payload) {
    if (isTouchDevice) {
      el.addEventListener('click', e => { e.preventDefault(); show(payload, e, el); });
    } else {
      el.addEventListener('mouseenter', e => show(payload, e, el));
      el.addEventListener('mouseleave', e => {
        if (e.relatedTarget && tooltipEl.contains(e.relatedTarget)) return;
        scheduleHide();
      });
    }
  }

  function bindLink(el, payload) {
    if (isTouchDevice) {
      el.addEventListener('click', e => {
        if (armedEl !== el) {
          e.preventDefault();
          show(payload, e, el);
          armedEl = el;
        }
      });
    } else {
      el.addEventListener('mouseenter', e => show(payload, e, el));
      el.addEventListener('mouseleave', e => {
        if (e.relatedTarget && tooltipEl.contains(e.relatedTarget)) return;
        scheduleHide();
      });
    }
  }

  return { bindHover, bindLink, hide };
}

function buildRaceTooltip(r) {
  const rows = [
    { label: r.demCandidate + (r.demPrimaryPending ? ' (primary TBD)' : ''), party: 'D', pct: fmtPct(r.demProbability), probability: r.demProbability },
    { label: r.repCandidate + (r.repPrimaryPending ? ' (primary TBD)' : ''), party: 'R', pct: fmtPct(r.repProbability), probability: r.repProbability }
  ];
  if (isMaterialIndependent(r)) {
    r.otherTickers.forEach(o => rows.push({ label: o.candidate + ' (I)', party: '', pct: fmtPct(o.probability), probability: o.probability }));
  }
  rows.sort((a, b) => b.probability - a.probability);
  let title = (STATE_NAMES[r.state] || r.state) + (r.raceType === 'special' ? ' — special election' : '');
  if (r.stale) title += ' (as of ' + formatDate(r.staleSince) + ')';
  return { title, rows, href: r.kalshiUrl };
}

function makeContestedSeg(r) {
  const leader = raceLeader(r);
  return {
    state: r.state,
    race: r,
    href: r.kalshiUrl,
    color: colorForDemProb(raceAxisProb(r)),
    leadLabel: Math.round(leader.probability * 100),
    leadProb: leader.probability,
    leadParty: leader.party,
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

function groupGeometry(segments) {
  const n = segments.length;
  const isStrong = (seg, party) => seg.leadParty === party && seg.leadProb >= STRONG_LEAN;

  let strongDemCount = 0;
  while (strongDemCount < n && isStrong(segments[strongDemCount], 'D')) strongDemCount++;
  let strongRepCount = 0;
  while (strongRepCount < n - strongDemCount && isStrong(segments[n - 1 - strongRepCount], 'R')) strongRepCount++;
  const repGroupStart = n - strongRepCount;

  let flipIndex = 0;
  while (flipIndex < n && segments[flipIndex].leadParty === 'D') flipIndex++;
  const hasFlip = flipIndex > 0 && flipIndex < n;

  const gapSpecs = [];
  if (strongDemCount > 0 && strongDemCount < n) {
    gapSpecs.push({ index: strongDemCount, units: GROUP_GAP_UNITS, above: 'Strong D', below: null });
  }
  if (strongRepCount > 0 && repGroupStart > 0) {
    gapSpecs.push({ index: repGroupStart, units: GROUP_GAP_UNITS, above: null, below: 'Strong R' });
  }
  if (hasFlip) {
    gapSpecs.push({ index: flipIndex, units: LEAN_GAP_UNITS, above: null, below: null });
  }

  const gaps = [];
  for (const spec of gapSpecs) {
    const existing = gaps.find(g => g.index === spec.index);
    if (!existing) {
      gaps.push({ ...spec });
      continue;
    }
    existing.units = Math.max(existing.units, spec.units);
    existing.above = existing.above || spec.above;
    existing.below = existing.below || spec.below;
  }
  gaps.sort((a, b) => a.index - b.index);

  const totalUnits = n + gaps.reduce((sum, g) => sum + g.units, 0);
  const edgeUnits = i => i + gaps.filter(g => g.index <= i).reduce((sum, g) => sum + g.units, 0);

  const flipGap = hasFlip ? gaps.find(g => g.index === flipIndex) : null;

  return {
    gaps,
    totalUnits,
    edgeUnits,
    strongDem: strongDemCount > 0 ? { startUnits: 0, endUnits: strongDemCount } : null,
    strongRep: strongRepCount > 0 ? { startUnits: edgeUnits(repGroupStart), endUnits: totalUnits } : null,
    flipUnits: flipGap ? edgeUnits(flipIndex) - flipGap.units / 2 : null
  };
}

function computeVals(data) {
  const races = data.races || [];
  const dSolids = SOLID_SEATS.filter(s => seatPartyResolved(s) === 'D').sort((a, b) => a.state.localeCompare(b.state));
  const rSolids = SOLID_SEATS.filter(s => seatPartyResolved(s) === 'R').sort((a, b) => a.state.localeCompare(b.state));
  const contested = [...races].sort((a, b) => raceAxisProb(b) - raceAxisProb(a));
  const segments = contested.map(makeContestedSeg);

  const demSolidCount = dSolids.length;
  const repSolidCount = rSolids.length;
  const totalUnits = demSolidCount + repSolidCount + CONTESTED_UNITS;
  const demSolidLabelPos = (demSolidCount / totalUnits / 2) * 100;
  const repSolidLabelPos = 100 - (repSolidCount / totalUnits / 2) * 100;
  const demBlockPct = (demSolidCount / totalUnits) * 100;
  const contestedPct = (CONTESTED_UNITS / totalUnits) * 100;
  const geom = groupGeometry(segments);
  const widePct = u => demBlockPct + (u / geom.totalUnits) * contestedPct;

  const narrowContestedHeight = NARROW_TRACK_HEIGHT - 2 * NARROW_SOLID_BLOCK_HEIGHT;
  const narrowPct = u => ((NARROW_SOLID_BLOCK_HEIGHT + (u / geom.totalUnits) * narrowContestedHeight) / NARROW_TRACK_HEIGHT) * 100;

  const seatsIntoContested = 50 - demSolidCount;
  const majorityLinePos = widePct(geom.edgeUnits(seatsIntoContested));
  const majorityLinePosNarrow = narrowPct(geom.edgeUnits(seatsIntoContested));

  const wideGroup = g => g && { pos: widePct(g.startUnits), size: widePct(g.endUnits) - widePct(g.startUnits) };
  const narrowGroup = g => g && { pos: narrowPct(g.startUnits), size: narrowPct(g.endUnits) - narrowPct(g.startUnits) };
  const strongGroups = [
    { key: 'dem', label: 'Strong D', wide: wideGroup(geom.strongDem), narrow: narrowGroup(geom.strongDem) },
    { key: 'rep', label: 'Strong R', wide: wideGroup(geom.strongRep), narrow: narrowGroup(geom.strongRep) }
  ].filter(g => g.wide);
  const leanPos = geom.flipUnits === null ? null : widePct(geom.flipUnits);
  const leanPosNarrow = geom.flipUnits === null ? null : narrowPct(geom.flipUnits);

  const demBlockTooltip = { title: demSolidCount + ' Democratic seats not up in 2026', rows: dSolids.map(s => ({ label: s.state, value: s.senator })), scrollable: true };
  const repBlockTooltip = { title: repSolidCount + ' Republican seats not up in 2026', rows: rSolids.map(s => ({ label: s.state, value: s.senator })), scrollable: true };

  const cm = data.controlsMarket || { demProbability: 0.5, repProbability: 0.5 };
  const controlsHref = cm.kalshiUrl || '';
  const demPct = Math.round(cm.demProbability * 1000) / 10;
  const repPct = Math.round(cm.repProbability * 1000) / 10;

  const fetchedDate = new Date(data.fetchedAt);
  const fetchedAtLabel = isNaN(fetchedDate)
    ? data.fetchedAt
    : fetchedDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

  return {
    races, segments, demSolidCount, repSolidCount,
    gaps: geom.gaps.map(g => ({ ...g, flex: g.units + ' 1 0%' })),
    strongGroups, leanPos, leanPosNarrow,
    demSolidLabelPos, repSolidLabelPos, majorityLinePos, majorityLinePosNarrow,
    demBlockFlex: demSolidCount + ' 1 0%',
    repBlockFlex: repSolidCount + ' 1 0%',
    contestedWrapFlex: CONTESTED_UNITS + ' 1 0%',
    demBlockTooltip, repBlockTooltip,
    demPct, repPct,
    demPctLabel: 'Democratic ' + fmtPct(cm.demProbability),
    repPctLabel: 'Republican ' + fmtPct(cm.repProbability),
    controlsHref,
    fetchedAtLabel,
    failedStates: data.failedStates || []
  };
}

function segHtmlWide(seg, i) {
  return `
    <a class="seg-wide" href="${escapeHtml(seg.href)}" target="_blank" rel="noopener noreferrer" style="background:${seg.color};" data-seg-index="${i}">
      <span class="seg-label-stack">
        <span class="seg-state">${escapeHtml(seg.state)}</span>
        <span class="seg-pct">${seg.leadLabel}</span>
        <span class="seg-party">${seg.leadParty}</span>
      </span>
      ${seg.showIndependentMark ? '<span class="ind-mark ind-mark-h" role="img" aria-label="Independent polling above 10%">&#42;</span>' : ''}
      ${seg.showPendingMark ? '<span class="pending-mark-h pending-badge" title="Primary not yet decided">?</span>' : ''}
    </a>`;
}

function segHtmlNarrow(seg, i) {
  return `
    <a class="seg-narrow" href="${escapeHtml(seg.href)}" target="_blank" rel="noopener noreferrer" style="background:${seg.color};" data-seg-index="${i}">
      <span class="seg-state">${escapeHtml(seg.state)}</span>
      <span class="seg-pct">${seg.leadLabel}</span>
      <span class="seg-party">${seg.leadParty}</span>
      ${seg.showIndependentMark ? '<span class="ind-mark ind-mark-v" role="img" aria-label="Independent polling above 10%">&#42;</span>' : ''}
      ${seg.showPendingMark ? '<span class="pending-mark-v pending-badge" title="Primary not yet decided">?</span>' : ''}
    </a>`;
}

function segsWithGaps(vals, segHtml, gapHtml) {
  return vals.segments
    .map((seg, i) => {
      const gap = vals.gaps.find(g => g.index === i);
      return (gap ? gapHtml(gap) : '') + segHtml(seg, i);
    })
    .join('');
}

function gapHtmlWide(gap) {
  return `<div class="seg-gap-wide" style="flex:${gap.flex};"></div>`;
}

function gapHtmlNarrow(gap) {
  const above = gap.above ? `<span class="gap-label dem">${gap.above} &#9650;</span>` : '';
  const below = gap.below ? `<span class="gap-label rep">&#9660; ${gap.below}</span>` : '';
  return `<div class="seg-gap-narrow" style="flex:${gap.flex};">${above}${below}</div>`;
}

function leanBandWideHtml(vals) {
  const brackets = vals.strongGroups.map(g => `
      <div class="strong-group ${g.key}" style="left:${g.wide.pos}%; width:${g.wide.size}%;">
        <div class="strong-bracket"></div>
        <div class="strong-label">${g.label}</div>
      </div>`).join('');
  const lean = vals.leanPos === null ? '' : `
      <div class="lean-mark" style="left:${vals.leanPos}%;">
        <span class="lean-tick"></span>
        <span class="lean-label lean-d">&#9668; Leans D</span>
        <span class="lean-label lean-r">Leans R &#9658;</span>
      </div>`;
  return `<div class="lean-band-wide">${brackets}${lean}</div>`;
}

function renderGauge(vals) {
  const demEl = document.getElementById('gauge-dem');
  const repEl = document.getElementById('gauge-rep');
  demEl.style.width = vals.demPct + '%';
  repEl.style.width = vals.repPct + '%';
  demEl.textContent = vals.demPctLabel;
  repEl.textContent = vals.repPctLabel;

  const srcEl = document.getElementById('gauge-source-link');
  if (vals.controlsHref) {
    srcEl.href = vals.controlsHref;
  } else {
    srcEl.removeAttribute('href');
  }
}

function renderWideBar(vals) {
  const container = document.getElementById('bar-wide-container');
  container.innerHTML = `
    <div class="bar-wrap-wide" id="bar-wide">
      <div class="callout" style="left:${vals.majorityLinePos}%; color:#211f1c;">50 seats</div>
      <div class="callout" style="left:${vals.demSolidLabelPos}%; color:#1c3f7a;">${vals.demSolidCount} D seats not up</div>
      <div class="callout" style="left:${vals.repSolidLabelPos}%; color:#8a2a22;">${vals.repSolidCount} R seats not up</div>
      <div class="bar-wide">
        <div class="solid-block dem" style="flex:${vals.demBlockFlex};" data-tip="dem-solid"></div>
        <div class="contested-wrap-wide" style="flex:${vals.contestedWrapFlex};">
          ${segsWithGaps(vals, segHtmlWide, gapHtmlWide)}
        </div>
        <div class="solid-block rep" style="flex:${vals.repBlockFlex};" data-tip="rep-solid"></div>
      </div>
      <div class="majority-line-wide" style="left:${vals.majorityLinePos}%;"></div>
      <div class="tooltip" id="tooltip-wide"></div>
    </div>
    ${leanBandWideHtml(vals)}`;

  const barEl = document.getElementById('bar-wide');
  const tooltipEl = document.getElementById('tooltip-wide');
  const tip = wireTooltip(barEl, tooltipEl, { anchorToRow: true });

  tip.bindHover(barEl.querySelector('[data-tip="dem-solid"]'), vals.demBlockTooltip);
  tip.bindHover(barEl.querySelector('[data-tip="rep-solid"]'), vals.repBlockTooltip);
  barEl.querySelectorAll('.seg-wide').forEach(el => {
    const seg = vals.segments[Number(el.dataset.segIndex)];
    tip.bindLink(el, seg.tooltip);
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
              ${segsWithGaps(vals, segHtmlNarrow, gapHtmlNarrow)}
            </div>
            <div class="solid-block-narrow rep" style="flex:${vals.repBlockFlex};" data-tip="rep-solid"></div>
          </div>
          <div class="majority-line-narrow" style="top:${vals.majorityLinePosNarrow}%;"></div>
          <div class="majority-label-narrow" style="top:${vals.majorityLinePosNarrow}%;">50 seats</div>
          ${vals.leanPosNarrow === null ? '' : `
          <div class="lean-line-narrow" style="top:${vals.leanPosNarrow}%;"></div>
          <div class="lean-labels-narrow" style="top:${vals.leanPosNarrow}%;">
            <span class="lean-label lean-d">Leans D &#9650;</span>
            <span class="lean-label lean-r">&#9660; Leans R</span>
          </div>`}
        </div>
        <div class="solid-caption rep">${vals.repSolidCount} R seats not up</div>
        <div class="tooltip" id="tooltip-narrow"></div>
      </div>
    </div>`;

  const barEl = document.getElementById('bar-narrow');
  const tooltipEl = document.getElementById('tooltip-narrow');
  const tip = wireTooltip(barEl, tooltipEl, { anchorToRow: true });

  tip.bindHover(barEl.querySelector('[data-tip="dem-solid"]'), vals.demBlockTooltip);
  tip.bindHover(barEl.querySelector('[data-tip="rep-solid"]'), vals.repBlockTooltip);
  barEl.querySelectorAll('.seg-narrow').forEach(el => {
    const seg = vals.segments[Number(el.dataset.segIndex)];
    tip.bindLink(el, seg.tooltip);
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
