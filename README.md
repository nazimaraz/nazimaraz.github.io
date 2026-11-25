# nazimaraz.github.io

Personal site of Nazım Can Araz: C++ software engineer, real-time systems.

Live at **https://nazimaraz.github.io/** (English) and **https://nazimaraz.github.io/tr/** (Turkish).

Plain HTML, CSS and JavaScript. There is no build step and no framework, and GitHub Pages serves the files as they are.

The spectrum in the hero and the detector playground run the DSP code of
[rt-radar-pipeline](https://github.com/nazimaraz/rt-radar-pipeline) itself: ADC decoding,
Hann window, 256-point FFT, power spectrum and CA-CFAR, compiled unchanged from C++ to
WebAssembly (`demos/radar`). The hero also uses the firmware's signal generator, at a
quarter of real time. Animations pause off screen and draw a single frame when the visitor
prefers reduced motion.

## Demos

Each demo loads only when its window is opened. `SOURCE_COMMIT` records what it was built from.

| Folder | What runs | Built with |
|---|---|---|
| `demos/radar` | firmware DSP code plus a small wrapper | `demos/radar/build.sh` |
| `demos/texrender` | [TeXRender](https://github.com/nazimaraz/TeXRender), SVG backend, Latin Modern Math | `demos/build.sh` |
| `demos/cronwhy` | the [cronwhy](https://github.com/nazimaraz/cronwhy) CLI in a web worker | `demos/build.sh` |
| `demos/clock` | the original `main.asm` on a small PIC16F877A emulator (`pic16.js`) | nothing to build |
| Fourier Series | iframe of its own [live demo](https://nazimaraz.github.io/Fourier-Series/) | |

Third-party code in the binaries: MicroTeX, tinyxml2 and FreeType (TeXRender), Latin Modern
Math (GUST Font License), the Go runtime and `wasm_exec.js` (BSD).

## Layout

```
index.html          English page
tr/index.html       Turkish page (keep in sync with index.html)
assets/css/style.css
assets/js/main.js   theme toggle, active nav link, hero spectrum, radar playground
assets/js/scope.js  spectrum display and the radar WASM loader
assets/js/demos.js  the "try it here" windows
assets/doc/         course certificate
assets/img/         avatar, project images, og.png (1200×630 link preview)
favicon.svg
```

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Paths start with `/`, so open the site through a
server, not as a `file://` page.
