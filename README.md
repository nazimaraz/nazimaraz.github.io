# nazimaraz.github.io

Personal site of Nazım Can Araz: C++ software engineer, real-time systems.

Live at **https://nazimaraz.github.io/** (English) and **https://nazimaraz.github.io/tr/** (Turkish).

Plain HTML, CSS and JavaScript. There is no build step and no framework, and GitHub Pages serves the files as they are.

The live spectrum in the hero is a JavaScript copy of the
[rt-radar-pipeline](https://github.com/nazimaraz/rt-radar-pipeline) processing chain:
a simulated 16 kHz ADC, a Hann window, a 256-point radix-2 FFT and CA-CFAR detection
(Pfa = 10⁻⁶), one block per animation frame. It pauses when it scrolls out of view
and draws a single still frame when the visitor prefers reduced motion.

## Layout

```
index.html          English page
tr/index.html       Turkish page (keep in sync with index.html)
assets/css/style.css
assets/js/main.js   theme toggle, active nav link, live spectrum
assets/img/         avatar, project images, og.png (1200×630 link preview)
favicon.svg
```

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Paths start with `/`, so open the site through a
server, not as a `file://` page.
