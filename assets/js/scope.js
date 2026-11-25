// Spectrum display for the rt-radar-pipeline DSP code.
//
// radar.wasm is the firmware's own C++ (ADC decoding, Hann window, FFT, power spectrum
// and CA-CFAR) compiled to WebAssembly; see demos/radar. This file only draws.

export const SAMPLE_RATE = 16_000;
export const FFT_SIZE = 256;
export const BIN_HZ = SAMPLE_RATE / FFT_SIZE;
export const BLOCK_MS = (FFT_SIZE / SAMPLE_RATE) * 1000;

const DB_MIN = -12;
const DB_MAX = 48;
const PAD = { l: 34, r: 12, t: 14, b: 24 };
const toDb = (p) => 10 * Math.log10(p + 1e-12);

let modulePromise;

// Each Radar has its own WASM instance, so two displays never share state.
export async function createRadar() {
  modulePromise ??= fetch("/demos/radar/radar.wasm")
    .then((r) => { if (!r.ok) throw new Error(`radar.wasm: HTTP ${r.status}`); return r.arrayBuffer(); })
    .then((bytes) => WebAssembly.compile(bytes));
  const { exports: wasm } = await WebAssembly.instantiate(await modulePromise, {});
  wasm._initialize?.();
  const bins = wasm.radar_bins();

  const collect = (count) => {
    const view = new DataView(wasm.memory.buffer, wasm.radar_detections(), count * 12);
    const detections = [];
    for (let i = 0; i < count; ++i) {
      detections.push({
        bin: view.getUint16(i * 12, true),
        power: view.getFloat32(i * 12 + 4, true),
        threshold: view.getFloat32(i * 12 + 8, true),
      });
    }
    return {
      power: new Float32Array(wasm.memory.buffer, wasm.radar_power(), bins),
      threshold: new Float32Array(wasm.memory.buffer, wasm.radar_threshold(), bins),
      detections,
    };
  };

  return {
    bins,
    firmwareBlock: () => collect(wasm.radar_firmware_block()),
    customBlock: (s) => collect(wasm.radar_custom_block(s.hzA, s.ampA, s.hzB, s.ampB, s.noise, s.pfa)),
  };
}

export class Scope {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.smoothed = null;
    this.last = null;
    const refit = () => { this.resize(); if (this.last) this.paint(); };
    this.resize();
    if ("ResizeObserver" in window) new ResizeObserver(refit).observe(canvas);
    else window.addEventListener("resize", refit);
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  // Frequency under a pointer position, in Hz.
  frequencyAt(clientX) {
    const box = this.canvas.getBoundingClientRect();
    const t = (clientX - box.left - PAD.l) / (box.width - PAD.l - PAD.r);
    return Math.max(0, Math.min(1, t)) * (SAMPLE_RATE / 2);
  }

  show(block) {
    const bins = block.power.length;
    if (!this.smoothed || this.smoothed.length !== bins) {
      this.smoothed = Float32Array.from(block.power, toDb);
    }
    // Smoothing is for the eye only; detection already happened on the raw block.
    for (let k = 0; k < bins; ++k) {
      this.smoothed[k] = this.smoothed[k] * 0.35 + toDb(block.power[k]) * 0.65;
    }
    this.last = { threshold: Float32Array.from(block.threshold), detections: block.detections, bins };
    this.paint();
  }

  paint() {
    const { ctx, width, height } = this;
    if (!width) return;
    const { threshold, detections, bins } = this.last;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const plotW = width - PAD.l - PAD.r;
    const plotH = height - PAD.t - PAD.b;
    const x = (k) => PAD.l + (k / (bins - 1)) * plotW;
    const y = (db) => PAD.t + (1 - (Math.max(DB_MIN, Math.min(DB_MAX, db)) - DB_MIN) / (DB_MAX - DB_MIN)) * plotH;

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(140, 170, 200, 0.10)";
    ctx.fillStyle = "rgba(170, 188, 206, 0.75)";
    ctx.font = "10.5px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (let db = 0; db <= 40; db += 10) {
      const yy = Math.round(y(db)) + 0.5;
      ctx.beginPath(); ctx.moveTo(PAD.l, yy); ctx.lineTo(width - PAD.r, yy); ctx.stroke();
      ctx.fillText(String(db), PAD.l - 6, yy);
    }
    ctx.textBaseline = "top";
    for (let khz = 0; khz <= 8; ++khz) {
      const xx = Math.round(x((khz * 1000) / BIN_HZ)) + 0.5;
      ctx.beginPath(); ctx.moveTo(xx, PAD.t); ctx.lineTo(xx, PAD.t + plotH); ctx.stroke();
      if (khz % 2 === 0) {
        ctx.textAlign = khz === 8 ? "right" : "center";
        ctx.fillText(khz === 8 ? "8 kHz" : String(khz), khz === 8 ? width - PAD.r : xx, PAD.t + plotH + 6);
      }
    }

    const trace = () => {
      ctx.beginPath();
      for (let k = 0; k < bins; ++k) ctx.lineTo(x(k), y(this.smoothed[k]));
    };
    trace();
    ctx.lineTo(x(bins - 1), PAD.t + plotH);
    ctx.lineTo(x(0), PAD.t + plotH);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + plotH);
    fill.addColorStop(0, "rgba(90, 169, 255, 0.35)");
    fill.addColorStop(1, "rgba(90, 169, 255, 0)");
    ctx.fillStyle = fill;
    ctx.fill();
    trace();
    ctx.strokeStyle = "#5aa9ff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // The firmware cannot test the outermost bins: their threshold is infinite.
    ctx.beginPath();
    for (let k = 0; k < bins; ++k) if (Number.isFinite(threshold[k])) ctx.lineTo(x(k), y(toDb(threshold[k])));
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(240, 180, 76, 0.85)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (const { bin, power } of detections) {
      const px = x(bin);
      const py = Math.max(PAD.t + 26, y(toDb(power)));
      ctx.fillStyle = "#58d6c8";
      ctx.beginPath();
      ctx.moveTo(px, py - 4); ctx.lineTo(px - 5, py - 12); ctx.lineTo(px + 5, py - 12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(220, 240, 245, 0.95)";
      ctx.fillText(`${Math.floor(bin * BIN_HZ)} Hz`, Math.max(PAD.l + 26, Math.min(width - PAD.r - 26, px)), py - 14);
    }
  }
}

// Calls step() at a fixed period while the element is on screen, the tab is visible and
// the visitor has not asked for reduced motion (then it runs exactly once).
export function runWhileVisible(element, periodMs, step) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let running = false;
  let visible = !("IntersectionObserver" in window);
  let next = 0;

  const frame = (now) => {
    if (!running) return;
    if (now - next > 500) next = now;
    while (now >= next) { step(); next += periodMs; }
    requestAnimationFrame(frame);
  };
  const update = () => {
    const should = visible && !document.hidden && !reduced.matches;
    if (should && !running) { running = true; requestAnimationFrame(frame); }
    if (!should) running = false;
  };

  step();
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; update(); }).observe(element);
  }
  document.addEventListener("visibilitychange", update);
  reduced.addEventListener("change", update);
  update();
}
