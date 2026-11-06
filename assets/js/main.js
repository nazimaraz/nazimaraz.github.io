// Nazım Can Araz — personal site.
// Theme toggle, active-section highlighting, and the hero's live spectrum:
// a JavaScript copy of the rt-radar-pipeline chain (Hann window -> radix-2 FFT
// -> CA-CFAR) running on a simulated 16 kHz ADC, one 256-sample block per frame.

(() => {
  "use strict";

  const root = document.documentElement;
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // --- theme ---------------------------------------------------------------

  const isDark = () =>
    root.dataset.theme ? root.dataset.theme === "dark" : darkQuery.matches;

  const themeButton = document.querySelector(".theme-toggle");
  const syncThemeButton = () => {
    if (themeButton) themeButton.setAttribute("aria-pressed", String(isDark()));
  };
  syncThemeButton();

  if (themeButton) {
    themeButton.addEventListener("click", () => {
      const next = isDark() ? "light" : "dark";
      root.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch (_) { /* private mode */ }
      syncThemeButton();
    });
  }
  darkQuery.addEventListener("change", syncThemeButton);

  // --- top bar border + active nav link -------------------------------------

  const topbar = document.querySelector(".topbar");
  const onScroll = () => topbar && topbar.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const navLinks = new Map();
  document.querySelectorAll(".nav a[href^='#']").forEach((a) => {
    navLinks.set(a.getAttribute("href").slice(1), a);
  });
  if ("IntersectionObserver" in window && navLinks.size) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((a) => a.classList.remove("active"));
        const link = navLinks.get(entry.target.id);
        if (link) link.classList.add("active");
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    navLinks.forEach((_, id) => {
      const section = document.getElementById(id);
      if (section) spy.observe(section);
    });
  }

  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  // --- live spectrum -------------------------------------------------------

  const canvas = document.getElementById("spectrum");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const logLine = document.getElementById("scope-log");
  const isTurkish = root.lang === "tr";

  const N = 256;              // samples per block
  const FS = 16000;           // ADC sample rate, Hz
  const BIN_HZ = FS / N;      // 62.5 Hz per bin
  const HALF = N / 2;
  const GUARD = 2;            // CA-CFAR guard cells per side
  const TRAIN = 8;            // CA-CFAR training cells per side
  const PFA = 1e-6;
  const DB_MIN = -30;
  const DB_MAX = 22;

  const hann = new Float32Array(N);
  for (let n = 0; n < N; ++n) hann[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));

  const bits = Math.log2(N);
  const bitrev = new Uint16Array(N);
  for (let i = 0; i < N; ++i) {
    let r = 0;
    for (let b = 0; b < bits; ++b) r |= ((i >> b) & 1) << (bits - 1 - b);
    bitrev[i] = r;
  }
  const cosT = new Float32Array(HALF);
  const sinT = new Float32Array(HALF);
  for (let k = 0; k < HALF; ++k) {
    cosT[k] = Math.cos((2 * Math.PI * k) / N);
    sinT[k] = -Math.sin((2 * Math.PI * k) / N);
  }

  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const power = new Float32Array(HALF);
  const threshold = new Float32Array(HALF);
  const smoothed = new Float32Array(HALF);

  function fft() {
    for (let i = 0; i < N; ++i) {
      const j = bitrev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1;
      const step = N / size;
      for (let start = 0; start < N; start += size) {
        for (let k = 0; k < half; ++k) {
          const wr = cosT[k * step];
          const wi = sinT[k * step];
          const a = start + k;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }

  // Box-Muller gaussian noise.
  let spare = null;
  function gauss() {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    v = Math.random();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  }

  let block = 0;
  const phase = [0, 0, 0];
  const detections = [];

  function processBlock(t) {
    // Simulated ADC: noise plus three slowly sweeping tones (the weakest one
    // hovers around the CFAR threshold, so it is detected only some of the time).
    const tones = [
      { f: 1500 + 700 * Math.sin(t * 0.31), a: 1.0 },
      { f: 5000 + 1400 * Math.sin(t * 0.17 + 1.2), a: 0.45 },
      { f: 3300 + 900 * Math.sin(t * 0.23 + 2.4), a: 0.3 },
    ];
    for (let n = 0; n < N; ++n) {
      let x = 0.35 * gauss();
      for (let i = 0; i < tones.length; ++i) {
        x += tones[i].a * Math.sin(phase[i]);
        phase[i] += (2 * Math.PI * tones[i].f) / FS;
      }
      re[n] = x * hann[n];
      im[n] = 0;
    }
    for (let i = 0; i < phase.length; ++i) phase[i] %= 2 * Math.PI;

    fft();
    for (let k = 0; k < HALF; ++k) power[k] = (re[k] * re[k] + im[k] * im[k]) / N;

    // Cell-averaging CFAR.
    detections.length = 0;
    for (let k = 0; k < HALF; ++k) {
      let sum = 0, count = 0;
      for (let j = k - GUARD - TRAIN; j < k - GUARD; ++j) if (j >= 0) { sum += power[j]; ++count; }
      for (let j = k + GUARD + 1; j <= k + GUARD + TRAIN; ++j) if (j < HALF) { sum += power[j]; ++count; }
      const alpha = count * (Math.pow(PFA, -1 / count) - 1);
      threshold[k] = alpha * (sum / count);
    }
    for (let k = 3; k < HALF - 1; ++k) {
      if (power[k] > threshold[k] && power[k] >= power[k - 1] && power[k] >= power[k + 1]) {
        detections.push(k);
      }
    }
    ++block;
  }

  const toDb = (p) => 10 * Math.log10(p + 1e-12);

  let width = 0, height = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  const PAD = { l: 34, r: 12, t: 14, b: 24 };

  function draw() {
    if (!width) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const plotW = width - PAD.l - PAD.r;
    const plotH = height - PAD.t - PAD.b;
    const x = (k) => PAD.l + (k / (HALF - 1)) * plotW;
    const y = (db) => PAD.t + (1 - (Math.max(DB_MIN, Math.min(DB_MAX, db)) - DB_MIN) / (DB_MAX - DB_MIN)) * plotH;

    // Grid: every 10 dB and every 1 kHz.
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(140, 170, 200, 0.10)";
    ctx.fillStyle = "rgba(160, 180, 200, 0.55)";
    ctx.font = "10.5px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (let db = -20; db <= 20; db += 10) {
      const yy = Math.round(y(db)) + 0.5;
      ctx.beginPath(); ctx.moveTo(PAD.l, yy); ctx.lineTo(width - PAD.r, yy); ctx.stroke();
      ctx.fillText(String(db), PAD.l - 6, yy);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let khz = 0; khz <= 8; ++khz) {
      const xx = Math.round(x(Math.min(HALF - 1, (khz * 1000) / BIN_HZ))) + 0.5;
      ctx.beginPath(); ctx.moveTo(xx, PAD.t); ctx.lineTo(xx, PAD.t + plotH); ctx.stroke();
      if (khz % 2 === 0) {
        ctx.textAlign = khz === 8 ? "right" : "center";
        ctx.fillText(khz === 8 ? "8 kHz" : String(khz), khz === 8 ? width - PAD.r : xx, PAD.t + plotH + 6);
      }
    }

    // Spectrum (lightly smoothed for display only; detection uses the raw block).
    for (let k = 0; k < HALF; ++k) smoothed[k] = smoothed[k] ? smoothed[k] * 0.35 + toDb(power[k]) * 0.65 : toDb(power[k]);

    const grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + plotH);
    grad.addColorStop(0, "rgba(90, 169, 255, 0.35)");
    grad.addColorStop(1, "rgba(90, 169, 255, 0.0)");
    ctx.beginPath();
    ctx.moveTo(x(0), PAD.t + plotH);
    for (let k = 0; k < HALF; ++k) ctx.lineTo(x(k), y(smoothed[k]));
    ctx.lineTo(x(HALF - 1), PAD.t + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    for (let k = 0; k < HALF; ++k) {
      if (k === 0) ctx.moveTo(x(k), y(smoothed[k]));
      else ctx.lineTo(x(k), y(smoothed[k]));
    }
    ctx.strokeStyle = "#5aa9ff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // CFAR threshold.
    ctx.beginPath();
    for (let k = 0; k < HALF; ++k) {
      if (k === 0) ctx.moveTo(x(k), y(toDb(threshold[k])));
      else ctx.lineTo(x(k), y(toDb(threshold[k])));
    }
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(240, 180, 76, 0.85)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.setLineDash([]);

    // Detections.
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (const k of detections) {
      const px = x(k);
      const py = y(toDb(power[k]));
      ctx.fillStyle = "#58d6c8";
      ctx.beginPath();
      ctx.moveTo(px, py - 4); ctx.lineTo(px - 5, py - 12); ctx.lineTo(px + 5, py - 12);
      ctx.closePath();
      ctx.fill();
      const label = `${Math.round(k * BIN_HZ)} Hz`;
      const lx = Math.max(PAD.l + 24, Math.min(width - PAD.r - 24, px));
      ctx.fillStyle = "rgba(220, 240, 245, 0.9)";
      ctx.fillText(label, lx, Math.max(PAD.t + 12, py - 15));
    }
  }

  let lastLog = 0;
  function writeLog(now, force) {
    if (!logLine || (!force && now - lastLog < 250)) return;
    lastLog = now;
    const ms = Math.round(block * (N / FS) * 1000);
    const targets = detections.map((k) => `${Math.round(k * BIN_HZ)}`).join(", ");
    const word = isTurkish ? "hedef" : (detections.length === 1 ? "target" : "targets");
    logLine.innerHTML =
      `<span>[${ms.toLocaleString("en-US")} ms]</span> block #${block} · ` +
      `<span class="hi">${detections.length} ${word}</span>` +
      (targets ? ` <span>(${targets} Hz)</span>` : "");
  }

  let running = false;
  let visible = true;
  let start = performance.now();

  function frame(now) {
    if (!running) return;
    processBlock((now - start) / 1000);
    draw();
    writeLog(now);
    requestAnimationFrame(frame);
  }

  function startLoop() {
    if (running || reducedMotion.matches || !visible || document.hidden) return;
    running = true;
    requestAnimationFrame(frame);
  }
  function stopLoop() { running = false; }

  function renderStill() {
    processBlock(4.2);
    draw();
    writeLog(performance.now(), true);
  }

  resize();
  renderStill();

  if ("ResizeObserver" in window) {
    new ResizeObserver(() => { resize(); draw(); }).observe(canvas);
  } else {
    window.addEventListener("resize", () => { resize(); draw(); });
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible) startLoop(); else stopLoop();
    }).observe(canvas);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopLoop(); else startLoop();
  });
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) { stopLoop(); renderStill(); } else startLoop();
  });

  startLoop();
})();
