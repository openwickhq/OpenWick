// The script editor: a full-screen workspace for writing your own indicators and strategies in
// JavaScript. The code on the left, with line numbers, highlighting and a status line that points
// at the line of any error; a live preview on the right that runs the script on the active chart's
// bars as you type: its lines and markers, its inputs to try, and for a strategy the backtest.
// Your saved scripts and the templates are in the Scripts menu.
//
// Indicators follow docs/custom-indicators.md. A strategy is the same file with a `strategy` block
// (money and risk settings) whose calc() returns `position` per bar: 1 long, 0 flat, -1 short.
// Saving writes custom/<name>.js through the server, which checks it before it replaces anything.
import { api, esc, fmtPrice, ticker } from "./api.js";
import { previewIndicator, forgetPreview, BY_ID, ta as TA } from "../lib/indicators.js";
import { backtest } from "../lib/backtest.js";
import { ask } from "./dialog.js";

const LW = window.LightweightCharts;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const STRATEGY_KEYS = ["initialCapital", "positionPct", "feePct", "slippagePct", "spreadPct", "stopLossPct", "takeProfitPct", "trailingStopPct", "maxBarsInTrade", "intrabar", "exitMatch"];

// ---------- templates ----------
const TEMPLATES = [
  {
    id: "band", kind: "indicator", title: "Moving average with bands", sub: "Lines on the price chart, with markers",
    code: `// An indicator: lines on the price chart. The format is in docs/custom-indicators.md.
export default {
  name: "Average with bands",
  overlay: true, // true: on the price chart. false: its own pane under it
  inputs: [
    { key: "length", label: "Length", type: "int", default: 20, min: 1 },
    { key: "mult", label: "Band width", type: "float", default: 2 },
    { key: "source", label: "Source", type: "source", default: "close" },
    { key: "average", label: "Average", type: "select", options: ["SMA", "EMA"], default: "SMA" },
  ],
  outputs: [
    { key: "basis", label: "Basis", color: "#e5a43a", lineWidth: 2 },
    { key: "upper", label: "Upper", color: "#8c8c8c" },
    { key: "lower", label: "Lower", color: "#8c8c8c" },
  ],
  // bars: [{ time, open, high, low, close, volume }], oldest first. p: the inputs above.
  // ta: sma, ema, rsi, atr, stdev, highest, lowest, crossover, compute(id, bars, params)…
  // Return one array per output, as long as bars, with NaN where there's no value yet.
  calc(bars, p, ta) {
    const src = ta.source(bars, p.source);
    const basis = p.average === "EMA" ? ta.ema(src, p.length) : ta.sma(src, p.length);
    const sd = ta.stdev(src, p.length);
    const upper = basis.map((b, i) => b + p.mult * sd[i]);
    const lower = basis.map((b, i) => b - p.mult * sd[i]);
    // Optional: a marker where the close first goes above the upper band.
    const markers = bars
      .filter((bar, i) => i > 0 && bar.close > upper[i] && !(bars[i - 1].close > upper[i - 1]))
      .map((bar) => ({ time: bar.time, position: "aboveBar", shape: "arrowDown", color: "#ef4f5e", text: "Above" }));
    return { basis, upper, lower, markers };
  },
};
`,
  },
  {
    id: "osc", kind: "indicator", title: "Oscillator in its own pane", sub: "RSI with levels and a histogram",
    code: `// An oscillator: its own pane under the chart, with dashed levels.
export default {
  name: "RSI momentum",
  overlay: false,
  inputs: [
    { key: "length", label: "RSI length", type: "int", default: 14, min: 2 },
    { key: "smooth", label: "Signal length", type: "int", default: 9, min: 1 },
  ],
  outputs: [
    { key: "hist", label: "RSI - signal", kind: "histogram", color: "#8c8c8c" },
    { key: "rsi", label: "RSI", color: "#e5a43a", lineWidth: 2 },
    { key: "signal", label: "Signal", color: "#dbdbdb" },
  ],
  levels: [30, 50, 70],
  calc(bars, p, ta) {
    const rsi = ta.rsi(ta.source(bars, "close"), p.length);
    const signal = ta.ema(rsi, p.smooth);
    const hist = rsi.map((v, i) => v - signal[i] + 50); // centred on 50 so it shares the RSI scale
    const colors = hist.map((v) => (v >= 50 ? "#18a57b" : "#ef4f5e"));
    return { rsi, signal, hist, colors };
  },
};
`,
  },
  {
    id: "alerts", kind: "indicator", title: "Alert signals", sub: "Buy and sell outputs to set alerts on",
    code: `// Alert signals: each output is 1 on a bar where its condition is true, 0 otherwise.
// Then: Create alert → this indicator → "Buy" greater than 0 → Once per bar close.
export default {
  name: "EMA cross signals",
  overlay: false,
  inputs: [
    { key: "fast", label: "Fast EMA", type: "int", default: 9, min: 1 },
    { key: "slow", label: "Slow EMA", type: "int", default: 21, min: 2 },
  ],
  outputs: [
    { key: "buy", label: "Buy", kind: "histogram", color: "#18a57b" },
    { key: "sell", label: "Sell", kind: "histogram", color: "#ef4f5e" },
  ],
  calc(bars, p, ta) {
    const close = ta.source(bars, "close");
    const fast = ta.ema(close, p.fast), slow = ta.ema(close, p.slow);
    const up = ta.crossover(fast, slow), down = ta.crossunder(fast, slow);
    const markers = [];
    bars.forEach((b, i) => {
      if (up[i]) markers.push({ time: b.time, position: "belowBar", shape: "arrowUp", color: "#18a57b", text: "Buy" });
      if (down[i]) markers.push({ time: b.time, position: "aboveBar", shape: "arrowDown", color: "#ef4f5e", text: "Sell" });
    });
    return { buy: up.map((x) => (x ? 1 : 0)), sell: down.map((x) => (x ? -1 : 0)), markers };
  },
};
`,
  },
  {
    id: "strat-ema", kind: "strategy", title: "Strategy: trend following", sub: "Long above a crossing of two averages",
    code: `// A strategy: calc() returns \`position\` for every bar. 1 = long, 0 = flat, -1 = short.
// The position is decided at a bar's close and the trade fills at the next bar's open.
// \`strategy\` holds the money and risk settings (all optional, percentages).
export default {
  name: "EMA trend strategy",
  overlay: false,
  strategy: {
    initialCapital: 10000,
    positionPct: 100,   // share of the account in each trade
    feePct: 0.1,        // per side
    slippagePct: 0.05,  // per side
    stopLossPct: 0,     // 0 = off
    takeProfitPct: 0,
    trailingStopPct: 0,
  },
  inputs: [
    { key: "fast", label: "Fast EMA", type: "int", default: 20, min: 1 },
    { key: "slow", label: "Slow EMA", type: "int", default: 50, min: 2 },
    { key: "shorts", label: "Also go short", type: "select", options: ["No", "Yes"], default: "No" },
  ],
  outputs: [{ key: "position", label: "Position", kind: "histogram", color: "#8c8c8c" }],
  calc(bars, p, ta) {
    const close = ta.source(bars, "close");
    const fast = ta.ema(close, p.fast), slow = ta.ema(close, p.slow);
    const position = bars.map((_, i) => {
      if (Number.isNaN(fast[i]) || Number.isNaN(slow[i])) return NaN;
      if (fast[i] > slow[i]) return 1;
      return p.shorts === "Yes" ? -1 : 0;
    });
    const colors = position.map((v) => (v > 0 ? "#18a57b" : v < 0 ? "#ef4f5e" : "#8c8c8c"));
    return { position, colors };
  },
};
`,
  },
  {
    id: "strat-rsi", kind: "strategy", title: "Strategy: buy the dip", sub: "RSI oversold entries, exits on recovery",
    code: `// Buy when RSI drops under a level while price is above its long average; sell when RSI recovers.
export default {
  name: "RSI dip strategy",
  overlay: false,
  strategy: { initialCapital: 10000, positionPct: 100, feePct: 0.1, slippagePct: 0.05, stopLossPct: 8 },
  inputs: [
    { key: "length", label: "RSI length", type: "int", default: 2, min: 2 },
    { key: "buyBelow", label: "Buy under", type: "float", default: 10 },
    { key: "sellAbove", label: "Sell over", type: "float", default: 70 },
    { key: "trend", label: "Trend average", type: "int", default: 200, min: 10 },
  ],
  outputs: [{ key: "position", label: "Position", kind: "histogram", color: "#18a57b" }],
  calc(bars, p, ta) {
    const close = ta.source(bars, "close");
    const rsi = ta.rsi(close, p.length), trend = ta.sma(close, p.trend);
    const position = new Array(bars.length).fill(NaN);
    let pos = 0;
    for (let i = 0; i < bars.length; i++) {
      if (Number.isNaN(rsi[i]) || Number.isNaN(trend[i])) continue;
      if (pos === 0 && rsi[i] < p.buyBelow && close[i] > trend[i]) pos = 1;
      else if (pos === 1 && rsi[i] > p.sellAbove) pos = 0;
      position[i] = pos;
    }
    return { position };
  },
};
`,
  },
  {
    id: "blank", kind: "indicator", title: "Blank indicator", sub: "Just the shape",
    code: `export default {
  name: "My indicator",
  overlay: true,
  inputs: [{ key: "length", label: "Length", type: "int", default: 14, min: 1 }],
  outputs: [{ key: "value", label: "Value", color: "#e5a43a" }],
  calc(bars, p, ta) {
    const value = ta.sma(ta.source(bars, "close"), p.length);
    return { value };
  },
};
`,
  },
];

// ---------- highlighting ----------
const KW = new Set("const let var function return if else for while do of in new true false null undefined NaN Infinity export default this break continue switch case typeof instanceof async await class extends try catch finally throw".split(" "));
function highlight(src) {
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_$][\w$]*)(\s*:(?!:))?|([\s\S])/g;
  let out = "", m, prevDot = false;
  while ((m = re.exec(src))) {
    const [all, com, str, num, word, colon, other] = m;
    if (com) out += `<i class="c">${esc(com)}</i>`;
    else if (str) out += `<i class="s">${esc(str)}</i>`;
    else if (num) out += `<i class="n">${num}</i>`;
    else if (word) {
      const cls = KW.has(word) ? "k" : word === "ta" ? "t" : prevDot ? "p" : colon ? "y" : "";
      out += (cls ? `<i class="${cls}">${word}</i>` : word) + (colon ? esc(colon) : "");
    } else out += esc(other);
    prevDot = other === "." || (prevDot && /^\s$/.test(other || ""));
  }
  return out + "\n";
}

// ---------- the workspace ----------
// Layout: a top bar (back, Scripts menu, name, Run / Save / Add to chart), then two panes side by
// side: the code with a status line under it, and the preview (inputs, chart, backtest). In a
// narrow window the preview goes under the code. Every pane clips its own content, and the
// preview chart sits in a box of its own, so nothing can spill over anything else.
let root = null;
const ICON = {
  back: '<path d="M15 6l-6 6 6 6"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  chev: '<path d="M7 10l5 5 5-5"/>',
  run: '<path d="M8 5.5v13l10.5-6.5z"/>',
  save: '<path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>',
  ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  err: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17v.01"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

export async function openScriptEditor(app, { fresh = false, file = null, template = null } = {}) {
  if (root) {
    root.api.focus();
    if (template) root.api.loadTemplate(template);
    return;
  }
  const pane = app.active;
  root = document.createElement("div");
  root.className = "sx";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Script editor");
  root.innerHTML = `
    <header class="sx-bar">
      <button class="sx-btn ghost" data-a="close" title="Back to the chart (Esc)">${svg("back")}<span>Chart</span></button>
      <span class="sx-div" aria-hidden="true"></span>
      <button class="sx-btn ghost" data-a="menu" id="sxMenuBtn" aria-haspopup="true" aria-expanded="false" title="Your scripts, and new ones from a template">${svg("list")}<span>Scripts</span>${svg("chev")}</button>
      <div class="sx-title">
        <input id="sxName" aria-label="Script name (its file name)" spellcheck="false" autocomplete="off">
        <span class="sx-tag" id="sxKind"></span>
        <span class="sx-state" id="sxState"></span>
      </div>
      <span class="sx-fill"></span>
      <button class="sx-btn icon" data-a="help" title="How scripts work" aria-label="How scripts work">${svg("help")}</button>
      <button class="sx-btn icon" data-a="pane" id="sxPaneBtn" title="Show or hide the preview" aria-label="Show or hide the preview" aria-pressed="true">${svg("panel")}</button>
      <button class="sx-btn" data-a="run" title="Run the preview (Ctrl+Enter)">${svg("run")}<span>Run</span></button>
      <button class="sx-btn" data-a="save" title="Save to your custom folder (Ctrl+S)">${svg("save")}<span>Save</span></button>
      <button class="sx-btn primary" data-a="use" id="sxUse"></button>
    </header>
    <main class="sx-main" id="sxMain">
      <section class="sx-code" aria-label="Code">
        <div class="sx-ed">
          <div class="sx-gut" id="sxGut" aria-hidden="true"></div>
          <div class="sx-area">
            <pre class="sx-hl" id="sxHl" aria-hidden="true"></pre>
            <textarea id="sxTa" aria-label="Script code" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off"></textarea>
          </div>
        </div>
        <div class="sx-err" id="sxErr" hidden role="alert"></div>
        <footer class="sx-status">
          <span class="sx-msg" id="sxMsg" role="status" aria-live="polite"></span>
          <span class="sx-pos" id="sxPos"></span>
        </footer>
      </section>
      <div class="sx-split" id="sxSplit" role="separator" aria-orientation="vertical" aria-label="Resize the preview" tabindex="0"></div>
      <section class="sx-prev" id="sxPrev" aria-label="Preview">
        <div class="sx-prev-h"><b>Preview</b><span id="sxOn"></span></div>
        <form class="sx-inputs" id="sxInputs" hidden></form>
        <div class="sx-chart"><div class="sx-chart-in" id="sxChart"></div></div>
        <div class="sx-bt" id="sxBt" hidden></div>
      </section>
    </main>
    <div class="sx-pop" id="sxMenu" hidden role="menu" aria-label="Scripts"></div>
    <div class="sx-pop sx-help" id="sxHelp" hidden></div>`;
  document.body.appendChild(root);
  document.body.classList.add("sx-open");
  const $ = (s) => root.querySelector(s);
  const ta = $("#sxTa"), hl = $("#sxHl"), gut = $("#sxGut");

  // ----- state -----
  let curFile = null, savedCode = "", def = null, params = {}, runTimer = null, previewId = null, errLine = null, files = [];
  const changed = () => ta.value !== savedCode;
  const isStrategy = () => /\bstrategy\s*:\s*\{/.test(ta.value);
  const syncTitle = () => {
    const nm = $("#sxName");
    // Measure the name in the field's own font, so the field fits it exactly.
    const cx = (syncTitle.cx ||= document.createElement("canvas").getContext("2d"));
    const fs = getComputedStyle(nm);
    cx.font = `${fs.fontWeight} ${fs.fontSize} ${fs.fontFamily}`;
    nm.style.width = `${Math.ceil(Math.max(cx.measureText(nm.value || "my script").width, 60)) + 24}px`;
    const strat = isStrategy();
    $("#sxKind").textContent = strat ? "Strategy" : "Indicator";
    $("#sxKind").className = `sx-tag ${strat ? "strategy" : ""}`;
    $("#sxUse").textContent = strat ? "Open in Strategy tester" : "Add to chart";
    const st = $("#sxState");
    st.textContent = !curFile ? "Not saved yet" : changed() ? "Edited" : "Saved";
    st.className = `sx-state ${!curFile || changed() ? "warn" : ""}`;
  };

  // ----- status and errors -----
  const status = (text, kind = "") => {
    $("#sxMsg").innerHTML = `${kind ? svg(kind === "ok" ? "ok" : "err") : ""}<span>${text}</span>`;
    $("#sxMsg").className = `sx-msg ${kind}`;
  };
  const showError = (msg, line) => {
    errLine = line || null;
    const box = $("#sxErr");
    box.hidden = false;
    box.innerHTML = `<div class="sx-err-h">${svg("err")}<b>${line ? `Problem on line ${line}` : "Problem"}</b><span class="sx-fill"></span>${line ? `<button class="sx-btn small" data-a="goto">Go to line ${line}</button>` : ""}<button class="sx-btn icon small" data-a="errx" aria-label="Hide this message">${svg("x")}</button></div><pre>${esc(msg)}</pre>`;
    status(line ? `Error on line ${line}` : "Error: see above", "err");
    paint();
  };
  const clearError = () => {
    errLine = null;
    $("#sxErr").hidden = true;
  };
  const lineOf = (err) => Number(/blob:[^\s)]*?:(\d+):\d+/.exec(err?.stack || "")?.[1]) || null;

  // ----- editor -----
  const paint = () => {
    hl.innerHTML = highlight(ta.value);
    const n = ta.value.split("\n").length;
    if (gut.childElementCount !== n) gut.innerHTML = Array.from({ length: n }, (_, i) => `<div>${i + 1}</div>`).join("");
    gut.querySelector(".bad")?.classList.remove("bad");
    if (errLine) gut.children[errLine - 1]?.classList.add("bad");
    sync();
  };
  const sync = () => {
    hl.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    gut.style.transform = `translateY(${-ta.scrollTop}px)`;
  };
  const caret = () => {
    const lines = ta.value.slice(0, ta.selectionStart).split("\n");
    $("#sxPos").textContent = `Line ${lines.length}, column ${lines.at(-1).length + 1}`;
  };
  const gotoLine = (n) => {
    const lines = ta.value.split("\n");
    const at = lines.slice(0, n - 1).reduce((a, l) => a + l.length + 1, 0);
    ta.focus();
    ta.setSelectionRange(at, at + (lines[n - 1]?.length || 0));
    ta.scrollTop = Math.max(0, (n - 6) * 20);
    caret();
  };
  // Edits go through insertText so Ctrl+Z undoes them.
  const insert = (text) => document.execCommand("insertText", false, text);
  const lineStart = (pos) => ta.value.lastIndexOf("\n", pos - 1) + 1;
  const setCode = (code) => {
    ta.value = code;
    savedCode = code;
    clearError();
    paint();
    syncTitle();
    ta.scrollTop = 0;
    ta.setSelectionRange(0, 0);
    caret();
  };
  ta.addEventListener("input", () => {
    if (errLine) clearError();
    paint();
    syncTitle();
    caret();
    clearTimeout(runTimer);
    runTimer = setTimeout(() => run(), 700);
  });
  ta.addEventListener("scroll", sync);
  for (const ev of ["click", "keyup", "select"]) ta.addEventListener(ev, caret);
  ta.addEventListener("keydown", (e) => {
    const v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    if (e.key === "Tab") {
      e.preventDefault();
      if (a === b && !e.shiftKey) return insert("  ");
      const from = lineStart(a);
      const next = v.slice(from, b).split("\n").map((l) => (e.shiftKey ? l.replace(/^ {1,2}/, "") : `  ${l}`)).join("\n");
      ta.setSelectionRange(from, b);
      insert(next);
      ta.setSelectionRange(from, from + next.length);
      return;
    }
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const line = v.slice(lineStart(a), a);
      const indent = /^\s*/.exec(line)[0];
      const opens = /[{[(]\s*$/.test(line);
      const rest = v.slice(a, v.indexOf("\n", a) < 0 ? v.length : v.indexOf("\n", a));
      if (opens && /^\s*[}\])]/.test(rest)) {
        insert(`\n${indent}  \n${indent}`);
        ta.setSelectionRange(a + indent.length + 3, a + indent.length + 3);
      } else insert(`\n${indent}${opens ? "  " : ""}`);
      return;
    }
    if (/^[}\])]$/.test(e.key) && a === b) {
      const ls = lineStart(a);
      if (/^\s+$/.test(v.slice(ls, a)) && a - ls >= 2) {
        e.preventDefault();
        ta.setSelectionRange(a - 2, a);
        insert(e.key);
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      const from = lineStart(a), to = v.indexOf("\n", b) < 0 ? v.length : v.indexOf("\n", b);
      const lines = v.slice(from, to).split("\n");
      const off = lines.filter((l) => l.trim()).every((l) => /^\s*\/\//.test(l));
      const next = lines.map((l) => (off ? l.replace(/^(\s*)\/\/ ?/, "$1") : l.trim() ? l.replace(/^(\s*)/, "$1// ") : l)).join("\n");
      ta.setSelectionRange(from, to);
      insert(next);
      ta.setSelectionRange(from, from + next.length);
    }
  });

  // ----- preview -----
  let chart = null, candles = null, extra = [], marks = null, fitted = false;
  const makeChart = () => {
    chart?.remove();
    chart = LW.createChart($("#sxChart"), {
      autoSize: true,
      layout: { background: { type: "solid", color: css("--chart-bg") }, textColor: css("--chart-text"), fontSize: 11, attributionLogo: false, panes: { separatorColor: css("--chart-border") } },
      grid: { vertLines: { color: css("--chart-grid") }, horzLines: { color: css("--chart-grid") } },
      rightPriceScale: { borderColor: css("--chart-border") },
      timeScale: { borderColor: css("--chart-border"), timeVisible: true, rightOffset: 4 },
      localization: { priceFormatter: (p) => fmtPrice(p) },
    });
    const up = css("--up") || "#18a57b", down = css("--down") || "#ef4f5e";
    candles = chart.addSeries(LW.CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false, priceLineVisible: false });
    marks = LW.createSeriesMarkers(candles, []);
    extra = [];
  };
  const T = (t) => (pane?.toChart ? pane.toChart(t) : t);
  const barsNow = () => (pane?.bars || []).filter((b) => Number.isFinite(b.close));

  function drawChart(bars, res, d, trades) {
    for (const s of extra) chart.removeSeries(s);
    extra = [];
    while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1);
    const bc = res.barColors;
    candles.setData(bars.map((b, i) => ({ time: T(b.time), open: b.open, high: b.high, low: b.low, close: b.close, ...(bc?.[i] ? { color: bc[i], wickColor: bc[i] } : {}) })));
    const own = d.overlay === false ? 1 : 0;
    let first = null;
    for (const o of d.outputs) {
      const arr = res[o.key];
      if (!Array.isArray(arr)) continue;
      const hist = o.kind === "histogram";
      const s = chart.addSeries(hist ? LW.HistogramSeries : LW.LineSeries, { color: o.color || "#e5a43a", ...(hist ? {} : { lineWidth: o.lineWidth || 1.5 }), priceLineVisible: false, lastValueVisible: own === 1, title: o.label || o.key }, own);
      s.setData(bars.map((b, i) => (Number.isFinite(arr[i]) ? { time: T(b.time), value: arr[i], ...(hist && res.colors?.[i] ? { color: res.colors[i] } : {}) } : { time: T(b.time) })));
      first ||= s;
      extra.push(s);
    }
    if (first && own) for (const lv of d.levels || []) first.createPriceLine({ price: lv, color: css("--muted"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    if (own && chart.panes()[1]) chart.panes()[1].setHeight(Math.round($("#sxChart").clientHeight * 0.3));
    const ms = (Array.isArray(res.markers) ? res.markers : []).map((m) => ({ ...m, time: T(m.time) }));
    for (const t of trades || []) {
      ms.push({ time: T(t.entryTime), position: t.side === "long" ? "belowBar" : "aboveBar", shape: t.side === "long" ? "arrowUp" : "arrowDown", color: t.side === "long" ? "#18a57b" : "#e5a43a", text: t.side === "long" ? "Buy" : "Short" });
      ms.push({ time: T(t.exitTime), position: t.side === "long" ? "aboveBar" : "belowBar", shape: "circle", color: t.pnl >= 0 ? "#18a57b" : "#ef4f5e", text: `${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(1)}%` });
    }
    marks.setMarkers(ms.sort((a, b) => a.time - b.time));
    if (!fitted) {
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - 160), to: bars.length + 4 });
      fitted = true;
    }
  }

  // The script's inputs, to try other values here (the defaults in the code don't change).
  function drawInputs(d) {
    const box = $("#sxInputs");
    const ins = (d.inputs || []).filter((i) => i.type !== "time");
    box.hidden = !ins.length;
    if (!ins.length) return (box.innerHTML = "");
    const opt = (list, v) => list.map((o) => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("");
    box.innerHTML = `<div class="sx-sub"><b>Inputs</b><span>Try values here; the defaults stay as written in the code.</span><button type="button" class="sx-link" data-a="defaults">Reset</button></div><div class="sx-fields">${ins.map((i, n) => {
      const v = params[i.key] ?? i.default, id = `sxIn${n}`;
      const field = i.type === "select" ? `<select id="${id}" data-k="${esc(i.key)}">${opt(i.options, v)}</select>`
        : i.type === "source" ? `<select id="${id}" data-k="${esc(i.key)}">${opt(["close", "open", "high", "low", "hl2", "hlc3", "ohlc4", "volume"], v)}</select>`
          : i.type === "bool" ? `<input id="${id}" type="checkbox" data-k="${esc(i.key)}" ${v ? "checked" : ""}>`
            : `<input id="${id}" type="number" data-k="${esc(i.key)}" value="${esc(v)}" step="${i.type === "int" ? 1 : "any"}">`;
      return `<div class="sx-field"><label for="${id}">${esc(i.label || i.key)}</label>${field}</div>`;
    }).join("")}</div>`;
    box.onchange = (e) => {
      const el = e.target.closest("[data-k]");
      if (!el) return;
      const inp = ins.find((x) => x.key === el.dataset.k);
      params[inp.key] = el.type === "checkbox" ? el.checked : inp.type === "int" ? Math.round(Number(el.value)) : inp.type === "float" ? Number(el.value) : el.value;
      run();
    };
    box.onsubmit = (e) => e.preventDefault();
  }

  function drawBacktest(r) {
    const box = $("#sxBt");
    box.hidden = !r;
    if (!r) return (box.innerHTML = "");
    const s = r.stats, pc = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v}%`);
    const cell = (k, v, c = "") => `<div class="sx-stat"><span>${k}</span><b class="${c}">${v ?? "—"}</b></div>`;
    box.innerHTML = `<div class="sx-sub"><b>Backtest</b><span>${esc(s.feesAndSlippage || "")}</span><button type="button" class="sx-link" data-a="use">Full report</button></div><div class="sx-stats">${cell("Net profit", pc(s.netProfitPct), s.netProfitPct >= 0 ? "up" : "down")}${cell("Buy and hold", pc(s.buyHoldPct))}${cell("Max drawdown", s.maxDrawdownPct == null ? "—" : `−${s.maxDrawdownPct}%`)}${cell("Trades", s.totalTrades)}${cell("Win rate", s.winRatePct == null ? "—" : `${s.winRatePct}%`)}${cell("Profit factor", s.profitFactor)}</div>`;
  }

  // ----- run -----
  let runNo = 0;
  async function run() {
    clearTimeout(runTimer);
    const my = ++runNo;
    let code = ta.value;
    if (!/export\s+default/.test(code) && /module\.exports\s*=/.test(code)) code = code.replace(/module\.exports\s*=/, "export default");
    if (!/export\s+default/.test(code)) {
      return showError(/\/\/\s*@version|^\s*(indicator|study|strategy)\s*\(/m.test(code)
        ? "This looks like Pine Script. OpenWick scripts are JavaScript: ask an AI agent to \"turn this Pine Script into an OpenWick custom indicator\" and paste the result here."
        : "The script needs `export default { name, calc(bars, p, ta) { … } }`. Start from a template in the Scripts menu.");
    }
    const bars = barsNow();
    if (!bars.length) return status("The chart behind this has no bars yet, so there's nothing to run on.", "err");
    status("Running…");
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    const t0 = performance.now();
    try {
      const mod = await import(url);
      if (my !== runNo) return;
      const raw = mod.default;
      if (!raw || typeof raw !== "object") throw new Error("export default must be an object: { name, calc(bars, p, ta) { … } }");
      if (typeof raw.calc !== "function") throw new Error("The script needs a calc(bars, p, ta) function.");
      // Run it ourselves first, so an error points at its line; then the format check.
      const ins = Array.isArray(raw.inputs) ? raw.inputs : [];
      const known = new Set(ins.map((i) => i?.key));
      params = Object.fromEntries(Object.entries(params).filter(([k]) => known.has(k)));
      const p = { ...Object.fromEntries(ins.map((i) => [i?.key, i?.default])), ...params };
      const res = raw.calc(bars, p, TA);
      if (!res || typeof res !== "object") throw new Error("calc() must return an object with one array per output, like { value }.");
      if (previewId) forgetPreview(previewId);
      previewId = `preview:${Math.random().toString(36).slice(2, 8)}`;
      def = previewIndicator({ ...raw, id: previewId });
      let result = null;
      if (def.strategy) {
        if (!Array.isArray(res.position)) throw new Error("A strategy's calc() must return `position`: 1 long, 0 flat or -1 short for each bar.");
        const settings = Object.fromEntries(Object.entries(def.strategy).filter(([k]) => STRATEGY_KEYS.includes(k)));
        result = backtest(bars, { ...settings, ...signalRules(previewId, p) });
      }
      clearError();
      paint();
      drawInputs(def);
      drawChart(bars, res, def, result?.trades);
      drawBacktest(result);
      const ms = Math.round(performance.now() - t0);
      const nm = Array.isArray(res.markers) ? res.markers.length : 0;
      status(`Ran on ${esc(ticker(pane.cfg.symbol))} ${esc(pane.cfg.tf)} · ${bars.length.toLocaleString()} bars · ${ms} ms · ${def.outputs.length} output${def.outputs.length === 1 ? "" : "s"}${nm ? ` · ${nm} markers` : ""}${result ? ` · ${result.stats.totalTrades} trades` : ""}`, "ok");
    } catch (e) {
      if (my !== runNo) return;
      showError(e.message, lineOf(e));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ----- the Scripts menu: your scripts, then templates -----
  const menu = $("#sxMenu"), menuBtn = $("#sxMenuBtn");
  async function loadFiles() {
    try { files = await api.get("/api/custom"); } catch { files = []; }
    return files;
  }
  function drawMenu(q = "") {
    const f = q.trim().toLowerCase();
    const mine = files.filter((c) => !f || c.file.toLowerCase().includes(f)).sort((a, b) => b.mtime - a.mtime);
    const tpls = TEMPLATES.filter((t) => !f || `${t.title} ${t.sub}`.toLowerCase().includes(f));
    const kind = (strat) => `<span class="sx-tag ${strat ? "strategy" : ""}">${strat ? "Strategy" : "Indicator"}</span>`;
    menu.querySelector(".sx-menu-b").innerHTML =
      `<div class="sx-menu-h">My scripts</div>${mine.map((c) => `<div class="sx-row ${c.file === curFile ? "cur" : ""}"><button role="menuitem" data-open="${esc(c.file)}"><span class="sx-row-t">${esc(c.file.replace(/\.js$/, ""))}${c.error ? ' <em class="sx-bad">has a problem</em>' : ""}</span>${kind(!!BY_ID[c.id]?.strategy)}</button><button class="sx-btn icon small" data-del="${esc(c.file)}" aria-label="Delete ${esc(c.file)}" title="Delete">${svg("x")}</button></div>`).join("") || `<p class="sx-none">${f ? "No match." : "None saved yet."}</p>`}` +
      `<div class="sx-menu-h">Start new</div>${tpls.map((t) => `<div class="sx-row"><button role="menuitem" data-tpl="${t.id}"><span class="sx-row-t">${esc(t.title)}<small>${esc(t.sub)}</small></span>${kind(t.kind === "strategy")}</button></div>`).join("")}`;
  }
  async function openMenu() {
    hideHelp();
    menu.innerHTML = `<input class="sx-find" placeholder="Find a script or template" aria-label="Find a script or template" spellcheck="false"><div class="sx-menu-b"></div>`;
    await loadFiles();
    drawMenu();
    menu.style.left = `${Math.max(8, menuBtn.getBoundingClientRect().left)}px`;
    menu.hidden = false;
    menuBtn.setAttribute("aria-expanded", "true");
    const find = menu.querySelector(".sx-find");
    find.oninput = () => drawMenu(find.value);
    find.focus();
  }
  const hideMenu = () => {
    menu.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
  };
  menu.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...menu.querySelectorAll(".sx-find, [role=menuitem]")];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  });

  // ----- help -----
  const help = $("#sxHelp");
  const hideHelp = () => (help.hidden = true);
  help.innerHTML = `<div class="sx-sub"><b>How scripts work</b><span class="sx-fill"></span><button type="button" class="sx-btn icon small" data-a="helpx" aria-label="Close">${svg("x")}</button></div>
    <p>A script is one JavaScript file: <code>export default { name, inputs, outputs, calc(bars, p, ta) }</code>. <code>calc</code> returns one array per output, as long as <code>bars</code>.</p>
    <p><b>Strategy:</b> add a <code>strategy: { … }</code> block and return <code>position</code> per bar: 1 long, 0 flat, −1 short.</p>
    <p><b>ta</b> has sma, ema, rma, wma, hma, rsi, atr, stdev, highest, lowest, crossover, crossunder, source and more, plus <code>compute(id, bars, params)</code> for any built-in indicator.</p>
    <dl><dt>Ctrl+Enter</dt><dd>Run</dd><dt>Ctrl+S</dt><dd>Save</dd><dt>Tab / Shift+Tab</dt><dd>Indent</dd><dt>Ctrl+/</dt><dd>Comment lines</dd><dt>Esc</dt><dd>Back to the chart</dd></dl>
    <p class="sx-dim">Full format: <code>docs/custom-indicators.md</code>. Files are saved in your <code>custom</code> folder.</p>`;

  // ----- files -----
  const leaveOk = async () => !changed() || (await ask("Your changes to this script aren't saved. Discard them?", { ok: "Discard", danger: true }));
  async function openFile(f) {
    if (!(await leaveOk())) return;
    const code = await (await fetch(`/custom/${encodeURIComponent(f)}?v=${Date.now()}`)).text();
    curFile = f;
    $("#sxName").value = f.replace(/\.js$/, "");
    params = {};
    fitted = false;
    setCode(code);
    const bad = files.find((c) => c.file === f)?.error;
    if (bad) showError(bad);
    else run();
  }
  async function loadTemplate(id) {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t || !(await leaveOk())) return;
    curFile = null;
    $("#sxName").value = /name:\s*"([^"]+)"/.exec(t.code)?.[1] || "my script";
    params = {};
    fitted = false;
    setCode(t.code);
    syncTitle();
    run();
  }
  async function save() {
    const name = $("#sxName").value.trim() || /name:\s*["'`]([^"'`]+)/.exec(ta.value)?.[1] || "my script";
    status("Saving…");
    try {
      const r = await api.post("/api/custom", { name, code: ta.value });
      const loaded = await app.importCustom(r.file);
      if (!loaded) throw new Error("Saved, but the chart couldn't load it.");
      curFile = r.file;
      $("#sxName").value = r.file.replace(/\.js$/, "");
      savedCode = ta.value;
      syncTitle();
      app.panes.forEach((p) => p.render(false));
      status(`Saved as custom/${esc(r.file)}`, "ok");
      loadFiles();
      return loaded;
    } catch (e) {
      showError(e.message);
      return null;
    }
  }
  async function use() {
    const loaded = !changed() && curFile ? BY_ID[`custom:${curFile.replace(/\.js$/, "")}`] : await save();
    if (!loaded) return;
    await close(true);
    if (loaded.strategy) {
      app.panels.loadStrategy(`cs:${loaded.id}`);
      app.toast(`${esc(loaded.name)} is in the Strategy tester, run on ${esc(ticker(app.active.cfg.symbol))}.`);
    } else {
      app.active.addIndicator(loaded.id);
      app.toast(`Added ${esc(loaded.name)} to the chart.`);
    }
  }
  async function close(force = false) {
    if (!force && !(await leaveOk())) return;
    clearTimeout(runTimer);
    if (previewId) forgetPreview(previewId);
    ro.disconnect();
    chart?.remove();
    root.remove();
    root = null;
    document.body.classList.remove("sx-open");
    window.removeEventListener("beforeunload", beforeUnload);
    app.active?.el?.focus?.();
  }
  const beforeUnload = (e) => {
    if (changed()) e.preventDefault();
  };
  window.addEventListener("beforeunload", beforeUnload);

  // ----- layout: the divider, hiding the preview, narrow windows -----
  const main = $("#sxMain");
  const setPrev = (w) => {
    const max = main.clientWidth - 380;
    const v = Math.round(Math.min(Math.max(320, w), Math.max(320, max)));
    main.style.setProperty("--sx-prev", `${v}px`);
    localStorage.setItem("ow.sxPrev", String(v));
  };
  const savedW = Number(localStorage.getItem("ow.sxPrev"));
  if (savedW) main.style.setProperty("--sx-prev", `${savedW}px`);
  const split = $("#sxSplit");
  split.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    split.setPointerCapture(e.pointerId);
    const mv = (ev) => setPrev(main.getBoundingClientRect().right - ev.clientX);
    const up = () => { split.removeEventListener("pointermove", mv); split.removeEventListener("pointerup", up); };
    split.addEventListener("pointermove", mv);
    split.addEventListener("pointerup", up);
  });
  split.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 80 : 24;
    if (e.key === "ArrowLeft") setPrev($("#sxPrev").clientWidth + step);
    if (e.key === "ArrowRight") setPrev($("#sxPrev").clientWidth - step);
  });
  const setPaneShown = (on) => {
    main.classList.toggle("no-prev", !on);
    $("#sxPaneBtn").setAttribute("aria-pressed", String(on));
    localStorage.setItem("ow.sxPrevOff", on ? "" : "1");
  };
  setPaneShown(!localStorage.getItem("ow.sxPrevOff"));
  // Narrow window: the preview goes under the code.
  const ro = new ResizeObserver(() => main.classList.toggle("stack", main.clientWidth < 900));
  ro.observe(main);

  // ----- wiring -----
  root.addEventListener("click", async (e) => {
    const t = e.target;
    if (!menu.hidden && !menu.contains(t) && !menuBtn.contains(t)) hideMenu();
    if (!help.hidden && !help.contains(t) && !t.closest('[data-a="help"]')) hideHelp();
    const a = t.closest("[data-a]")?.dataset.a;
    if (a === "close") return close();
    if (a === "menu") return menu.hidden ? openMenu() : hideMenu();
    if (a === "help") { hideMenu(); return (help.hidden = !help.hidden); }
    if (a === "helpx") return hideHelp();
    if (a === "pane") return setPaneShown(main.classList.contains("no-prev"));
    if (a === "run") return run();
    if (a === "save") return save();
    if (a === "use") return use();
    if (a === "goto" && errLine) return gotoLine(errLine);
    if (a === "errx") return clearError();
    if (a === "defaults") { params = {}; return run(); }
    const open = t.closest("[data-open]")?.dataset.open;
    if (open) { hideMenu(); return openFile(open); }
    const tpl = t.closest("[data-tpl]")?.dataset.tpl;
    if (tpl) { hideMenu(); return loadTemplate(tpl); }
    const del = t.closest("[data-del]")?.dataset.del;
    if (del) {
      if (!(await ask(`Delete ${del}? It's removed from your custom folder and from any chart using it.`, { ok: "Delete", danger: true }))) return;
      await api.del(`/api/custom/${encodeURIComponent(del)}`);
      if (del === curFile) { curFile = null; syncTitle(); }
      status(`Deleted ${esc(del)}`);
      await loadFiles();
      drawMenu(menu.querySelector(".sx-find")?.value || "");
    }
  });
  $("#sxName").addEventListener("input", syncTitle);
  // Keys stay inside the editor (the chart's own shortcuts would otherwise fire), except these.
  root.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "Enter") { e.preventDefault(); run(); }
    else if (mod && !e.shiftKey && e.code === "KeyS") { e.preventDefault(); save(); }
    else if (e.key === "Escape" && !document.querySelector(".ow-dlg-wrap")) {
      e.preventDefault();
      if (!menu.hidden) { hideMenu(); menuBtn.focus(); }
      else if (!help.hidden) hideHelp();
      else close();
    }
    e.stopPropagation();
  });

  root.api = { focus: () => ta.focus(), loadTemplate };
  $("#sxOn").textContent = pane ? `${ticker(pane.cfg.symbol)} · ${pane.cfg.tf}` : "";
  makeChart();
  await loadFiles();
  if (file) await openFile(file);
  else if (template || fresh || !files.length) await loadTemplate(template || "band");
  else await openFile([...files].sort((a, b) => b.mtime - a.mtime)[0].file);
  ta.focus();
}

// The tester rules that trade a coded strategy's position output: long while above 0, short below.
export function signalRules(id, params = {}) {
  const ind = { signal: { id, params, output: "position" } };
  return {
    indicators: ind,
    entryLong: [{ left: "signal", op: ">", right: 0 }],
    exitLong: [{ left: "signal", op: "<=", right: 0 }],
    entryShort: [{ left: "signal", op: "<", right: 0 }],
    exitShort: [{ left: "signal", op: ">=", right: 0 }],
  };
}
