#!/bin/sh
# Rebuilds the cronwhy and TeXRender demos. The radar demo has its own build.sh.
# usage: demos/build.sh <cronwhy checkout> <TeXRender checkout with submodules>
# Needs Go, CMake, Ninja and Emscripten.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
cronwhy=$1
texrender=$2

(cd "$cronwhy" && GOOS=js GOARCH=wasm go build -tags timetzdata -trimpath -ldflags "-s -w" -o "$here/cronwhy/cronwhy.wasm" ./cmd/cronwhy)
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" "$here/cronwhy/"
git -C "$cronwhy" rev-parse --short HEAD > "$here/cronwhy/SOURCE_COMMIT"

# TeXRender only loads Latin Modern Math, so leave the other 6 MB of fonts out.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/res/lm-math"
cp "$texrender"/third_party/microtex/res/lm-math/latinmodern-math.clm2 \
   "$texrender"/third_party/microtex/res/lm-math/latinmodern-math.otf "$work/res/lm-math/"
git -C "$texrender" rev-parse --short HEAD > "$here/texrender/SOURCE_COMMIT"
cp -R "$texrender" "$work/src"
sed -i.bak "s|\"--preload-file\" \"\${TEXRENDER_RESOURCE_DIR}@/texrender-res\"|\"--preload-file\" \"$work/res@/texrender-res\" \"-Oz\" \"-sENVIRONMENT=web\"|" "$work/src/CMakeLists.txt"
# Without these flags C++ exceptions cannot be caught, so one invalid formula aborts the module.
flags="-fwasm-exceptions -sSUPPORT_LONGJMP=wasm"
emcmake cmake -S "$work/src" -B "$work/build" -G Ninja -DCMAKE_BUILD_TYPE=MinSizeRel -DTEXRENDER_BACKEND=svg \
  -DCMAKE_C_FLAGS="$flags" -DCMAKE_CXX_FLAGS="$flags" -DCMAKE_EXE_LINKER_FLAGS="$flags"
cmake --build "$work/build" --target texrender_wasm
cp "$work"/build/wasm/texrender_wasm.js "$work"/build/wasm/texrender_wasm.wasm "$work"/build/wasm/texrender_wasm.data "$here/texrender/"
