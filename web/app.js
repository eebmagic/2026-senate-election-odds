// Fetches the live data artifact and renders the chamber-control gauge and
// the seat spectrum bar. Ported from design_handoff_senate_tracker's
// Senate Tracker.dc.html (its renderVals() derivation + <x-dc> template),
// using plain DOM instead of the prototype's streaming-component runtime.
// The wide (>=720px) and narrow (<720px) layouts are both built up front and
// switched with a CSS media query (see index.html) rather than a JS resize
// listener -- the README calls this out as the cleaner production approach
// since almost none of the layout math below depends on pixel width, only
// percentages (the narrow bar's majority line is the one exception -- see
// NARROW_TRACK_HEIGHT below).

import {
  SOLID_SEATS,
  STATE_NAMES,
  colorForDemProb,
  fmtPct,
  seatPartyResolved,
  isMaterialIndependent,
  raceHasPendingPrimary
} from './senate-shared.js';
import { renderMap } from './map.js';

const CONTESTED_UNITS = 130;

// The narrow (<720px) bar's solid dem/rep blocks are capped to a fixed pixel
// height instead of the seat-count-proportional flex used everywhere else
// (see .solid-block-narrow / .bar-track-narrow in index.html) -- so the
// majority line's position within that bar can't use the same percentage
// math as the rest of computeVals. These mirror those CSS values; keep them
// in sync if the CSS changes.
const NARROW_TRACK_HEIGHT = 900;
const NARROW_SOLID_BLOCK_HEIGHT = 60;

// No hover on touchscreens: a linked segment needs its tooltip treated as a
// preview, with an explicit second tap to actually follow the link (see
// bindLink below). Detected once, not per element.
const isTouchDevice = window.matchMedia('(hover: none), (pointer: coarse)').matches;

// Grace period before a mouseleave-triggered hide actually takes effect.
// Row-anchored tooltips sit a few pixels off their trigger (see the `gap` in
// positionAboveOrBelowRow below), and a mouse moving slowly toward the
// tooltip can land in that gap for a moment -- on neither the trigger nor
// the tooltip -- which would otherwise fire an instant mouseleave and
// dismiss the tooltip before the cursor ever reaches it. Deferring the hide
// gives that crossing time to land back on one of them and cancel it.
const HIDE_DELAY_MS = 150;

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
  // A real <a>, not just styled text -- now that the tooltip itself receives
  // pointer events (see #tooltip-wide/#tooltip-narrow in index.html), this
  // is reachable and clickable on its own, not just via the segment
  // underneath it.
  const hint = payload.href
    ? `<a class="hint" href="${escapeHtml(payload.href)}" target="_blank" rel="noopener noreferrer">${isTouchDevice ? 'Tap again to view on ' : 'Click to view on '}<span class="hint-link">Kalshi ↗</span></a>`
    : '';
  return `<div class="title">${escapeHtml(payload.title)}</div>${rows}${hint}`;
}

function wireTooltip(containerEl, tooltipEl, { anchorToRow = false } = {}) {
  let active = false;
  // Touch only: the element armed to navigate on its *next* tap, since the
  // first tap on a link just shows the preview instead.
  let armedEl = null;
  // The element whose hover/tap most recently opened the tooltip. Used only
  // by the scrollable-list variant (see below) to tell "cursor left for good"
  // apart from "cursor moved off the trigger and onto the tooltip itself".
  let activeTriggerEl = null;
  // Pending hide from a mouseleave grace period (see HIDE_DELAY_MS above);
  // cancelled if the cursor lands back on the trigger or the tooltip first.
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
    // Scrollable-list variant: position it once, at the cursor location that
    // opened it (the initial mouseenter/click that reached show() below),
    // then leave it be. If it kept re-centering on every mousemove like the
    // small tooltips do, the box would visually chase the cursor as the user
    // moves toward it to scroll -- since it's anchored bottom-center on the
    // cursor, the cursor would always land right on its bottom edge, a
    // flicker-prone hit-test boundary rather than a stable target.
    if (event.type === 'mousemove' && tooltipEl.classList.contains('scrollable')) return;
    const rect = containerEl.getBoundingClientRect();
    tooltipEl.style.left = (event.clientX - rect.left) + 'px';
    tooltipEl.style.top = (event.clientY - rect.top) + 'px';
    clampToViewport();
  }

  // Anchor to the hovered/tapped row's actual box instead of the cursor:
  // prefer above it, but flip below when there isn't room, using the
  // tooltip's real rendered height rather than a guess. This is what gives
  // the tooltip a stable height between cells in the same row -- every
  // segment shares the row's top edge, so the tooltip always opens at the
  // same Y regardless of which cell triggered it.
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

  // Aim the tooltip's CSS tail (see #tooltip-wide::after / #tooltip-narrow::after
  // in index.html) at the horizontal center of the row/cell that opened it.
  // clampToViewport() may have nudged the whole tooltip sideways to keep it
  // on-screen, so the tail's offset is computed against the tooltip's actual
  // rendered left edge -- undoing the translateX(-50%) centering transform --
  // rather than its `left` style value, and clamped so it can't poke out past
  // the box's own rounded corners.
  function pointTailAt(targetCenterX) {
    const containerRect = containerEl.getBoundingClientRect();
    const tRect = tooltipEl.getBoundingClientRect();
    const tooltipLeft = tRect.left - containerRect.left;
    const margin = 10;
    const tailX = Math.max(margin, Math.min(tRect.width - margin, targetCenterX - tooltipLeft));
    tooltipEl.style.setProperty('--tail-x', tailX + 'px');
  }

  // The tooltip is positioned relative to its bar container, which on the
  // narrow layout is nearly as wide as the screen -- a tap near either edge
  // (or a long candidate name) can push the tooltip's centered box past the
  // actual viewport edge, and a tall tooltip can push past the top or bottom.
  // Nudge it back in after layout, using real dimensions rather than
  // guessing a max tooltip size up front.
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
    // Tapping anywhere outside this bar dismisses its open preview.
    document.addEventListener('click', e => {
      if (!containerEl.contains(e.target)) hide();
    });
  }

  // Row-anchored tooltips have pointer-events enabled (see #tooltip-wide /
  // #tooltip-narrow in index.html) precisely so the cursor can move off the
  // trigger and onto the tooltip itself -- e.g. to scroll the "N seats not
  // up" long-list variant -- without it disappearing. Only really hide once
  // the cursor leaves the tooltip for somewhere that isn't back on its own
  // trigger.
  tooltipEl.addEventListener('mouseenter', () => cancelHide());
  tooltipEl.addEventListener('mouseleave', e => {
    if (!active) return;
    if (activeTriggerEl && e.relatedTarget === activeTriggerEl) return;
    scheduleHide();
  });

  // Tooltip-only element (the solid D/R blocks: no single race backs them,
  // so nothing to link to).
  function bindHover(el, payload) {
    if (isTouchDevice) {
      el.addEventListener('click', e => { e.preventDefault(); show(payload, e, el); });
    } else {
      el.addEventListener('mouseenter', e => show(payload, e, el));
      el.addEventListener('mouseleave', e => {
        // Don't hide when the cursor is just moving off the trigger and
        // onto the (now interactive) tooltip -- tooltipEl's own mouseenter
        // above will cancel the hide anyway, but skipping the timer here
        // avoids the pointless schedule/cancel churn on that direct path.
        if (e.relatedTarget && tooltipEl.contains(e.relatedTarget)) return;
        scheduleHide();
      });
    }
  }

  // Linked element (a contested-race segment, a real <a href>). Desktop:
  // hover already previews it, so a click just navigates immediately. Touch:
  // first tap previews and arms the element; a second tap on that same
  // element is left alone and follows the link natively.
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
    { label: r.demCandidate + (r.demPrimaryPending ? ' (primary TBD)' : ''), value: 'D ' + fmtPct(r.demProbability) },
    { label: r.repCandidate + (r.repPrimaryPending ? ' (primary TBD)' : ''), value: 'R ' + fmtPct(r.repProbability) }
  ];
  if (isMaterialIndependent(r)) {
    r.otherTickers.forEach(o => rows.push({ label: o.candidate + ' (I)', value: fmtPct(o.probability) }));
  }
  let title = (STATE_NAMES[r.state] || r.state) + (r.raceType === 'special' ? ' — special election' : '');
  if (r.stale) title += ' (as of ' + formatDate(r.staleSince) + ')';
  return { title, rows, href: r.kalshiUrl };
}

function makeContestedSeg(r) {
  const leadDem = r.demProbability >= 0.5;
  return {
    state: r.state,
    race: r,
    href: r.kalshiUrl,
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

  // Narrow-bar-specific line position: the solid blocks there render at a
  // fixed NARROW_SOLID_BLOCK_HEIGHT (not seat-count-proportional -- see the
  // constant's comment), so the fraction-of-total used by majorityLinePos
  // above doesn't line up with where the segments actually fall on screen.
  const narrowContestedHeight = NARROW_TRACK_HEIGHT - 2 * NARROW_SOLID_BLOCK_HEIGHT;
  const majorityLinePosNarrow = ((NARROW_SOLID_BLOCK_HEIGHT + (seatsIntoContested / contested.length) * narrowContestedHeight) / NARROW_TRACK_HEIGHT) * 100;

  // scrollable: true marks the long-list tooltip variant (see .tooltip.scrollable
  // in index.html + wireTooltip in this file) so the full 30+ name list is
  // actually reachable by scroll, not just visually truncated.
  const demBlockTooltip = { title: demSolidCount + ' Democratic seats not up in 2026', rows: dSolids.map(s => ({ label: s.state, value: s.senator })), scrollable: true };
  const repBlockTooltip = { title: repSolidCount + ' Republican seats not up in 2026', rows: rSolids.map(s => ({ label: s.state, value: s.senator })), scrollable: true };

  const cm = data.controlsMarket || { demProbability: 0.5, repProbability: 0.5 };
  const demPct = Math.round(cm.demProbability * 1000) / 10;
  const repPct = Math.round(cm.repProbability * 1000) / 10;

  const fetchedDate = new Date(data.fetchedAt);
  const fetchedAtLabel = isNaN(fetchedDate)
    ? data.fetchedAt
    : fetchedDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

  return {
    races, segments, demSolidCount, repSolidCount,
    demSolidLabelPos, repSolidLabelPos, majorityLinePos, majorityLinePosNarrow,
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
    <a class="seg-wide" href="${escapeHtml(seg.href)}" target="_blank" rel="noopener noreferrer" style="background:${seg.color};" data-seg-index="${i}">
      <span class="seg-label-stack">
        <span class="seg-state">${escapeHtml(seg.state)}</span>
        <span class="seg-pct">${seg.leadLabel}</span>
        <span class="seg-party">${seg.leadParty}</span>
      </span>
      ${seg.showIndependentMark ? '<span class="ind-mark-h"></span>' : ''}
      ${seg.showPendingMark ? '<span class="pending-mark-h pending-badge" title="Primary not yet decided">?</span>' : ''}
    </a>`;
}

function segHtmlNarrow(seg, i) {
  return `
    <a class="seg-narrow" href="${escapeHtml(seg.href)}" target="_blank" rel="noopener noreferrer" style="background:${seg.color};" data-seg-index="${i}">
      <span class="seg-state">${escapeHtml(seg.state)}</span>
      <span class="seg-pct">${seg.leadLabel}</span>
      <span class="seg-party">${seg.leadParty}</span>
      ${seg.showIndependentMark ? '<span class="ind-mark-v"></span>' : ''}
      ${seg.showPendingMark ? '<span class="pending-mark-v pending-badge" title="Primary not yet decided">?</span>' : ''}
    </a>`;
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
              ${vals.segments.map(segHtmlNarrow).join('')}
            </div>
            <div class="solid-block-narrow rep" style="flex:${vals.repBlockFlex};" data-tip="rep-solid"></div>
          </div>
          <div class="majority-line-narrow" style="top:${vals.majorityLinePosNarrow}%;"></div>
          <div class="majority-label-narrow" style="top:${vals.majorityLinePosNarrow}%;">51 to control</div>
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
