#!/usr/bin/env sh
# Regenerates web/vendor/us-states-simplified.json -- the TopoJSON that the
# state choropleth (web/map.js) projects with d3 at runtime.
#
# Source: us-atlas states-10m, the highest-resolution US Census cartographic
# boundary set (~419 arcs of full-detail coastline). Projecting and serializing
# that at 10m detail costs ~600ms of d3.geoPath work on every page load, and we
# only ever draw the map ~975px wide. Simplifying to 25% of the vertices keeps
# coastlines that read as crisp at that size while cutting most of that cost;
# we also drop the unused "nation" object. Net: 112KB / 419 arcs -> ~36KB.
#
# Requires: curl and node (mapshaper is fetched on demand via npx).
set -eu

SRC_URL="https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json"
OUT="$(CDPATH= cd "$(dirname "$0")/.." && pwd)/web/vendor/us-states-simplified.json"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

curl -fsSL "$SRC_URL" -o "$TMP"
npx -y mapshaper "$TMP" \
  -simplify 25% keep-shapes \
  -target states \
  -o format=topojson "$OUT"

echo "Wrote $OUT"
