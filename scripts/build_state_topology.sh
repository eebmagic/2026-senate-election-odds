#!/usr/bin/env sh
# Regenerates web/vendor/us-states-simplified.json -- the TopoJSON that the
# state choropleth (web/map.js) projects with d3 at runtime.
#
# Source: us-atlas states-10m, the highest-resolution US Census cartographic
# boundary set (~419 arcs of full-detail coastline). Projecting and serializing
# that at 10m detail costs ~600ms of d3.geoPath work on every page load, and we
# only ever draw the map ~975px wide. Simplifying to ~12% of the vertices is
# visually indistinguishable at that size; we also drop the unused "nation"
# object. Net: 112KB / 419 arcs -> ~22KB / ~190 arcs.
#
# Requires: curl and node (mapshaper is fetched on demand via npx).
set -eu

SRC_URL="https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json"
OUT="$(CDPATH= cd "$(dirname "$0")/.." && pwd)/web/vendor/us-states-simplified.json"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

curl -fsSL "$SRC_URL" -o "$TMP"
npx -y mapshaper "$TMP" \
  -simplify 12% keep-shapes \
  -target states \
  -o format=topojson "$OUT"

echo "Wrote $OUT"
