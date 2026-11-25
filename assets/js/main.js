// Nazım Can Araz — personal site: theme toggle, active-section highlighting, the hero's
// live spectrum, the radar playground and the "try it here" demo windows.

import { createRadar, Scope, runWhileVisible, BIN_HZ, BLOCK_MS } from "./scope.js";

const root = document.documentElement;
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const isTurkish = root.lang === "tr";

// --- theme -------------------------------------------------------------------

const isDark = () => (root.dataset.theme ? root.dataset.theme === "dark" : darkQuery.matches);
const themeButton = document.querySelector(".theme-toggle");
const syncThemeButton = () => themeButton?.setAttribute("aria-pressed", String(isDark()));
syncThemeButton();
themeButton?.addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  root.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch { /* private mode */ }
  syncThemeButton();
});
darkQuery.addEventListener("change", syncThemeButton);

// --- top bar border + active nav link ------------------------------------------

const topbar = document.querySelector(".topbar");
const onScroll = () => topbar?.classList.toggle("scrolled", window.scrollY > 8);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

const navLinks = new Map();
document.querySelectorAll(".nav a[href^='#']").forEach((a) => navLinks.set(a.getAttribute("href").slice(1), a));
if ("IntersectionObserver" in window && navLinks.size) {
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navLinks.forEach((a) => a.classList.remove("active"));
      navLinks.get(entry.target.id)?.classList.add("active");
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  navLinks.forEach((_, id) => {
    const section = document.getElementById(id);
    if (section) spy.observe(section);
  });
}

const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());

// --- hero: the firmware's own signal, at a quarter of real time -------------------

const targetWord = (n) => (isTurkish ? "hedef" : n === 1 ? "target" : "targets");
const hz = (bin) => Math.floor(bin * BIN_HZ);

async function startHero(canvas) {
  const log = document.getElementById("scope-log");
  const radar = await createRadar();
  const scope = new Scope(canvas);
  let sequence = 0;
  runWhileVisible(canvas, BLOCK_MS * 4, () => {
    const block = radar.firmwareBlock();
    scope.show(block);
    if (log && sequence % 4 === 0) {
      const list = block.detections.map((d) => hz(d.bin)).join(", ");
      const count = block.detections.length;
      log.innerHTML = `<span>[${Math.round(sequence * BLOCK_MS)} ms] block #${sequence}</span> ` +
        `<span class="hi">${count} ${targetWord(count)}</span>` + (list ? ` <span>(${list} Hz)</span>` : "");
    }
    ++sequence;
  });
}

// --- radar playground -------------------------------------------------------------

async function startLab(lab) {
  const canvas = lab.querySelector("canvas");
  const log = lab.querySelector(".lab-log");
  const inputs = Object.fromEntries([...lab.querySelectorAll("input")].map((i) => [i.name, i]));
  const read = () => ({
    hzA: Number(inputs.hzA.value), ampA: Number(inputs.ampA.value),
    hzB: Number(inputs.hzB.value), ampB: Number(inputs.ampB.value),
    noise: Number(inputs.noise.value), pfa: 10 ** -Number(inputs.pfa.value),
  });
  const format = {
    hzA: (v) => `${v} Hz`, hzB: (v) => `${v} Hz`,
    ampA: (v) => Number(v).toFixed(2), ampB: (v) => Number(v).toFixed(2), noise: (v) => Number(v).toFixed(2),
    pfa: (v) => `10⁻${"⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(v)]}`,
  };
  const syncOutputs = () => {
    for (const [name, input] of Object.entries(inputs)) {
      const out = input.closest("label").querySelector("output");
      out.textContent = format[name](input.value);
      input.setAttribute("aria-valuetext", out.textContent);
    }
  };

  const radar = await createRadar();
  const scope = new Scope(canvas);
  let blocks = 0;
  const step = () => {
    const block = radar.customBlock(read());
    scope.show(block);
    if (blocks++ % 8 === 0) {
      log.textContent = block.detections.length
        ? block.detections.map((d) => `bin ${d.bin} (${hz(d.bin)} Hz) power ${d.power.toFixed(1)} thr ${d.threshold.toFixed(1)}`).join("\n")
        : (isTurkish ? "hedef yok" : "no target");
    }
  };

  lab.addEventListener("input", () => {
    syncOutputs();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { blocks = 0; step(); }
  });
  lab.querySelector(".lab-reset").addEventListener("click", () => {
    for (const input of Object.values(inputs)) input.value = input.defaultValue;
    lab.dispatchEvent(new Event("input"));
  });

  // Drag a tone directly on the plot.
  let dragged = null;
  const drag = (event) => {
    inputs[dragged].value = Math.round(scope.frequencyAt(event.clientX) / 10) * 10;
    lab.dispatchEvent(new Event("input"));
  };
  canvas.addEventListener("pointerdown", (event) => {
    const at = scope.frequencyAt(event.clientX);
    dragged = Math.abs(at - Number(inputs.hzA.value)) <= Math.abs(at - Number(inputs.hzB.value)) ? "hzA" : "hzB";
    canvas.setPointerCapture(event.pointerId);
    drag(event);
  });
  canvas.addEventListener("pointermove", (event) => { if (dragged) drag(event); });
  for (const end of ["pointerup", "pointercancel"]) canvas.addEventListener(end, () => { dragged = null; });

  syncOutputs();
  runWhileVisible(canvas, BLOCK_MS, step);
}

const unavailable = (element) => (error) => {
  console.error(error);
  if (element) element.textContent = isTurkish ? "Spektrum yüklenemedi (WebAssembly gerekiyor)." : "The spectrum could not be loaded (it needs WebAssembly).";
};

const heroCanvas = document.getElementById("spectrum");
if (heroCanvas) startHero(heroCanvas).catch(unavailable(document.getElementById("scope-log")));
const lab = document.getElementById("radar-lab");
if (lab) startLab(lab).catch(unavailable(lab.querySelector(".lab-log")));

// --- demo windows -------------------------------------------------------------------

document.querySelectorAll("[data-demo]").forEach((button) => {
  button.hidden = false;
  button.addEventListener("click", async () => {
    const { openDemo } = await import("./demos.js");
    openDemo(button.dataset.demo, button);
  });
});
