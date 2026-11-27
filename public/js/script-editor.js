// The script editor: a full-screen workspace for writing your own indicators and strategies in
// JavaScript. Your scripts on the left; the code in the middle, with line numbers, highlighting and
// a console; a live preview on the right that runs the script on the active chart's bars as you
// type: its lines and markers on a chart, its inputs to try, and for a strategy the backtest.
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
let root = null;

export async function openScriptEditor(app, { fresh = false, file = null, template = null } = {}) {
  if (root) {
    root.focusEditor?.();
    if (template) root.loadTemplate?.(template);
    return;
  }
  const pane = app.active;
  root = document.createElement("div");
  root.className = "se-root";
  root.innerHTML = `
    <header class="se-top">
      <button class="se-back" data-a="close" title="Back to the chart (Esc)"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg><span>Chart</span></button>
      <div class="se-brand"><svg viewBox="0 0 24 24"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14"/></svg>Script editor</div>
      <div class="se-name"><input id="seName" spellcheck="false" autocomplete="off" title="The file name: custom/<name>.js"><span class="se-kind" id="seKind"></span><span class="se-dirty" id="seDirty" title="Not saved yet"></span></div>
      <span class="se-sp"></span>
      <label class="se-live" title="Run the preview a moment after you stop typing"><input type="checkbox" id="seLive" checked> Live preview</label>
      <button class="se-btn" data-a="run" title="Run the preview (Ctrl+Enter)"><svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>Run<kbd>Ctrl+Enter</kbd></button>
      <button class="se-btn" data-a="save" title="Save to your custom folder (Ctrl+S)">Save<kbd>Ctrl+S</kbd></button>
      <button class="se-btn primary" data-a="use" id="seUse">Add to chart</button>
    </header>
    <div class="se-body">
      <aside class="se-side">
        <div class="se-side-h"><span>New</span></div>
        <div class="se-tpls">${TEMPLATES.map((t) => `<button data-tpl="${t.id}"><b>${esc(t.title)}</b><small>${esc(t.sub)}</small><em class="${t.kind}">${t.kind === "strategy" ? "Strategy" : "Indicator"}</em></button>`).join("")}</div>
        <div class="se-side-h"><span>My scripts</span><input id="seFind" placeholder="Find" spellcheck="false"></div>
        <div class="se-mine" id="seMine"></div>
        <p class="se-foot">Files live in your <code>custom</code> folder. Format: <code>docs/custom-indicators.md</code>. An AI agent can write them too: "add an OpenWick strategy that…".</p>
      </aside>
      <section class="se-code">
        <div class="se-ed" id="seEd"><div class="se-gutter" id="seGut"></div><div class="se-scroll"><pre class="se-hl" id="seHl" aria-hidden="true"></pre><textarea id="seTa" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off"></textarea></div></div>
        <div class="se-split-y" id="seSplitY" title="Drag to resize"></div>
        <div class="se-console" id="seCon"><div class="se-con-h"><span>Console</span><span class="se-pos" id="sePos"></span></div><div class="se-con-b" id="seConB"></div></div>
      </section>
      <div class="se-split-x" id="seSplitX" title="Drag to resize"></div>
      <section class="se-prev">
        <div class="se-prev-h"><b>Preview</b><span id="sePrevOn"></span></div>
        <div class="se-inputs" id="seInputs"></div>
        <div class="se-chart" id="seChart"></div>
        <div class="se-result" id="seResult"></div>
      </section>
    </div>`;
  document.body.appendChild(root);
  document.body.classList.add("se-open");
  const $ = (s) => root.querySelector(s);
  const ta = $("#seTa"), hl = $("#seHl"), gut = $("#seGut");

  // ----- state -----
  let curFile = null, savedCode = "", def = null, params = {}, runTimer = null, previewId = null, errLine = null;
  const isStrategy = () => /\bstrategy\s*:\s*\{/.test(ta.value);
  const setDirty = () => {
    // The dot: changed since it was opened or saved, or a new script that has never been saved.
    $("#seDirty").classList.toggle("on", ta.value !== savedCode || !curFile);
    $("#seDirty").title = curFile ? "Changed since it was saved" : "New: not saved yet";
    const strat = isStrategy();
    $("#seKind").textContent = strat ? "Strategy" : "Indicator";
    $("#seKind").className = `se-kind ${strat ? "strategy" : "indicator"}`;
    $("#seUse").textContent = strat ? "Open in Strategy tester" : "Add to chart";
  };

  // ----- editor -----
  const paint = () => {
    hl.innerHTML = highlight(ta.value);
    const n = ta.value.split("\n").length;
    if (gut.childElementCount !== n) gut.innerHTML = Array.from({ length: n }, (_, i) => `<div>${i + 1}</div>`).join("");
    gut.querySelector(".err")?.classList.remove("err");
    if (errLine) gut.children[errLine - 1]?.classList.add("err");
    syncScroll();
  };
  const syncScroll = () => {
    hl.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    gut.style.transform = `translateY(${-ta.scrollTop}px)`;
  };
  const caret = () => {
    const before = ta.value.slice(0, ta.selectionStart).split("\n");
    $("#sePos").textContent = `Line ${before.length}, column ${before.at(-1).length + 1}`;
  };
  // Edits go through insertText so Ctrl+Z still undoes them.
  const insert = (text) => document.execCommand("insertText", false, text);
  const lineStart = (pos) => ta.value.lastIndexOf("\n", pos - 1) + 1;
  const setCode = (code, { saved = false } = {}) => {
    ta.value = code;
    if (saved) savedCode = code;
    errLine = null;
    paint();
    setDirty();
    ta.scrollTop = 0;
    ta.setSelectionRange(0, 0);
  };
  ta.addEventListener("input", () => {
    errLine = null;
    paint();
    setDirty();
    caret();
    if ($("#seLive").checked) {
      clearTimeout(runTimer);
      runTimer = setTimeout(() => run({ quiet: true }), 700);
    }
  });
  ta.addEventListener("scroll", syncScroll);
  for (const ev of ["click", "keyup", "select"]) ta.addEventListener(ev, caret);
  ta.addEventListener("keydown", (e) => {
    const v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    // Tab / Shift+Tab: indent or outdent the selected lines (or insert two spaces).
    if (e.key === "Tab") {
      e.preventDefault();
      const from = lineStart(a), block = v.slice(from, b);
      if (a === b && !e.shiftKey) return insert("  ");
      const lines = block.split("\n");
      const next = lines.map((l) => (e.shiftKey ? l.replace(/^ {1,2}/, "") : `  ${l}`)).join("\n");
      ta.setSelectionRange(from, b);
      insert(next);
      ta.setSelectionRange(from, from + next.length);
      return;
    }
    // Enter keeps the line's indent, one step more after an opening bracket.
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const line = v.slice(lineStart(a), a);
      const indent = /^\s*/.exec(line)[0];
      const opens = /[{[(]\s*$/.test(line), closes = /^\s*[}\])]/.test(v.slice(a, v.indexOf("\n", a) < 0 ? v.length : v.indexOf("\n", a)));
      if (opens && closes) {
        insert(`\n${indent}  \n${indent}`);
        ta.setSelectionRange(a + indent.length + 3, a + indent.length + 3);
      } else insert(`\n${indent}${opens ? "  " : ""}`);
      return;
    }
    // A closing bracket typed on an empty indented line steps back.
    if (/^[}\])]$/.test(e.key) && a === b) {
      const ls = lineStart(a);
      if (/^\s+$/.test(v.slice(ls, a)) && a - ls >= 2) {
        e.preventDefault();
        ta.setSelectionRange(a - 2, a);
        insert(e.key);
        return;
      }
    }
    // Ctrl+/ comments or uncomments the selected lines.
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

  // ----- console -----
  const log = (html, kind = "") => {
    const box = $("#seConB");
    const t = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    box.insertAdjacentHTML("beforeend", `<div class="se-log ${kind}"><span class="t">${t}</span><span class="m">${html}</span></div>`);
    while (box.childElementCount > 60) box.firstElementChild.remove();
    box.scrollTop = box.scrollHeight;
  };
  // The line a runtime error came from, read from the stack of the script's module.
  const lineOf = (err) => {
    const m = /blob:[^\s)]*?:(\d+):(\d+)/.exec(err?.stack || "");
    return m ? Number(m[1]) : null;
  };

  // ----- preview chart -----
  let chart = null, candles = null, extra = [], markersApi = null;
  const makeChart = () => {
    chart?.remove();
    chart = LW.createChart($("#seChart"), {
      autoSize: true,
      layout: { background: { type: "solid", color: css("--chart-bg") }, textColor: css("--chart-text"), fontSize: 11, attributionLogo: false, panes: { separatorColor: css("--chart-border") } },
      grid: { vertLines: { color: css("--chart-grid") }, horzLines: { color: css("--chart-grid") } },
      rightPriceScale: { borderColor: css("--chart-border") },
      timeScale: { borderColor: css("--chart-border"), timeVisible: true, rightOffset: 4 },
      localization: { priceFormatter: (p) => fmtPrice(p) },
    });
    const up = css("--up") || "#18a57b", down = css("--down") || "#ef4f5e";
    candles = chart.addSeries(LW.CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false, priceLineVisible: false });
    markersApi = LW.createSeriesMarkers(candles, []);
    extra = [];
  };
  const T = (t) => (pane?.toChart ? pane.toChart(t) : t);
  const barsNow = () => (pane?.bars || []).filter((b) => Number.isFinite(b.close));

  function drawPreview(bars, res, d, trades) {
    if (!chart) makeChart();
    for (const s of extra) chart.removeSeries(s);
    extra = [];
    // Remove the panes a previous run added.
    while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1);
    const colors = res.barColors;
    candles.setData(bars.map((b, i) => ({ time: T(b.time), open: b.open, high: b.high, low: b.low, close: b.close, ...(colors?.[i] ? { color: colors[i], wickColor: colors[i] } : {}) })));
    const paneIx = d.overlay === false ? 1 : 0;
    let first = null;
    for (const o of d.outputs) {
      const arr = res[o.key];
      if (!Array.isArray(arr)) continue;
      const hist = o.kind === "histogram";
      const s = chart.addSeries(hist ? LW.HistogramSeries : LW.LineSeries, {
        color: o.color || "#e5a43a",
        ...(hist ? {} : { lineWidth: o.lineWidth || 1.5 }),
        priceLineVisible: false,
        lastValueVisible: paneIx === 1,
        title: o.label || o.key,
      }, paneIx);
      s.setData(bars.map((b, i) => (Number.isFinite(arr[i]) ? { time: T(b.time), value: arr[i], ...(hist && res.colors?.[i] ? { color: res.colors[i] } : {}) } : { time: T(b.time) })));
      first ||= s;
      extra.push(s);
    }
    if (first && paneIx === 1) for (const lv of d.levels || []) first.createPriceLine({ price: lv, color: css("--muted"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    if (paneIx === 1 && chart.panes()[1]) chart.panes()[1].setHeight(Math.round($("#seChart").clientHeight * 0.32));
    const ms = (Array.isArray(res.markers) ? res.markers : []).map((m) => ({ ...m, time: T(m.time) }));
    for (const t of trades || []) {
      ms.push({ time: T(t.entryTime), position: t.side === "long" ? "belowBar" : "aboveBar", shape: t.side === "long" ? "arrowUp" : "arrowDown", color: t.side === "long" ? "#18a57b" : "#e5a43a", text: t.side === "long" ? "Buy" : "Short" });
      ms.push({ time: T(t.exitTime), position: t.side === "long" ? "aboveBar" : "belowBar", shape: "circle", color: t.pnl >= 0 ? "#18a57b" : "#ef4f5e", text: `${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(1)}%` });
    }
    markersApi.setMarkers(ms.sort((a, b) => a.time - b.time));
    if (!drawPreview.fitted) {
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - 180), to: bars.length + 4 });
      drawPreview.fitted = true;
    }
  }

  // The script's inputs, to try values in the preview (saved defaults stay as written in the code).
  function drawInputs(d) {
    const box = $("#seInputs");
    const ins = (d.inputs || []).filter((i) => i.type !== "time");
    box.innerHTML = ins.map((i) => {
      const v = params[i.key] ?? i.default;
      const field = i.type === "select"
        ? `<select data-k="${esc(i.key)}">${i.options.map((o) => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`
        : i.type === "source"
          ? `<select data-k="${esc(i.key)}">${["close", "open", "high", "low", "hl2", "hlc3", "ohlc4", "volume"].map((o) => `<option ${o === v ? "selected" : ""}>${o}</option>`).join("")}</select>`
          : i.type === "bool"
            ? `<input type="checkbox" data-k="${esc(i.key)}" ${v ? "checked" : ""}>`
            : `<input type="number" data-k="${esc(i.key)}" value="${esc(v)}" step="${i.type === "int" ? 1 : "any"}">`;
      return `<label>${esc(i.label || i.key)}${field}</label>`;
    }).join("") + (ins.length ? '<button class="se-reset" title="Back to the defaults in the code">Defaults</button>' : "");
    box.hidden = !ins.length;
    box.onchange = (e) => {
      const el = e.target.closest("[data-k]");
      if (!el) return;
      const inp = ins.find((x) => x.key === el.dataset.k);
      params[el.dataset.k] = el.type === "checkbox" ? el.checked : inp.type === "int" ? Math.round(Number(el.value)) : inp.type === "float" ? Number(el.value) : el.value;
      run({ quiet: true });
    };
    const rb = box.querySelector(".se-reset");
    if (rb) rb.onclick = () => { params = {}; run({ quiet: true }); };
  }

  function drawResult(r, d) {
    const box = $("#seResult");
    if (!r) { box.innerHTML = ""; box.hidden = true; return; }
    const s = r.stats, pc = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v}%`);
    const stat = (k, v, c = "") => `<div><span>${k}</span><b class="${c}">${v ?? "—"}</b></div>`;
    box.hidden = false;
    box.innerHTML = `<div class="se-stats">${stat("Net profit", pc(s.netProfitPct), s.netProfitPct >= 0 ? "up" : "down")}${stat("Buy and hold", pc(s.buyHoldPct))}${stat("Max drawdown", s.maxDrawdownPct == null ? "—" : `-${s.maxDrawdownPct}%`, "down")}${stat("Trades", s.totalTrades)}${stat("Win rate", s.winRatePct == null ? "—" : `${s.winRatePct}%`)}${stat("Profit factor", s.profitFactor)}${stat("Sharpe", s.sharpe)}</div><div class="se-note">${esc(s.feesAndSlippage || "")}. Full report with the equity curve and quant checks: <b>Open in Strategy tester</b>.</div>`;
  }

  // ----- run -----
  let runNo = 0;
  async function run({ quiet = false } = {}) {
    clearTimeout(runTimer);
    const my = ++runNo;
    let code = ta.value;
    if (!/export\s+default/.test(code) && /module\.exports\s*=/.test(code)) code = code.replace(/module\.exports\s*=/, "export default");
    if (!/export\s+default/.test(code)) {
      if (/\/\/\s*@version|^\s*(indicator|study|strategy)\s*\(/m.test(code)) return log("This looks like Pine Script. OpenWick scripts are JavaScript: ask an AI agent to “turn this Pine Script into an OpenWick custom indicator” and paste the result here.", "err");
      return log("The script needs <code>export default { name, calc(bars, p, ta) { … } }</code>. Start from one of the templates on the left.", "err");
    }
    const bars = barsNow();
    if (!bars.length) return log("The active chart has no bars yet, so there's nothing to run on.", "err");
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    const t0 = performance.now();
    try {
      const mod = await import(url);
      if (my !== runNo) return;
      if (!mod.default || typeof mod.default !== "object") throw new Error("export default must be an object: { name, calc(bars, p, ta) { … } }");
      // Run it ourselves first, so an error points at its line in the script; then the format check.
      const raw = mod.default;
      const ins = Array.isArray(raw.inputs) ? raw.inputs : [];
      const known = new Set(ins.map((i) => i?.key));
      params = Object.fromEntries(Object.entries(params).filter(([k]) => known.has(k)));
      const p = { ...Object.fromEntries(ins.map((i) => [i?.key, i?.default])), ...params };
      if (typeof raw.calc !== "function") throw new Error("The script needs a calc(bars, p, ta) function.");
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
      const ms = Math.round(performance.now() - t0);
      errLine = null;
      paint();
      drawInputs(def);
      drawPreview(bars, res, def, result?.trades);
      drawResult(result, def);
      const outs = def.outputs.map((o) => o.key).join(", ");
      const nm = Array.isArray(res.markers) ? res.markers.length : 0;
      if (!quiet || $("#seConB").lastElementChild?.classList.contains("err"))
        log(`Ran on ${esc(ticker(pane.cfg.symbol))} ${esc(pane.cfg.tf)}: ${bars.length.toLocaleString()} bars in ${ms} ms. Outputs: ${esc(outs)}${nm ? `. ${nm} markers` : ""}${result ? `. ${result.stats.totalTrades} trades, ${result.stats.netProfitPct >= 0 ? "+" : ""}${result.stats.netProfitPct}%` : ""}.`, "ok");
    } catch (e) {
      if (my !== runNo) return;
      errLine = lineOf(e);
      paint();
      log(`${errLine ? `<b>Line ${errLine}:</b> ` : ""}${esc(e.message).replace(/\n/g, "<br>")}`, "err");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ----- files -----
  async function refreshList() {
    let list = [];
    try { list = await api.get("/api/custom"); } catch { /* none yet */ }
    const q = $("#seFind").value.trim().toLowerCase();
    const rows = list.filter((c) => !q || c.file.toLowerCase().includes(q)).sort((a, b) => b.mtime - a.mtime);
    $("#seMine").innerHTML = rows.map((c) => {
      const strat = !!BY_ID[c.id]?.strategy;
      return `<div class="se-file ${c.file === curFile ? "cur" : ""}" data-file="${esc(c.file)}"><button class="se-open" title="Open"><span>${esc(c.file.replace(/\.js$/, ""))}</span><em class="${strat ? "strategy" : "indicator"}">${strat ? "Strategy" : "Indicator"}</em>${c.error ? '<i class="se-bad" title="This file has a problem: open it to see it">!</i>' : ""}</button><button class="se-del" title="Delete"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`;
    }).join("") || `<p class="se-empty">${q ? "No match." : "Nothing saved yet. Start from a template above."}</p>`;
    return list;
  }
  const leaveOk = async () => ta.value === savedCode || (await ask("Your changes to this script aren't saved. Discard them?", { ok: "Discard", danger: true }));
  async function openFile(f, list) {
    if (!(await leaveOk())) return;
    const code = await (await fetch(`/custom/${encodeURIComponent(f)}?v=${Date.now()}`)).text();
    curFile = f;
    $("#seName").value = f.replace(/\.js$/, "");
    params = {};
    drawPreview.fitted = false;
    setCode(code, { saved: true });
    refreshList();
    const bad = (list || []).find((c) => c.file === f)?.error;
    if (bad) log(esc(bad).replace(/\n/g, "<br>"), "err");
    run();
  }
  async function loadTemplate(id) {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t || !(await leaveOk())) return;
    curFile = null;
    $("#seName").value = /name:\s*"([^"]+)"/.exec(t.code)?.[1] || "my script";
    params = {};
    drawPreview.fitted = false;
    setCode(t.code, { saved: true });
    refreshList();
    log(`New ${t.kind} from “${esc(t.title)}”. Change it, then Save (Ctrl+S).`);
    run({ quiet: true });
  }
  async function save() {
    const name = $("#seName").value.trim() || /name:\s*["'`]([^"'`]+)/.exec(ta.value)?.[1] || "my script";
    try {
      const r = await api.post("/api/custom", { name, code: ta.value });
      const loaded = await app.importCustom(r.file);
      if (!loaded) throw new Error("Saved, but the chart couldn't load it. Check the console above.");
      curFile = r.file;
      $("#seName").value = r.file.replace(/\.js$/, "");
      savedCode = ta.value;
      setDirty();
      app.panes.forEach((p) => p.render(false));
      log(`Saved <code>custom/${esc(r.file)}</code>.`, "ok");
      refreshList();
      return loaded;
    } catch (e) {
      log(esc(e.message).replace(/\n/g, "<br>"), "err");
      return null;
    }
  }
  async function use() {
    const loaded = ta.value === savedCode && curFile ? BY_ID[`custom:${curFile.replace(/\.js$/, "")}`] : await save();
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
    chart?.remove();
    root.remove();
    root = null;
    document.body.classList.remove("se-open");
    window.removeEventListener("beforeunload", beforeUnload);
  }
  const beforeUnload = (e) => {
    if (ta.value !== savedCode) e.preventDefault();
  };
  window.addEventListener("beforeunload", beforeUnload);

  // ----- wiring -----
  root.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "close") return close();
    if (a === "run") return run();
    if (a === "save") return save();
    if (a === "use") return use();
    const tpl = e.target.closest("[data-tpl]")?.dataset.tpl;
    if (tpl) return loadTemplate(tpl);
    const row = e.target.closest("[data-file]");
    if (!row) return;
    const f = row.dataset.file;
    if (e.target.closest(".se-del")) {
      if (!(await ask(`Delete ${f}? It's removed from your custom folder and from any chart using it.`, { ok: "Delete", danger: true }))) return;
      await api.del(`/api/custom/${encodeURIComponent(f)}`);
      if (f === curFile) { curFile = null; savedCode = ""; setDirty(); }
      log(`Deleted ${esc(f)}.`);
      return refreshList();
    }
    openFile(f, await api.get("/api/custom").catch(() => []));
  });
  $("#seFind").oninput = () => refreshList();
  // Keys stay inside the editor (the chart's own shortcuts would otherwise fire), except these.
  root.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); }
    else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyS") { e.preventDefault(); save(); }
    else if (e.key === "Escape" && !document.querySelector(".ow-dlg-wrap")) { e.preventDefault(); close(); }
    e.stopPropagation();
  });
  // Drag the dividers: code | preview, and editor / console.
  const drag = (handle, onMove) => handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const mv = (ev) => onMove(ev);
    const up = () => { handle.removeEventListener("pointermove", mv); handle.removeEventListener("pointerup", up); };
    handle.addEventListener("pointermove", mv);
    handle.addEventListener("pointerup", up);
  });
  const body = $(".se-body"), codeEl = $(".se-code");
  const savedW = Number(localStorage.getItem("ow.seSplit")) || 0;
  if (savedW) body.style.setProperty("--se-prev", `${savedW}px`);
  drag($("#seSplitX"), (ev) => {
    const w = Math.min(Math.max(320, body.getBoundingClientRect().right - ev.clientX), body.clientWidth - 520);
    body.style.setProperty("--se-prev", `${w}px`);
    localStorage.setItem("ow.seSplit", String(Math.round(w)));
  });
  drag($("#seSplitY"), (ev) => {
    const r = codeEl.getBoundingClientRect();
    codeEl.style.setProperty("--se-con", `${Math.min(Math.max(70, r.bottom - ev.clientY), r.height - 160)}px`);
  });

  root.focusEditor = () => ta.focus();
  root.loadTemplate = loadTemplate;
  $("#sePrevOn").textContent = pane ? `${ticker(pane.cfg.symbol)} · ${pane.cfg.tf} · the active chart's bars` : "";
  makeChart();
  const list = await refreshList();
  if (file) await openFile(file, list);
  else if (template || fresh || !list.length) await loadTemplate(template || "band");
  else await openFile([...list].sort((a, b) => b.mtime - a.mtime)[0].file, list);
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
