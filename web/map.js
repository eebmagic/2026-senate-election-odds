// The state choropleth: reads the vendored topology (no CDN) and state
// summaries built from the live races array. d3 and topojson-client are
// loaded globally via <script> tags in index.html (UMD builds), not imported.

import { COLORS, buildStateSummaries, fmtPct, isMaterialIndependent, colorForDemProb, raceAxisProb, isTouchDevice, HIDE_DELAY_MS, escapeHtml, positionTooltip } from './senate-shared.js';

const FIPS_TO_POSTAL = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC',
  '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT',
  '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY', '72': 'PR'
};

// Only states with a 2026 race are colored, off that race's own odds via the
// continuous scale shared with the seat bar (colorForDemProb). raceAxisProb,
// not demProbability, so the map and bar agree on races with a material
// independent (see senate-shared.js). No-race states are grayed out.
function fillFor(summary) {
  if (!summary || !summary.race) return COLORS.neutral;
  return colorForDemProb(raceAxisProb(summary.race));
}

// Plain label/value row (no party-letter split): a not-up senator or the
// "as of" staleness row.
function rowHtml(label, value) {
  return '<div class="row"><span>' + escapeHtml(label) + '</span><span class="value">' + escapeHtml(value) + '</span></div>';
}

// Race-candidate row: value split into party letter + percentage (see
// .party/.pct in index.html) for column alignment. Mirrors rowValueHtml() in
// app.js.
function candidateRowHtml(label, party, pct) {
  return '<div class="row"><span>' + escapeHtml(label) + '</span><span class="value split"><span class="party">' + escapeHtml(party) + '</span><span class="pct">' + escapeHtml(pct) + '</span></span></div>';
}

function tooltipHtml(summary, name) {
  if (!summary) return '<div class="title">' + escapeHtml(name) + '</div>';
  let html = '<div class="title">' + escapeHtml(name) + '</div>';
  const notUpSeats = summary.seats.filter(seat => !seat.isRace);
  const raceSeat = summary.seats.find(seat => seat.isRace);

  // All rows share one CSS grid (.tooltip .rows in index.html) so the value
  // column lines up across the whole tooltip.
  let rows = '';

  // Label the two groups only when both are present -- otherwise a lone
  // not-up senator reads as part of the race list.
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
    // Sorted highest-probability first (mirrors buildRaceTooltip() in app.js).
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
  // A real <a> (mirrors app.js's tooltip hint). On touch the state shape
  // deliberately doesn't navigate (see renderMap), so this is the only route
  // to Kalshi -- hence #map-tooltip gets pointer-events:auto in index.html.
  if (raceSeat && raceSeat.race.kalshiUrl) {
    // "Tap", not the seat bar's "Tap again": a tapped state never navigates,
    // so there's no first tap on this element to repeat.
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

  // Deferred hide so the cursor can cross the gap between a state and its
  // tooltip to reach the "Kalshi" link without the tooltip vanishing en route.
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
    // Anchor to the state's shape, not the cursor -- large/irregular shapes
    // won't always sit under the pointer, but it stops the tooltip chasing
    // the mouse. clampWithinOrigin keeps it inside #map-wrap.
    positionTooltip(tooltipEl, pathEl, wrap, { gap: 8, clampWithinOrigin: true });
  }

  // Desktop: contested states are real <a href> (not a window.open handler,
  // so middle-click / cmd-click / "open in new tab" all work). Touch: a tap
  // is the only way to see the tooltip, so the shape must NOT navigate --
  // touch states stay plain <g> and reach Kalshi via the tooltip's own link.
  // Uncontested states have no race to link to and are <g> on both.
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
    // Touch drives the tooltip from click alone -- mobile browsers fire
    // synthetic mouseenter/mouseleave around a tap, and acting on the
    // mouseleave would dismiss the tooltip mid-tap.
    .on('mouseenter', (event, d) => {
      if (isTouchDevice) return;
      showFor(event.currentTarget, d);
    })
    .on('mouseleave', event => {
      if (isTouchDevice) return;
      // Moving onto the tooltip isn't leaving; skip the schedule/cancel churn.
      if (event.relatedTarget && tooltipEl.contains(event.relatedTarget)) return;
      scheduleHide();
    })
    .on('click', (event, d) => {
      if (!isTouchDevice) return;
      showFor(event.currentTarget, d);
    });

  // Keep the tooltip open while the pointer is on it, so its "Kalshi" link is
  // reachable. d3's .on() replaces a same-type handler, so re-rendering can't
  // stack duplicates on this long-lived element.
  tooltip
    .on('mouseenter', () => cancelHide())
    .on('mouseleave', () => {
      if (isTouchDevice) return;
      scheduleHide();
    });

  if (isTouchDevice) {
    // Tapping outside the map dismisses the preview. The tooltip lives inside
    // #map-wrap, so tapping its Kalshi link doesn't count as outside.
    // Namespaced so a re-render replaces this listener.
    d3.select(document).on('click.map-tooltip', event => {
      if (!wrap.contains(event.target)) hide();
    });
  }
}
