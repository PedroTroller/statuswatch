#!/usr/bin/env bash
# Generates service-cloud.png: a grid of 32×32 service icons, 838px wide.
# Icons are read from proxy/dist/icons/ (run node proxy/fetch-all.js first if stale).
# Usage: ./icon-cloud/build.sh [output.png]
# Requires: node, ImageMagick (convert)
set -euo pipefail

ICON_SIZE=32
GAP=8
WIDTH=838
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT="${1:-"$SCRIPT_DIR/service-cloud.png"}"
ICONS_DIR="$ROOT_DIR/proxy/dist/icons"

command -v convert >/dev/null || { echo "Error: ImageMagick not found (apt install imagemagick)"; exit 1; }
[[ -d "$ICONS_DIR" ]] || { echo "Error: $ICONS_DIR not found — run: node proxy/fetch-all.js"; exit 1; }

# Icons per row so total fits in WIDTH with GAP between each icon
CELL=$(( ICON_SIZE + GAP ))
COLS=$(( (WIDTH + GAP) / CELL ))

# Margin to center the grid horizontally
MARGIN_X=$(( (WIDTH - COLS * ICON_SIZE - (COLS - 1) * GAP) / 2 ))

# Sorted service IDs from catalog
IDS=$(node -e "
const fs  = require('fs');
const src = fs.readFileSync('$ROOT_DIR/proxy/catalog.js', 'utf8');
const CATALOG = new Function(src + '; return CATALOG;')();
console.log(Object.keys(CATALOG).sort().join('\n'));
")

COUNT=$(echo "$IDS" | wc -l)
ROWS=$(( (COUNT + COLS - 1) / COLS ))
HEIGHT=$(( ROWS * ICON_SIZE + (ROWS - 1) * GAP ))

echo "Icons: $COUNT | ${COLS} cols × ${ROWS} rows | ${WIDTH}×${HEIGHT}px | margin: ${MARGIN_X}px"

echo "Compositing..."
ARGS=(-size "${WIDTH}x${HEIGHT}" xc:none)
I=0
while IFS= read -r ID; do
  ICON="$ICONS_DIR/$ID.png"
  if [[ -f "$ICON" ]]; then
    COL=$(( I % COLS ))
    ROW=$(( I / COLS ))
    X=$(( MARGIN_X + COL * CELL ))
    Y=$(( ROW * CELL ))
    ARGS+=("$ICON" -geometry "+${X}+${Y}" -composite)
    I=$(( I + 1 ))
  else
    printf "  ✗ %s (no local icon — skipped)\n" "$ID"
  fi
done <<< "$IDS"

ARGS+=("$OUTPUT")
convert "${ARGS[@]}"

echo "Generated: $OUTPUT (${WIDTH}×${HEIGHT})"
