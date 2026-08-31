// Fetches the live data artifact and renders the chamber-control gauge and
// the seat spectrum bar. The wide (>=720px) and narrow (<720px) layouts are
// both built up front and switched with a CSS media query (see index.html),
// not a resize listener -- almost all the layout math below is pure
// percentages (NARROW_TRACK_HEIGHT is the one pixel-dependent exception).

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
  HIDE_DELAY_MS,
  escapeHtml,
  positionTooltip
} from './senate-shared.js';
import { renderMap } from './map.js';

const CONTESTED_UNITS = 130;

// Whitespace breaks separating the Strong D / Strong R groups from the
// lean-and-tossup middle, measured in segment-widths so they share the
// segments' flex-grow budget and every marker position stays pure percentage
// math (see groupGeometry()). The party-handover break is half-size so it
// doesn't read as a fourth group.
const GROUP_GAP_UNITS = 0.9;
const LEAN_GAP_UNITS = 0.45;

// The narrow bar's solid blocks render at a fixed pixel height (see
// .solid-block-narrow / .bar-track-narrow in index.html), not the
// seat-proportional flex used elsewhere, so its majority line needs separate
// math. Mirror these CSS values; keep in sync.
const NARROW_TRACK_HEIGHT = 900;
const NARROW_SOLID_BLOCK_HEIGHT = 60;

// Race rows carry `party`/`pct` as separate grid cells (see .tooltip .rows in
// index.html) so the letters stay aligned and percentages right-align
// regardless of digit count.
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
  // A real <a>: the tooltip receives pointer events (see #tooltip-wide/
  // #tooltip-narrow in index.html), so this is clickable on its own.
  const hint = payload.href
    ? `<a class="hint" href="${escapeHtml(payload.href)}" target="_blank" rel="noopener noreferrer">${isTouchDevice ? 'Tap again to view on ' : 'Click to view on '}<span class="hint-link">Kalshi ↗</span></a>`
    : '';
  return `<div class="title">${escapeHtml(payload.title)}</div><div class="rows">${rows}</div>${hint}`;
}

function wireTooltip(containerEl, tooltipEl) {
  let active = false;
  // Touch only: element armed to navigate on its *next* tap (first tap just
  // previews).
  let armedEl = null;
  // Element that most recently opened the tooltip; lets the scrollable-list
  // variant tell "cursor left" from "cursor moved onto the tooltip itself".
  let activeTriggerEl = null;
  // Pending grace-period hide (see HIDE_DELAY_MS); cancelled if the cursor
  // lands back on the trigger or the tooltip.
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

  function show(payload, el) {
    cancelHide();
    active = true;
    activeTriggerEl = el || null;
    tooltipEl.innerHTML = tooltipHtml(payload);
    tooltipEl.classList.toggle('scrollable', !!payload.scrollable);
    tooltipEl.style.display = 'block';
    positionTooltip(tooltipEl, el, containerEl, { gap: 4 });
  }

  function hide() {
    cancelHide();
    active = false;
    armedEl = null;
    activeTriggerEl = null;
    tooltipEl.style.display = 'none';
    tooltipEl.classList.remove('below');
  }

  if (isTouchDevice) {
    // Tapping outside this bar dismisses its open preview.
    document.addEventListener('click', e => {
      if (!containerEl.contains(e.target)) hide();
    });
  }

  // Row-anchored tooltips get pointer-events (see index.html) so the cursor
  // can move onto the tooltip -- e.g. to scroll the long "N seats not up"
  // list -- without it hiding. Only hide once the cursor leaves for
  // somewhere other than its own trigger.
  tooltipEl.addEventListener('mouseenter', () => cancelHide());
  tooltipEl.addEventListener('mouseleave', e => {
    if (!active) return;
    if (activeTriggerEl && e.relatedTarget === activeTriggerEl) return;
    scheduleHide();
  });

  // Tooltip-only element (the solid D/R blocks -- no race to link to).
  function bindHover(el, payload) {
    if (isTouchDevice) {
      el.addEventListener('click', e => { e.preventDefault(); show(payload, el); });
    } else {
      el.addEventListener('mouseenter', () => show(payload, el));
      el.addEventListener('mouseleave', e => {
        // Cursor moving onto the tooltip isn't leaving; skip the redundant
        // schedule/cancel churn (tooltipEl's own mouseenter cancels anyway).
        if (e.relatedTarget && tooltipEl.contains(e.relatedTarget)) return;
        scheduleHide();
      });
    }
  }

  // Linked element (a contested-race segment, a real <a href>). Desktop: a
  // click just navigates. Touch: first tap previews and arms; a second tap
  // follows the link natively.
  function bindLink(el, payload) {
    if (isTouchDevice) {
      el.addEventListener('click', e => {
        if (armedEl !== el) {
          e.preventDefault();
          show(payload, el);
          armedEl = el;
        }
      });
    } else {
      el.addEventListener('mouseenter', () => show(payload, el));
      el.addEventListener('mouseleave', e => {
        if (e.relatedTarget && tooltipEl.contains(e.relatedTarget)) return;
        scheduleHide();
      });
    }
  }

  return { bindHover, bindLink, hide };
}

function buildRaceTooltip(r) {
  // Rows sorted highest-probability first, so order matches who's ahead.
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
  // Label = the front-runner across all three lanes (raceLeader); color and
  // bar slot come from that same number mirrored onto the leader's side
  // (raceAxisProb). See senate-shared.js for why one number drives both.
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

// Splits the axis-ordered segment list into Strong D / middle / Strong R and
// returns every marker position in "units" along the contested track (one per
// segment, GROUP_GAP_UNITS per break). Both layouts convert units to a
// percentage of their own track, so every marker stays in agreement without
// measuring the DOM. Groups are taken as a prefix/suffix of the list (ordered
// by raceAxisProb, a party's strong races are always contiguous at its end).
function groupGeometry(segments) {
  const n = segments.length;
  const isStrong = (seg, party) => seg.leadParty === party && seg.leadProb >= STRONG_LEAN;

  let strongDemCount = 0;
  while (strongDemCount < n && isStrong(segments[strongDemCount], 'D')) strongDemCount++;
  let strongRepCount = 0;
  while (strongRepCount < n - strongDemCount && isStrong(segments[n - 1 - strongRepCount], 'R')) strongRepCount++;
  const repGroupStart = n - strongRepCount;

  // Where the lead changes party in the ordered list: "first race not led by
  // a Democrat", not a probability cutoff, so an independent-led race in
  // between doesn't throw it off.
  let flipIndex = 0;
  while (flipIndex < n && segments[flipIndex].leadParty === 'D') flipIndex++;
  const hasFlip = flipIndex > 0 && flipIndex < n;

  // A break only earns its place with segments on *both* sides. Each carries
  // the adjacent group's name -- the narrow bar labels groups inside the
  // breaks, not in a gutter (see renderNarrowBar).
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

  // Boundaries can coincide (handover on a strong-group edge; two strong
  // edges meeting when there's no middle). Collapse onto one break, widest
  // spec winning, keeping both specs' labels.
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
  // Units left of segment i's leading edge; a gap at index i sits just before
  // segment i and counts toward its edge.
  const edgeUnits = i => i + gaps.filter(g => g.index <= i).reduce((sum, g) => sum + g.units, 0);

  // The leans divider is centered in its break, not pinned to one side.
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
  // Unit -> percentage converters, one per layout; every marker is placed
  // through these so they all shift together when the groups change.
  const widePct = u => demBlockPct + (u / geom.totalUnits) * contestedPct;

  // Narrow bar: solid blocks are a fixed NARROW_SOLID_BLOCK_HEIGHT, so the
  // wide bar's fraction-of-total doesn't map to where segments fall here.
  const narrowContestedHeight = NARROW_TRACK_HEIGHT - 2 * NARROW_SOLID_BLOCK_HEIGHT;
  const narrowPct = u => ((NARROW_SOLID_BLOCK_HEIGHT + (u / geom.totalUnits) * narrowContestedHeight) / NARROW_TRACK_HEIGHT) * 100;

  const seatsIntoContested = 50 - demSolidCount;
  const majorityLinePos = widePct(geom.edgeUnits(seatsIntoContested));
  const majorityLinePosNarrow = narrowPct(geom.edgeUnits(seatsIntoContested));

  // Wide brackets: left+width. Narrow: top+height.
  const wideGroup = g => g && { pos: widePct(g.startUnits), size: widePct(g.endUnits) - widePct(g.startUnits) };
  const narrowGroup = g => g && { pos: narrowPct(g.startUnits), size: narrowPct(g.endUnits) - narrowPct(g.startUnits) };
  const strongGroups = [
    { key: 'dem', label: 'Strong D', wide: wideGroup(geom.strongDem), narrow: narrowGroup(geom.strongDem) },
    { key: 'rep', label: 'Strong R', wide: wideGroup(geom.strongRep), narrow: narrowGroup(geom.strongRep) }
  ].filter(g => g.wide);
  const leanPos = geom.flipUnits === null ? null : widePct(geom.flipUnits);
  const leanPosNarrow = geom.flipUnits === null ? null : narrowPct(geom.flipUnits);

  // scrollable: the long-list tooltip variant (see .tooltip.scrollable in
  // index.html) so the full 30+ name list is reachable by scroll.
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

// Interleaves the breaks into the ordered segment list. Each gap's flex-grow
// is its own unit width, matching what groupGeometry() assumed.
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

// The narrow bar has no gutter for labelled brackets, so it names each group
// inside the break itself with an arrow pointing at it.
function gapHtmlNarrow(gap) {
  const above = gap.above ? `<span class="gap-label dem">${gap.above} &#9650;</span>` : '';
  const below = gap.below ? `<span class="gap-label rep">&#9660; ${gap.below}</span>` : '';
  return `<div class="seg-gap-narrow" style="flex:${gap.flex};">${above}${below}</div>`;
}

// The band beneath the wide bar: a bracket per strong group plus the smaller
// leans divider at the party handover.
function leanBandWideHtml(vals) {
  const brackets = vals.strongGroups.map(g => `
      <div class="strong-group ${g.key}" style="left:${g.wide.pos}%; width:${g.wide.size}%;">
        <div class="strong-bracket"></div>
        <div class="strong-label">${g.label}</div>
      </div>`).join('');
  const lean = vals.leanPos === null ? '' : `
      <div class="lean-mark" style="left:${vals.leanPos}%;">
        <span class="lean-tick"></span>
        <!-- U+25C4/U+25BA, not the U+25C0/U+25B6 triangles: those resolve to
             different fallback fonts here, giving the two labels mismatched
             baselines. These share the label font's own metrics. -->
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

  // .gauge-source only shows once [href] is present, so leaving it unset
  // hides the link rather than rendering a dead one.
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
  const tip = wireTooltip(barEl, tooltipEl);

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
  const tip = wireTooltip(barEl, tooltipEl);

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
