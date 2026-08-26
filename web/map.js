import { COLORS, buildStateSummaries, fmtPct, isMaterialIndependent, colorForDemProb, raceAxisProb, isTouchDevice, HIDE_DELAY_MS } from './senate-shared.js';

const FIPS_TO_POSTAL = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC',
  '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT',
  '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY', '72': 'PR'
};

// Only states with an actual 2026 race are colored, and only off that
// race's own odds -- the continuous red/purple/blue scale shared with the
// seat-bar gradient (see colorForDemProb() in senate-shared.js), not a
// solid/split/tossup classification. States with no 2026 race (both seats
// not up) are grayed out rather than colored by their current senators.
// raceAxisProb rather than demProbability so the map and the seat bar stay on
// the same scale -- a race with a material independent has to land on the same
// color in both. That means an R-led race is shaded by 1 - repProbability, so
// Nebraska reads as the ~71%-Republican race it is rather than as a near-lock
// (see raceAxisProb in senate-shared.js).
function fillFor(summary) {
  if (!summary || !summary.race) return COLORS.neutral;
  return colorForDemProb(raceAxisProb(summary.race));
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Plain label/value row (no party-letter split), e.g. a not-up-in-2026
// senator or the "as of" staleness row.
function rowHtml(label, value) {
  return '<div class="row"><span>' + escapeHtml(label) + '</span><span class="value">' + escapeHtml(value) + '</span></div>';
}

// Race-candidate row: value is split into a party letter and a percentage
// (see .party/.pct in index.html) so the letters line up at a consistent
// distance from the edge and the percentages right-align above one another,
// regardless of how many digits any one row's percentage has -- mirrors
// rowValueHtml() in app.js.
function candidateRowHtml(label, party, pct) {
  return '<div class="row"><span>' + escapeHtml(label) + '</span><span class="value split"><span class="party">' + escapeHtml(party) + '</span><span class="pct">' + escapeHtml(pct) + '</span></span></div>';
}

function tooltipHtml(summary, name) {
  if (!summary) return '<div class="title">' + escapeHtml(name) + '</div>';
  let html = '<div class="title">' + escapeHtml(name) + '</div>';
  const notUpSeats = summary.seats.filter(seat => !seat.isRace);
  const raceSeat = summary.seats.find(seat => seat.isRace);

  // All rows (across both groups) share one CSS grid -- see .tooltip .rows
  // in index.html -- so the value column lines up for the whole tooltip,
  // not just within one group.
  let rows = '';

  // Only label the groups when both are present -- that's the case that
  // reads as an unlabeled mashup (one senator not up alongside the actual
  // 2026 race candidates). A state with no 2026 race (both seats solid) or
  // one where every seat shown is part of the race doesn't need the split.
  if (notUpSeats.length && raceSeat) {
    rows += '<div class="group-label">Not up in 2026</div>';
  }
  notUpSeats.forEach(seat => {
    rows += rowHtml(seat.senator, seat.party === 'D' ? 'D' : 'R');
  });

  if (raceSeat) {
    if (notUpSeats.length) {
      rows += '<div class="group-label">2026 race</div>';
    }
    const r = raceSeat.race;
    // Sorted by lead order (highest probability first) rather than a fixed
    // D/R/independent order, so the row order always matches who's actually
    // ahead -- mirrors buildRaceTooltip() in app.js.
    const candidateRows = [
      { label: r.demCandidate + (r.demPrimaryPending ? ' (TBD)' : ''), party: 'D', pct: fmtPct(r.demProbability), probability: r.demProbability },
      { label: r.repCandidate + (r.repPrimaryPending ? ' (TBD)' : ''), party: 'R', pct: fmtPct(r.repProbability), probability: r.repProbability }
    ];
    if (isMaterialIndependent(r)) {
      r.otherTickers.forEach(o => {
        candidateRows.push({ label: o.candidate + ' (I)', party: '', pct: fmtPct(o.probability), probability: o.probability });
      });
    }
    candidateRows.sort((a, b) => b.probability - a.probability);
    rows += candidateRows.map(row => candidateRowHtml(row.label, row.party, row.pct)).join('');
    if (r.stale) {
      rows += rowHtml('as of', r.staleSince || 'unknown');
    }
  }
  html += '<div class="rows">' + rows + '</div>';
  // A real <a>, not just styled text -- mirrors the seat-bar's tooltip hint
  // (see tooltipHtml() in app.js). On desktop this duplicates the state
  // shape's own link, but on touch the shape deliberately doesn't navigate
  // (see renderMap below) and this line is the only route to Kalshi, so it
  // has to be genuinely clickable/tappable in its own right -- which is why
  // #map-tooltip gets pointer-events:auto in index.html.
  if (raceSeat && raceSeat.race.kalshiUrl) {
    // "Tap", not the seat bar's "Tap again": there the segment itself is the
    // link and a second tap on it navigates (see bindLink() in app.js),
    // whereas a tapped state here never navigates and this line is the only
    // target -- so "again" would point the user back at the wrong element.
    const hintLabel = isTouchDevice ? 'Tap to view on ' : 'Click to view on ';
    html += '<a class="hint" href="' + escapeHtml(raceSeat.race.kalshiUrl) + '" target="_blank" rel="noopener noreferrer">' + hintLabel + '<span class="hint-link">Kalshi &#8599;</span></a>';
  }
  return html;
}

let topologyPromise = null;
function loadTopology() {
  if (!topologyPromise) {
    topologyPromise = fetch('./vendor/us-states-10m.json').then(r => r.json());
  }
  return topologyPromise;
}

export async function renderMap(races) {
  const summaries = buildStateSummaries(races);
  const byPostal = {};
  summaries.forEach(s => { byPostal[s.state] = s; });

  const svg = d3.select('#map-svg');
  const tooltip = d3.select('#map-tooltip');
  const tooltipEl = tooltip.node();
  const wrap = document.getElementById('map-wrap');

  svg.selectAll('*').remove();

  const topology = await loadTopology();
  const geo = topojson.feature(topology, topology.objects.states);
  const projection = d3.geoAlbersUsa().fitSize([960, 600], geo);
  const path = d3.geoPath().projection(projection);

  // Deferred hide, so the cursor can cross the gap between a state and its
  // tooltip (see `gap` in positionTooltip below) without the tooltip
  // vanishing en route -- that crossing is the only way to reach the
  // tooltip's "Kalshi" link, so an instant hide on mouseleave would make the
  // link unreachable and leave the map with no route to Kalshi at all.
  let hideTimer = null;
  function cancelHide() {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }
  function hide() {
    cancelHide();
    tooltip.style('display', 'none');
  }
  function scheduleHide() {
    cancelHide();
    hideTimer = setTimeout(hide, HIDE_DELAY_MS);
  }
  function showFor(pathEl, d) {
    const postal = FIPS_TO_POSTAL[d.id];
    if (postal === 'DC' || postal === 'PR') return;
    cancelHide();
    tooltip
      .style('display', 'block')
      .html(tooltipHtml(byPostal[postal], d.properties.name));
    positionTooltip(pathEl);
  }

  // Whether a state is itself a link depends on the input model, because the
  // two are genuinely different interactions:
  //
  //   Desktop -- hover already previews the race, so a click is unambiguous:
  //   contested states are real <a href> elements and clicking one opens
  //   Kalshi. Being a true link (rather than a click handler calling
  //   window.open) also keeps the browser's own affordances working:
  //   middle-click and cmd-click, right-click "Open link in new tab", the
  //   status-bar URL preview on hover. Same treatment as a seat-bar segment
  //   -- see "Map states look clickable but do nothing on click" in
  //   feedback/map-and-interactivity.md for the ask this answers.
  //
  //   Touch -- there is no hover, so a tap is the only way to see the tooltip
  //   at all. If the shape were a link that same tap would also navigate,
  //   which is the bug this branch started from. Touch states therefore stay
  //   plain <g> and reach Kalshi through the tooltip's own link instead (see
  //   tooltipHtml() above), which is a far larger and more stably-positioned
  //   tap target than a small state shape anyway.
  //
  // Solid/uncontested states have no single race to link to, so they are
  // plain <g> on both.
  const svgNs = 'http://www.w3.org/2000/svg';

  svg.append('g')
    .selectAll('.state-node')
    .data(geo.features)
    .join(enter => enter.append(d => {
      const summary = byPostal[FIPS_TO_POSTAL[d.id]];
      const href = summary && summary.race && summary.race.kalshiUrl;
      if (href && !isTouchDevice) {
        const a = document.createElementNS(svgNs, 'a');
        a.setAttribute('href', href);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        return a;
      }
      return document.createElementNS(svgNs, 'g');
    }))
    .attr('class', 'state-node')
    .append('path')
    .attr('class', d => {
      const postal = FIPS_TO_POSTAL[d.id];
      const summary = byPostal[postal];
      const linked = summary && summary.race && summary.race.kalshiUrl;
      return linked ? 'state linked' : 'state';
    })
    .attr('d', path)
    .attr('fill', d => {
      const postal = FIPS_TO_POSTAL[d.id];
      return fillFor(byPostal[postal]);
    })
    // Touch devices skip the mouse handlers entirely and drive the tooltip
    // from click alone: mobile browsers still emit synthetic mouseenter/
    // mouseleave around a tap, and acting on the mouseleave would dismiss the
    // tooltip mid-tap -- exactly when the user is reaching for its link.
    .on('mouseenter', (event, d) => {
      if (isTouchDevice) return;
      showFor(event.currentTarget, d);
    })
    .on('mouseleave', event => {
      if (isTouchDevice) return;
      // Moving straight from the state onto the tooltip isn't leaving: the
      // tooltip's own mouseenter would cancel the hide anyway, but skipping
      // the timer here avoids the pointless schedule/cancel churn.
      if (event.relatedTarget && tooltipEl.contains(event.relatedTarget)) return;
      scheduleHide();
    })
    .on('click', (event, d) => {
      if (!isTouchDevice) return;
      showFor(event.currentTarget, d);
    });

  // Keep the tooltip open while the pointer is on it, so its "Kalshi" link is
  // actually reachable (the link is why #map-tooltip gets pointer-events:auto
  // in index.html). Bound through d3's .on(), which replaces a same-type
  // handler rather than stacking another one, so re-rendering the map can't
  // accumulate duplicates on this long-lived element.
  tooltip
    .on('mouseenter', () => cancelHide())
    .on('mouseleave', () => {
      if (isTouchDevice) return;
      scheduleHide();
    });

  if (isTouchDevice) {
    // Tapping anywhere outside the map dismisses the open preview. The
    // tooltip lives inside #map-wrap, so tapping its Kalshi link doesn't
    // count as outside and won't fight that link's own navigation.
    // Namespaced so a re-render replaces this listener instead of adding one.
    d3.select(document).on('click.map-tooltip', event => {
      if (!wrap.contains(event.target)) hide();
    });
  }

  // Anchor the tooltip to the hovered state's shape instead of the cursor --
  // same stable-position + tail treatment as the seat-bar's tooltips (see
  // positionAboveOrBelowRow()/pointTailAt() in app.js's wireTooltip()).
  // Large/irregular state shapes mean the anchor point (the path's own
  // bounding box) won't always sit exactly under the cursor, but it keeps
  // the tooltip from chasing the mouse and gives every hover a real visual
  // link back to its source state via the tail.
  function positionTooltip(pathEl) {
    const wrapRect = wrap.getBoundingClientRect();
    const elRect = pathEl.getBoundingClientRect();
    const gap = 8;
    const centerX = (elRect.left + elRect.width / 2) - wrapRect.left;

    tooltip.classed('below', false);
    tooltip.style('left', centerX + 'px');
    tooltip.style('top', (elRect.top - gap - wrapRect.top) + 'px');

    const tHeight = tooltip.node().getBoundingClientRect().height;
    const spaceAbove = elRect.top;
    const spaceBelow = window.innerHeight - elRect.bottom;
    if (spaceAbove < tHeight + gap && spaceBelow > spaceAbove) {
      tooltip.classed('below', true);
      tooltip.style('top', (elRect.bottom + gap - wrapRect.top) + 'px');
    }

    clampToWrap();
    pointTailAt(centerX);
  }

  function clampToWrap() {
    const margin = 8;
    const wrapRect = wrap.getBoundingClientRect();
    const tRect = tooltip.node().getBoundingClientRect();
    let dx = 0, dy = 0;
    if (tRect.left < wrapRect.left + margin) dx = (wrapRect.left + margin) - tRect.left;
    else if (tRect.right > wrapRect.right - margin) dx = (wrapRect.right - margin) - tRect.right;
    if (tRect.top < margin) dy = margin - tRect.top;
    else if (tRect.bottom > window.innerHeight - margin) dy = (window.innerHeight - margin) - tRect.bottom;
    if (dx || dy) {
      tooltip.style('left', (parseFloat(tooltip.style('left')) + dx) + 'px');
      tooltip.style('top', (parseFloat(tooltip.style('top')) + dy) + 'px');
    }
  }

  function pointTailAt(targetCenterX) {
    const wrapRect = wrap.getBoundingClientRect();
    const tRect = tooltip.node().getBoundingClientRect();
    const tooltipLeft = tRect.left - wrapRect.left;
    const margin = 10;
    const tailX = Math.max(margin, Math.min(tRect.width - margin, targetCenterX - tooltipLeft));
    tooltip.style('--tail-x', tailX + 'px');
  }
}
