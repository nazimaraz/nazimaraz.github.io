#!/bin/sh
# Builds radar.wasm from the committed rt-radar-pipeline sources next to this repository.
# usage: demos/radar/build.sh [path to rt-radar-pipeline]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=${1:-"$here/../../../rt-radar-pipeline"}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git -C "$repo" archive HEAD source/dsp source/app/signal_generator.cpp source/app/signal_generator.hpp | tar -x -C "$work"
em++ -std=c++23 -O2 -Wall -Wextra -fno-exceptions -fno-rtti \
  -I"$work/source" -I"$work/source/app" \
  "$here/radar_wasm.cpp" "$work"/source/dsp/*.cpp "$work/source/app/signal_generator.cpp" \
  --no-entry -sSTANDALONE_WASM -sFILESYSTEM=0 \
  -sEXPORTED_FUNCTIONS=_radar_firmware_block,_radar_reset,_radar_custom_block,_radar_power,_radar_threshold,_radar_detections,_radar_bins \
  -o "$here/radar.wasm"
git -C "$repo" rev-parse --short HEAD > "$here/SOURCE_COMMIT"
