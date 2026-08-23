// Inlined port of design_handoff_senate_tracker/us-map.html: same FIPS->postal
// table, stripe pattern, and tooltip content, reading the vendored topology
// instead of hitting a CDN, and consuming state summaries built from the
// live races array instead of data.js's static RACES export. d3 and
// topojson-client are loaded globally via <script> tags in index.html
// (their UMD builds), not as ES module imports.

import { COLORS, buildStateSummaries, fmtPct, isMaterialIndependent } from './senate-shared.js';

const FIPS_TO_POSTAL = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC',
  '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT',
  '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY', '72': 'PR'
};

function fillFor(summary) {
  if (!summary) return COLORS.neutral;
  if (summary.status === 'tossup' || summary.status === 'split') return 'url(#stripes)';
  return summary.party === 'D' ? COLORS.dem : COLORS.rep;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tooltipHtml(summary, name) {
  if (!summary) return '<div class="title">' + escapeHtml(name) + '</div>';
  let html = '<div class="title">' + escapeHtml(name) + '</div>';
  const notUpSeats = summary.seats.filter(seat => !seat.isRace);
  const raceSeat = summary.seats.find(seat => seat.isRace);

  // Only label the groups when both are present -- that's the case that
  // reads as an unlabeled mashup (one senator not up alongside the actual
  // 2026 race candidates). A state with no 2026 race (both seats solid) or
  // one where every seat shown is part of the race doesn't need the split.
  if (notUpSeats.length && raceSeat) {
    html += '<div class="group-label">Not up in 2026</div>';
  }
  notUpSeats.forEach(seat => {
    html += '<div class="row"><span>' + escapeHtml(seat.senator) + '</span><span class="value">' + (seat.party === 'D' ? 'D' : 'R') + '</span></div>';
  });

  if (raceSeat) {
    if (notUpSeats.length) {
      html += '<div class="group-label">2026 race</div>';
    }
    const r = raceSeat.race;
    html += '<div class="row"><span>' + escapeHtml(r.demCandidate) + (r.demPrimaryPending ? ' (TBD)' : '') + '</span><span class="value">D ' + fmtPct(r.demProbability) + '</span></div>';
    html += '<div class="row"><span>' + escapeHtml(r.repCandidate) + (r.repPrimaryPending ? ' (TBD)' : '') + '</span><span class="value">R ' + fmtPct(r.repProbability) + '</span></div>';
    if (isMaterialIndependent(r)) {
      r.otherTickers.forEach(o => {
        html += '<div class="row"><span>' + escapeHtml(o.candidate) + ' (I)</span><span class="value">' + fmtPct(o.probability) + '</span></div>';
      });
    }
    if (r.stale) {
      html += '<div class="row"><span>as of</span><span class="value">' + escapeHtml(r.staleSince || 'unknown') + '</span></div>';
    }
    // Mirrors the seat-bar's tooltip hint (see tooltipHtml() in app.js) --
    // only states with a 2026 race actually link out to Kalshi (see
    // renderMap below), so only those get the call-to-action line.
    if (r.kalshiUrl) {
      html += '<div class="hint">Click to view on Kalshi &#8599;</div>';
    }
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
  const wrap = document.getElementById('map-wrap');

  svg.selectAll('*').remove();

  svg.append('defs').append('pattern')
    .attr('id', 'stripes')
    .attr('width', 8).attr('height', 8)
    .attr('patternTransform', 'rotate(45)')
    .attr('patternUnits', 'userSpaceOnUse')
    .call(p => {
      p.append('rect').attr('width', 8).attr('height', 8).attr('fill', COLORS.rep);
      p.append('rect').attr('width', 4).attr('height', 8).attr('fill', COLORS.dem);
    });

  const topology = await loadTopology();
  const geo = topojson.feature(topology, topology.objects.states);
  const projection = d3.geoAlbersUsa().fitSize([960, 600], geo);
  const path = d3.geoPath().projection(projection);

  const svgNs = 'http://www.w3.org/2000/svg';

  // States with a 2026 race genuinely link out to Kalshi, same as a
  // seat-bar segment (a real <a href>, not just a click handler) -- see
  // "Map states look clickable but do nothing on click" in
  // feedback/map-and-interactivity.md. Solid/uncontested states have no
  // single race to link to, so they render as plain (non-anchor) nodes and
  // stay non-interactive beyond the hover tooltip.
  svg.append('g')
    .selectAll('.state-node')
    .data(geo.features)
    .join(enter => enter.append(d => {
      const postal = FIPS_TO_POSTAL[d.id];
      const summary = byPostal[postal];
      const href = summary && summary.race && summary.race.kalshiUrl;
      if (href) {
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
    .on('mousemove', (event, d) => {
      const postal = FIPS_TO_POSTAL[d.id];
      if (postal === 'DC' || postal === 'PR') return;
      const rect = wrap.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      tooltip
        .style('display', 'block')
        .style('left', Math.min(x + 14, rect.width - 240) + 'px')
        .style('top', Math.max(y - 60, 4) + 'px')
        .style('transform', 'none')
        .html(tooltipHtml(byPostal[postal], d.properties.name));
    })
    .on('mouseleave', () => tooltip.style('display', 'none'));
}
