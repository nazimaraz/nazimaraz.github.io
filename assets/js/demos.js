// "Try it here" windows. Each demo runs the project's real code and loads only when opened.

const tr = document.documentElement.lang === "tr";
const t = (en, turkish) => (tr ? turkish : en);

const el = (tag, props = {}, ...children) => {
  const { dataset, ...rest } = props;
  const node = Object.assign(document.createElement(tag), rest);
  if (dataset) Object.assign(node.dataset, dataset);
  node.append(...children);
  return node;
};

const loadScript = (src) => new Promise((resolve, reject) => {
  const script = el("script", { src, onload: resolve, onerror: () => reject(new Error(src)) });
  document.head.append(script);
});

let dialog, title, body, note, cleanup, opener;
let session = 0;   // changes whenever a window opens or closes

function ensureDialog() {
  if (dialog) return;
  title = el("h3");
  note = el("p", { className: "demo-note" });
  body = el("div", { className: "demo-body" });
  const close = el("button", { type: "button", className: "demo-close", textContent: t("Close", "Kapat"), onclick: () => dialog.close() });
  dialog = el("dialog", { className: "demo" }, el("div", { className: "demo-head" }, title, close), body, note);
  dialog.addEventListener("close", () => {
    if (dialog.open) return;   // reopened before this event arrived
    tearDown();
    document.documentElement.classList.remove("demo-open");
    opener?.focus();
  });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  document.body.append(dialog);
}

function tearDown() {
  ++session;
  cleanup?.();
  cleanup = null;
  body.replaceChildren();
}

export async function openDemo(name, button) {
  ensureDialog();
  tearDown();
  const mine = session;
  opener = button;
  const demo = demos[name];
  title.textContent = demo.title;
  note.textContent = demo.note;
  dialog.dataset.name = name;
  const status = el("p", { className: "demo-status", textContent: t("Loading…", "Yükleniyor…") });
  body.replaceChildren(status);
  document.documentElement.classList.add("demo-open");
  dialog.showModal();
  const host = el("div", { className: "demo-content" });
  try {
    const result = await demo.start(host);
    if (mine !== session) { result?.(); return; }
    body.replaceChildren(host);
    cleanup = result;
  } catch (error) {
    console.error(error);
    if (mine !== session) return;
    status.textContent = t("The demo could not be loaded: ", "Demo yüklenemedi: ") + error.message;
  }
}

// --- Fourier Series ---------------------------------------------------------------

async function startFourier(host) {
  host.replaceChildren(el("iframe", {
    src: "https://nazimaraz.github.io/Fourier-Series/",
    title: "Fourier Series Visualizer",
    className: "demo-frame",
    allow: "fullscreen",
  }));
}

// --- TeXRender ----------------------------------------------------------------------

const FORMULAS = [
  ["FFT", "X[k] = \\sum_{n=0}^{N-1} x[n]\\, w[n]\\, e^{-j 2\\pi k n / N}"],
  ["CA-CFAR", "T = \\alpha \\cdot \\frac{1}{N}\\sum_{i=1}^{N} P_i, \\quad \\alpha = N\\left(P_{fa}^{-1/N} - 1\\right)"],
  ["Euler", "e^{i\\pi} + 1 = 0"],
  [t("Matrix", "Matris"), "\\begin{pmatrix} \\cos\\theta & -\\sin\\theta \\\\ \\sin\\theta & \\cos\\theta \\end{pmatrix}"],
];

async function startTeX(host) {
  if (!globalThis.createTeXRenderModule) await loadScript("/demos/texrender/texrender_wasm.js");
  const module = await globalThis.createTeXRenderModule({ locateFile: (file) => `/demos/texrender/${file}` });
  const renderSvg = module.cwrap("texrender_render_svg", "string", ["string", "number", "number", "number"]);
  const lastError = module.cwrap("texrender_last_error", "string", []);

  const input = el("textarea", { rows: 3, spellcheck: false, value: FORMULAS[0][1], ariaLabel: "LaTeX" });
  const picture = el("img", { alt: "" });
  const message = el("p", { className: "demo-status", role: "status" });
  let url;

  const render = () => {
    const started = performance.now();
    const svg = renderSvg(input.value, 88, 0xff16202a, 0);
    const took = performance.now() - started;
    message.classList.toggle("error", !svg);
    if (!svg) { message.textContent = lastError() || t("Could not render this formula.", "Bu formül çizilemedi."); return; }
    URL.revokeObjectURL(url);
    url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    // Drawn at twice the size so the glyphs stay sharp on high-density screens.
    picture.width = Number(/ width="(\d+)"/.exec(svg)[1]) / 2;
    picture.src = url;
    picture.alt = input.value;
    message.textContent = t(`SVG rendered in ${took.toFixed(1)} ms`, `SVG ${took.toFixed(1)} ms'de çizildi`);
  };

  const presets = el("div", { className: "demo-presets" }, ...FORMULAS.map(([label, latex]) =>
    el("button", { type: "button", textContent: label, onclick: () => { input.value = latex; render(); } })));
  input.addEventListener("input", render);
  host.replaceChildren(presets, input, el("div", { className: "demo-paper" }, picture), message);
  render();
  return () => URL.revokeObjectURL(url);
}

// --- cronwhy ------------------------------------------------------------------------

const EXPRESSIONS = ["*/15 9-17 * * 1-5", "0 8 1-7 * MON", "30 2 * * *", "0 0 31 2 *"];
const SAMPLE_CRONTAB = `CRON_TZ=America/New_York
MAILTO=ops@example.com

0 0 * * * /opt/app/bin/rotate-logs >> /var/log/rotate.log 2>&1
30 2 * * * /usr/bin/pg_dump app > /backups/app-$(date +%Y-%m-%d).sql
0 0 31 2 * /opt/app/bin/leap-report >> /var/log/leap.log 2>&1
* * * * * /opt/app/bin/poll
`;

async function startCron(host) {
  const worker = new Worker("/demos/cronwhy/worker.js");
  const queue = [];
  let failed;
  worker.onmessage = ({ data }) => queue.shift()?.(data);
  worker.onerror = (event) => { failed = event.message || "worker"; queue.splice(0).forEach((done) => done({ output: failed, code: -1 })); };
  const run = (args, stdin) => new Promise((done) => { queue.push(done); worker.postMessage({ args, stdin }); });

  const output = el("pre", { className: "term demo-term", tabIndex: 0 });
  const expression = el("input", { type: "text", spellcheck: false, value: EXPRESSIONS[0], ariaLabel: t("Cron expression", "Cron ifadesi") });
  const crontab = el("textarea", { rows: 7, spellcheck: false, value: SAMPLE_CRONTAB, ariaLabel: "crontab" });
  let latest = 0;
  const show = async (command, args, stdin) => {
    const mine = ++latest;
    const { output: text } = await run(args, stdin);
    if (mine === latest) output.replaceChildren(el("span", { className: "prompt", textContent: `$ ${command}\n` }), text);
  };
  const explain = () => show(`cronwhy explain "${expression.value}" -n 5 --tz Europe/Istanbul`,
    ["explain", expression.value, "-n", "5", "--tz", "Europe/Istanbul"]);
  const lint = () => show("cronwhy lint - < crontab", ["lint", "-", "--tz", "Europe/Istanbul"], crontab.value);

  const explainPane = el("div", { className: "demo-pane" },
    el("div", { className: "demo-presets" }, ...EXPRESSIONS.map((text) =>
      el("button", { type: "button", textContent: text, onclick: () => { expression.value = text; explain(); } }))),
    expression);
  const lintPane = el("div", { className: "demo-pane", hidden: true }, crontab);
  const tabs = [
    el("button", { type: "button", textContent: "explain", ariaPressed: "true" }),
    el("button", { type: "button", textContent: "lint", ariaPressed: "false" }),
  ];
  const choose = (index) => {
    tabs.forEach((tab, i) => { tab.ariaPressed = String(i === index); });
    explainPane.hidden = index !== 0;
    lintPane.hidden = index !== 1;
    (index === 0 ? explain : lint)();
  };
  tabs.forEach((tab, index) => { tab.onclick = () => choose(index); });

  let timer;
  const later = (action) => () => { clearTimeout(timer); timer = setTimeout(action, 250); };
  expression.addEventListener("input", later(explain));
  crontab.addEventListener("input", later(lint));

  await explain();
  if (failed) throw new Error(failed);
  host.replaceChildren(el("div", { className: "demo-tabs" }, ...tabs), explainPane, lintPane, output);
  return () => { clearTimeout(timer); worker.terminate(); };
}

// --- PIC16F877A clock -----------------------------------------------------------------

// Segments lit by a 74LS47 for each BCD code: digits, its odd glyphs for 10-14, and blank.
const GLYPHS = ["abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "cdefg", "abc", "abcdefg", "abcfg",
  "deg", "cdg", "bfg", "adfg", "defg", ""];
const SEGMENTS = {
  a: "M14 6h32l-6 8H20z", g: "M18 51h24l5 5-5 5H18l-5-5z", d: "M20 98h20l6 8H14z",
  f: "M10 10l8 8v28l-5 6-3-2z", b: "M50 10l-8 8v28l5 6 3-2z",
  e: "M10 102l8-8V66l-5-6-3 2z", c: "M50 102l-8-8V66l5-6 3 2z",
};

async function startClock(host) {
  const [{ assemble, Pic16, outputs, CYCLES_PER_SECOND }, source] = await Promise.all([
    import("/demos/clock/pic16.js"),
    fetch("/demos/clock/main.asm").then((r) => { if (!r.ok) throw new Error(`main.asm: HTTP ${r.status}`); return r.text(); }),
  ]);
  const cpu = new Pic16(assemble(source));
  cpu.run(CYCLES_PER_SECOND * 0.01);

  const svg = (markup) => { const box = el("div"); box.innerHTML = markup; return box.firstElementChild; };
  const digitSvg = () => svg(`<svg viewBox="0 0 60 112" aria-hidden="true">${Object.entries(SEGMENTS).map(([id, d]) => `<path data-s="${id}" d="${d}"/>`).join("")}</svg>`);
  const digits = [digitSvg(), digitSvg(), digitSvg(), digitSvg()];
  const colon = el("span", { className: "clock-colon" }, el("i"), el("i"));
  const face = el("div", { className: "clock-face", role: "img" }, digits[0], digits[1], colon, digits[2], digits[3]);

  const pinButton = (label, bit) => {
    const button = el("button", { type: "button", textContent: label });
    let down = false;
    const press = () => { if (!down) { down = true; cpu.setPin(bit, true); } };
    // Keep even a quick tap pressed long enough for the program to sample the pin.
    const release = () => { if (down) { down = false; setTimeout(() => cpu.setPin(bit, false), 120); } };
    button.addEventListener("pointerdown", press);
    for (const end of ["pointerup", "pointerleave", "pointercancel", "blur"]) button.addEventListener(end, release);
    button.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) press(); });
    button.addEventListener("keyup", release);
    return button;
  };
  const speed = el("button", { type: "button", ariaPressed: "false", textContent: t("Fast-forward 60×", "60× hızlandır") });
  let factor = 1;
  speed.onclick = () => { factor = factor === 1 ? 60 : 1; speed.ariaPressed = String(factor !== 1); };

  host.replaceChildren(
    face,
    el("div", { className: "demo-presets clock-buttons" },
      pinButton("SET", 0), pinButton(t("UP", "ARTIR"), 1), pinButton(t("DOWN", "AZALT"), 2),
      pinButton(t("LEFT", "SOL"), 4), pinButton(t("RIGHT", "SAĞ"), 3), speed),
    el("p", { className: "demo-status", textContent: t(
      "Press SET to adjust: the selected digit blinks. LEFT/RIGHT choose a digit, UP/DOWN change it, SET again resumes. The program waits about a second after each press, as it did on the board.",
      "Ayar için SET'e basın: seçili hane yanıp söner. SOL/SAĞ haneyi seçer, ARTIR/AZALT değiştirir, SET'e yeniden basınca saat devam eder. Program, gerçek devrede olduğu gibi her basıştan sonra yaklaşık bir saniye bekler.") }),
  );

  let shown = "";
  let stopped = false;
  let last = performance.now();
  const frame = (now) => {
    if (stopped) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    cpu.run(dt * CYCLES_PER_SECOND * factor);
    const state = outputs(cpu);
    const key = state.digits.join() + state.led;
    if (key !== shown) {
      shown = key;
      state.digits.forEach((code, i) => digits[i].querySelectorAll("path").forEach((p) => {
        p.classList.toggle("on", GLYPHS[code].includes(p.dataset.s));
      }));
      colon.classList.toggle("on", state.led);
      const text = state.digits.map((d) => (d < 10 ? d : "–")).join("");
      face.setAttribute("aria-label", `${text.slice(0, 2)}:${text.slice(2)}`);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return () => { stopped = true; };
}

const demos = {
  fourier: {
    title: t("Fourier Series Visualizer", "Fourier Serisi Görselleştirici"),
    note: t("The C++ application compiled to WebAssembly.", "C++ uygulamasının WebAssembly derlemesi."),
    start: startFourier,
  },
  texrender: {
    title: "TeXRender",
    note: t("The C++ library compiled to WebAssembly, with its SVG backend. Type any LaTeX math.",
      "C++ kütüphanesinin SVG arka ucuyla WebAssembly derlemesi. İstediğiniz LaTeX ifadesini yazın."),
    start: startTeX,
  },
  cronwhy: {
    title: "cronwhy",
    note: t("The command-line tool itself, compiled to WebAssembly. Nothing you type leaves your browser.",
      "Komut satırı aracının kendisi, WebAssembly'ye derlenmiş hali. Yazdıklarınız tarayıcınızdan çıkmaz."),
    start: startCron,
  },
  clock: {
    title: t("Microcontroller Clock", "Mikrodenetleyicili Saat"),
    note: t("The original 2019 main.asm, unmodified, running on a PIC16F877A emulator at 20 MHz.",
      "2019'daki main.asm hiç değiştirilmeden, 20 MHz'lik bir PIC16F877A emülatöründe çalışıyor."),
    start: startClock,
  },
};
