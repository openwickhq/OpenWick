// One chart: candles + volume + any number of indicators, drawings, compare symbols, replay and live data.
import { api, fmtPrice, fmtPct, esc, ticker, exchange } from "./api.js";
import { BY_ID, compute, periodKey } from "../lib/indicators.js";
import {
  parseTf,
  isIntraday,
  heikinAshi,
  renko,
  lineBreak,
  rangeBars,
  kagi,
  pointFigure,
} from "../lib/series.js";
import { DrawingLayer, TOOL_BY_ID, constrain45, snapToOHLC } from "./drawings.js";
import { DrawToolbar } from "./draw-toolbar.js";
import { currencyOf } from "./currency.js";
import { CURRENCIES, fiatOf, canConvert, convertBars } from "./fx.js";
import { VolumeProfile, SessionVolumeProfile } from "./volume-profile.js";
import { SessionLayer } from "./sessions.js";
import { StdDevChannel } from "./std-channel.js";

const LW = window.LightweightCharts;

export const CHART_TYPES = [
  ["candles", "Candles"],
  ["hollow", "Hollow candles"],
  ["bars", "Bars"],
  ["heikin", "Heikin Ashi"],
  ["line", "Line"],
  ["linemarkers", "Line with markers"],
  ["step", "Step line"],
  ["area", "Area"],
  ["baseline", "Baseline"],
  ["columns", "Columns"],
  ["renko", "Renko"],
  ["linebreak", "Line break"],
  ["range", "Range bars"],
  ["kagi", "Kagi"],
  ["pnf", "Point & figure"],
];
// Chart types built from price alone, with no meaningful volume per bar.
const PRICE_ONLY = ["renko", "linebreak", "kagi", "pnf"];
const BINANCE_WS_TF = {
  "1s": "1s",
  "1m": "1m",
  "3m": "3m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "2h": "2h",
  "4h": "4h",
  "6h": "6h",
  "8h": "8h",
  "12h": "12h",
  "1D": "1d",
  "3D": "3d",
  "1W": "1w",
  "1M": "1M",
};
const ICON = {
  gear: '<svg viewBox="0 0 24 24"><path d="M10.3 3h3.4l.5 2.3 1.9.8 2-1.3 2.4 2.4-1.3 2 .8 1.9 2.3.5v3.4l-2.3.5-.8 1.9 1.3 2-2.4 2.4-2-1.3-1.9.8-.5 2.3h-3.4l-.5-2.3-1.9-.8-2 1.3-2.4-2.4 1.3-2-.8-1.9L3 13.7v-3.4l2.3-.5.8-1.9-1.3-2 2.4-2.4 2 1.3 1.9-.8z"/><circle cx="12" cy="12" r="3"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.6A10.6 10.6 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.2 3.9M6.4 6.5C3.7 8.3 2 12 2 12s3.6 6.5 10 6.5c1.6 0 3-.4 4.2-1"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
const css = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();
let uidSeq = 0;
export const newUid = () =>
  `i${Date.now().toString(36)}${(uidSeq++).toString(36)}`;

// A chart line can't skip a blank point: it joins the neighbours. A segment takes the colour of
// the point it starts from, so hiding a gap means making the point before it transparent and
// parking the gap's points (invisibly) at the next real value.
const CLEAR = "rgba(0,0,0,0)";
function lineData(vals, breaks, timeAt, n) {
  const out = [];
  const next = new Array(vals.length);
  let nv = NaN;
  for (let i = vals.length - 1; i >= 0; i--) { if (Number.isFinite(vals[i])) nv = vals[i]; next[i] = nv; }
  let started = false;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i], time = timeAt(i);
    if (!Number.isFinite(v)) {
      if (i >= n) continue;
      out.push(started && Number.isFinite(next[i]) ? { time, value: next[i], color: CLEAR } : { time });
      continue;
    }
    started = true;
    const gapAhead = i + 1 < vals.length && (!Number.isFinite(vals[i + 1]) || breaks?.[i + 1]);
    out.push(gapAhead ? { time, value: v, color: CLEAR } : { time, value: v });
  }
  return out;
}
function histData(vals, colors, timeAt, n) {
  const out = [];
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (i >= n && !Number.isFinite(v)) continue;
    if (!Number.isFinite(v)) out.push({ time: timeAt(i) });
    else out.push(colors ? { time: timeAt(i), value: v, color: colors[i] } : { time: timeAt(i), value: v });
  }
  return out;
}

// Higher-timeframe values onto chart bars. A chart bar sees a higher-timeframe bar only once that
// bar has finished, except inside the newest one, where it shows the still-forming value (as
// TradingView does in real time).
function mapToChart(res, hb, htf, cb, ctf) {
  const hSec = parseTf(htf).seconds, cSec = parseTf(ctf).seconds;
  const end = (j) => (j + 1 < hb.length ? hb[j + 1].time : hb[j].time + hSec);
  const idx = new Array(cb.length).fill(-1);
  let j = -1;
  for (let i = 0; i < cb.length; i++) {
    const cEnd = cb[i].time + cSec;
    while (j + 1 < hb.length && end(j + 1) <= cEnd) j++;
    idx[i] = j + 1 === hb.length - 1 && cb[i].time >= hb[hb.length - 1].time ? hb.length - 1 : j;
  }
  const out = {};
  for (const [k, v] of Object.entries(res)) {
    if (k === "markers") continue;
    out[k] = Array.isArray(v) && v.length >= hb.length ? idx.map((x) => (x >= 0 ? v[x] : NaN)) : v;
  }
  return out;
}

export class ChartPane {
  constructor(app, el, cfg) {
    this.app = app;
    this.el = el;
    this.cfg = {
      symbol: "BINANCE:BTCUSDT",
      tf: "1D",
      type: "candles",
      indicators: [],
      compare: [],
      log: false,
      ...cfg,
    };
    this.bars = [];
    this.shown = [];
    this.times = [];
    this.indSeries = new Map();
    this.indResults = {};
    this.compareSeries = new Map();
    this.extraMarkers = [];
    this.replay = null;
    const nb = (act, title, d) => `<button data-nav="${act}" title="${title}"><svg viewBox="0 0 24 24">${d}</svg></button>`;
    el.innerHTML =
      '<div class="chart"></div><div class="cur-label hidden"></div>' +
      `<div class="nav-ctl">${nb("out", "Zoom out", '<path d="M6 12h12"/>')}${nb("in", "Zoom in", '<path d="M6 12h12M12 6v12"/>')}${nb("left", "Scroll left", '<path d="M14 6l-6 6 6 6"/>')}${nb("right", "Scroll right", '<path d="M10 6l6 6-6 6"/>')}${nb("reset", "Reset chart view (Alt+R)", '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 4v4h4"/>')}</div>` +
      '<div class="legend"></div><div class="pane-msg hidden"></div><button class="to-latest hidden" title="Scroll to the latest bar"><svg viewBox="0 0 24 24"><path d="M6 7l5 5-5 5M13 7l5 5-5 5" /></svg></button>';
    this.chartEl = el.querySelector(".chart");
    this.legendEl = el.querySelector(".legend");
    this.msgEl = el.querySelector(".pane-msg");
    this.createChart();
    el.addEventListener("mousedown", () => app.setActive(this), true);
    this.bindNavButtons();
  }

  // ---------- setup ----------
  themeOptions() {
    return {
      layout: {
        background: { type: "solid", color: css("--chart-bg") },
        textColor: css("--chart-text"),
        fontSize: 11,
        // No logo on the chart; the library is credited in Settings and in NOTICE instead.
        attributionLogo: false,
        panes: {
          separatorColor: css("--chart-border"),
          separatorHoverColor: css("--accent-soft"),
          enableResize: true,
        },
      },
      grid: {
        // Settings → Canvas → Grid lines: "both" (default), "v", "h" or "none"
        vertLines: { color: css("--chart-grid"), visible: ["both", "v"].includes(this.app.settings.grid || "both") },
        horzLines: { color: css("--chart-grid"), visible: ["both", "h"].includes(this.app.settings.grid || "both") },
      },
      // Candles fill the height: a little room above and below (the volume sits under them).
      rightPriceScale: { borderColor: css("--chart-border"), scaleMargins: { top: 0.13, bottom: 0.14 } },
      timeScale: { borderColor: css("--chart-border") },
    };
  }

  createChart() {
    this.chart = LW.createChart(this.chartEl, {
      autoSize: true,
      ...this.themeOptions(),
      crosshair: { mode: LW.CrosshairMode.Normal },
      timeScale: {
        borderColor: css("--chart-border"),
        rightOffset: 8,
        timeVisible: true,
        secondsVisible: false,
      },
      localization: { priceFormatter: (p) => fmtPrice(p) },
    });
    this.chart.subscribeCrosshairMove((p) => this.onCrosshair(p));
    this.chart.subscribeClick((p) => {
      if (this.app.tool === "cursor") this.onClick(p);
    });
    // Lightweight Charts drops a second click that lands within 500ms of the first (it waits for a
    // double-click), so drawing tools read native clicks instead.
    this.chartEl.addEventListener("click", (e) => {
      if (this.app.tool === "cursor") return;
      const r = this.chartEl.getBoundingClientRect();
      const x = e.clientX - r.left,
        y = e.clientY - r.top;
      const inPlot =
        x >= 0 &&
        x <= this.chart.timeScale().width() &&
        y >= 0 &&
        y <= this.chart.panes()[0].getHeight();
      this.onClick({
        point: inPlot ? { x, y } : undefined,
        logical: inPlot ? this.chart.timeScale().coordinateToLogical(x) : null,
        paneIndex: 0,
        mods: e,
      });
    });
    this.chartEl.addEventListener("mousemove", (e) => (this.mods = e), true);
    this.chartEl.addEventListener("mousedown", (e) => this.startDrag(e), true);
    this.drawings = new DrawingLayer(this);
    this.drawToolbar = new DrawToolbar(this);
    this.sessions = new SessionLayer(this);
    this.makeMainSeries();
    this.countdownTimer = setInterval(() => this.tickCountdown(), 1000);
    // The "jump to the latest bar" arrow shows once the newest bar has scrolled off the right edge.
    this.latestBtn = this.el.querySelector(".to-latest");
    this.latestBtn.onclick = () => this.chart.timeScale().scrollToRealTime();
    this.chart.timeScale().subscribeSizeChange?.(() => this.placeChrome());
    this.chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      this.placeChrome();
      this.updateHighLow();
      const away = !!r && this.shown.length > 0 && r.to < this.shown.length - 2;
      this.latestBtn.classList.toggle("hidden", !away);
      if (away) {
        this.latestBtn.style.right = `${this.chart.priceScale("right").width() + 12}px`;
        this.latestBtn.style.bottom = `${this.chart.timeScale().height() + 12}px`;
      }
    });
  }

  // Back to the normal view, like after loading: the latest ~160 bars with room on the right,
  // and every price scale fitting the data again (undoes scrolling, zooming and dragged scales).
  // The view a chart opens with and goes back to on reset: about one bar per 7 pixels (60 to 220
  // bars) up to the latest bar, with a little room on the right.
  defaultRange() {
    const n = this.shown.length;
    const w = this.chart.timeScale().width() || 900;
    const bars = Math.round(Math.max(60, Math.min(220, w / 7)));
    return { from: Math.max(-2, n - bars), to: n + Math.max(4, Math.round(bars * 0.06)) };
  }

  resetView() {
    if (!this.shown.length) return;
    this.chart.panes().forEach((_, i) => {
      try {
        this.chart.priceScale("right", i).applyOptions({ autoScale: true });
      } catch {
        /* a pane without a right scale */
      }
    });
    this.chart.timeScale().applyOptions({ rightOffset: 8 });
    this.chart.timeScale().setVisibleLogicalRange(this.defaultRange());
  }

  // Re-reads the theme and the chart settings (colours, grid, price line) and redraws.
  applyTheme() {
    this.chart.applyOptions(this.themeOptions());
    this.mainType = null; // rebuild the main series with the current colours
    this.render(false);
  }

  makeMainSeries() {
    this.countdownTxt = null;
    for (const vp of this.vpPrims || []) { try { this.main?.detachPrimitive(vp); } catch { /* gone */ } }
    this.vpPrims = [];
    if (this.main) {
      this.main.detachPrimitive(this.drawings);
      this.chart.removeSeries(this.main);
    }
    // Candle colours and parts from Settings → Symbol (unset colours follow the theme).
    const st = this.app.settings;
    const up = st.bodyUp || css("--up"),
      down = st.bodyDown || css("--down"),
      accent = css("--accent");
    const borderUp = st.borderUp || up, borderDown = st.borderDown || down;
    const wickUp = st.wickUp || up, wickDown = st.wickDown || down;
    const NONE = "rgba(0,0,0,0)";
    const accentA = (a) => {
      const h = accent.replace("#", "");
      const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
      return Number.isFinite(n) ? `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})` : `rgba(128,128,128,${a})`;
    };
    const t = this.cfg.type;
    const common = { priceLineVisible: st.priceLine !== false, lastValueVisible: st.priceLabel !== false };
    if (t === "bars")
      this.main = this.chart.addSeries(LW.BarSeries, {
        ...common,
        upColor: up,
        downColor: down,
      });
    else if (["line", "linemarkers", "step", "kagi"].includes(t))
      this.main = this.chart.addSeries(LW.LineSeries, {
        ...common,
        color: accent,
        lineWidth: 2,
        lineType: t === "step" || t === "kagi" ? 1 : 0,
        pointMarkersVisible: t === "linemarkers",
      });
    else if (t === "area")
      this.main = this.chart.addSeries(LW.AreaSeries, {
        ...common,
        lineColor: accent,
        topColor: accentA(0.28),
        bottomColor: accentA(0.02),
        lineWidth: 2,
      });
    else if (t === "baseline")
      this.main = this.chart.addSeries(LW.BaselineSeries, {
        ...common,
        topLineColor: up,
        bottomLineColor: down,
        topFillColor1: "rgba(8,153,129,0.25)",
        topFillColor2: "rgba(8,153,129,0.02)",
        bottomFillColor1: "rgba(242,54,69,0.02)",
        bottomFillColor2: "rgba(242,54,69,0.25)",
      });
    else if (t === "columns")
      this.main = this.chart.addSeries(LW.HistogramSeries, { ...common });
    else if (t === "hollow")
      this.main = this.chart.addSeries(LW.CandlestickSeries, {
        ...common,
        upColor: "rgba(0,0,0,0)",
        downColor: down,
        borderUpColor: borderUp,
        borderDownColor: borderDown,
        wickUpColor: wickUp,
        wickDownColor: wickDown,
        wickVisible: st.wick !== false,
        borderVisible: true,
      });
    else
      this.main = this.chart.addSeries(LW.CandlestickSeries, {
        ...common,
        upColor: st.body === false ? NONE : up,
        downColor: st.body === false ? NONE : down,
        borderVisible: st.border === true || st.body === false,
        borderUpColor: borderUp,
        borderDownColor: borderDown,
        wickVisible: st.wick !== false,
        wickUpColor: wickUp,
        wickDownColor: wickDown,
      });
    this.main.attachPrimitive(this.sessions);
    this.main.attachPrimitive(this.drawings);
    this.markers = LW.createSeriesMarkers(this.main, []);
    this.mainType = t;
  }

  // ---------- time helpers (drawings, legend, markers all go through these) ----------
  get shift() {
    return isIntraday(this.cfg.tf) && !this.app.settings.utc
      ? -new Date().getTimezoneOffset() * 60
      : 0;
  }
  get step() {
    return this.times.length > 1
      ? this.times.at(-1) - this.times.at(-2)
      : parseTf(this.cfg.tf).seconds;
  }
  toChart(t) {
    return t + this.shift;
  }

  logicalOf(utc) {
    const T = this.times,
      t = utc + this.shift,
      n = T.length;
    if (!n) return null;
    if (t <= T[0]) return (t - T[0]) / this.step;
    if (t >= T[n - 1]) return n - 1 + (t - T[n - 1]) / this.step;
    let lo = 0,
      hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (T[m] <= t) lo = m;
      else hi = m;
    }
    return lo + (t - T[lo]) / (T[hi] - T[lo]);
  }

  timeOfLogical(l) {
    const T = this.times,
      n = T.length;
    if (!n) return null;
    let t;
    if (l <= 0) t = T[0] + l * this.step;
    else if (l >= n - 1) t = T[n - 1] + (l - (n - 1)) * this.step;
    else {
      const i = Math.floor(l);
      t = T[i] + (l - i) * (T[i + 1] - T[i]);
    }
    return t - this.shift;
  }

  timeToX(utc) {
    const l = this.logicalOf(utc);
    return l == null ? null : this.chart.timeScale().logicalToCoordinate(l);
  }

  formatPrice(v) {
    return fmtPrice(v);
  }

  // ---------- data ----------
  async load({ keepView = false } = {}) {
    const token = (this.loadToken = {});
    this.stopLive();
    this.showMsg(`Loading ${ticker(this.cfg.symbol)}…`);
    this.moreLoading = null;
    try {
      const limit = this.app.settings.bars || 3000;
      // Indian stocks and indices (Yahoo) on daily and longer: show a year at once, then fetch the
      // rest of the history in the background. On a slow line the full history can take 10-20 s.
      const quick = exchange(this.cfg.symbol) === "YAHOO" && limit > 400 && !isIntraday(this.cfg.tf);
      const r = await api.candles(this.cfg.symbol, this.cfg.tf, quick ? 240 : limit);
      if (token !== this.loadToken) return;
      this.cfg.symbol = r.symbol;
      this.provider = r.provider;
      this.notes = r.notes || [];
      this.events = r.events || [];
      this.bars = r.candles;
      this.mtf = {};
      this.replay = null;
      this.el.querySelector(".replay-bar")?.remove();
      this.drawings.setItems(this.app.getDrawings(r.symbol));
      this.showMsg(
        this.bars.length ? "" : "No data for this symbol and timeframe.",
      );
      await this.loadCompare();
      await this.loadFx();
      if (token !== this.loadToken) return;
      this.render(!keepView);
      this.startLive();
      this.app.onPaneLoaded(this);
      if (quick && this.bars.length >= 200) this.moreLoading = this.loadMore(token, limit);
    } catch (e) {
      if (token !== this.loadToken) return;
      this.bars = [];
      this.render(true);
      this.showMsg(
        `Couldn't load ${esc(this.cfg.symbol)} on ${esc(this.cfg.tf)}.\n${esc(e.message)}`,
      );
    }
  }

  // The rest of the history, added on the left without moving the view.
  async loadMore(token, limit) {
    try {
      const r = await api.candles(this.cfg.symbol, this.cfg.tf, limit);
      if (token !== this.loadToken || this.replay || r.candles.length <= this.bars.length) return;
      const ts = this.chart.timeScale();
      const prev = ts.getVisibleLogicalRange();
      const atEnd = prev && this.shown.length && prev.to >= this.shown.length - 3;
      const before = this.shown.length;
      // Keep any newer bars the live updates added meanwhile.
      const newest = r.candles.at(-1)?.time ?? 0;
      this.bars = [...r.candles, ...this.bars.filter((b) => b.time > newest)];
      if (r.events) this.events = r.events;
      this.render(false);
      const added = this.shown.length - before;
      if (prev && !atEnd && added > 0) ts.setVisibleLogicalRange({ from: prev.from + added, to: prev.to + added });
    } catch {
      /* the year already shown stays */
    }
  }

  async loadCompare() {
    this.compareData = {};
    await Promise.all(
      this.cfg.compare.map(async (sym) => {
        try {
          this.compareData[sym] = (
            await api.candles(sym, this.cfg.tf, this.app.settings.bars || 3000)
          ).candles;
        } catch {
          this.compareData[sym] = [];
        }
      }),
    );
  }

  showMsg(text) {
    this.msgEl.classList.toggle("hidden", !text);
    this.msgEl.innerHTML = esc(text).replace(/\n/g, "<br>");
  }

  visibleBars() {
    let raw = this.replay
      ? this.bars.slice(0, this.replay.index + 1)
      : this.bars;
    if (this.fx) raw = convertBars(raw, this.fx.from, this.fx.to);
    switch (this.cfg.type) {
      case "heikin":
        return heikinAshi(raw);
      case "renko":
        return renko(raw);
      case "linebreak":
        return lineBreak(raw);
      case "range":
        return rangeBars(raw);
      case "kagi":
        return kagi(raw);
      case "pnf":
        return pointFigure(raw);
      default:
        return raw;
    }
  }

  pointFor(b) {
    const time = this.toChart(b.time);
    switch (this.mainType) {
      case "line":
      case "linemarkers":
      case "step":
      case "area":
      case "baseline":
        return { time, value: b.close };
      case "kagi":
        return { time, value: b.close, color: b.color };
      case "columns":
        return {
          time,
          value: b.close,
          color: b.close >= b.open ? css("--up") : css("--down"),
        };
      default: {
        const c = this.barColorAt?.get(b.time);
        return { time, open: b.open, high: b.high, low: b.low, close: b.close, ...(c ? (this.mainType === "bars" ? { color: c } : { color: c, borderColor: c, wickColor: c }) : {}) };
      }
    }
  }

  render(resetView) {
    const prevRange = this.chart.timeScale().getVisibleLogicalRange();
    const atEnd =
      prevRange && this.shown.length && prevRange.to >= this.shown.length - 3;
    if (this.mainType !== this.cfg.type) this.makeMainSeries();
    this.shown = this.visibleBars();
    this.times = this.shown.map((b) => this.toChart(b.time));
    const last = this.shown.at(-1)?.close || 1;
    const precision = last >= 100 ? 2 : last >= 1 ? 4 : last >= 0.01 ? 6 : 8;
    this.main.applyOptions({
      priceFormat: { type: "price", precision, minMove: 1 / 10 ** precision },
    });
    if (this.cfg.type === "baseline" && this.shown.length)
      this.main.applyOptions({
        baseValue: {
          type: "price",
          price: this.shown[Math.max(0, this.shown.length - 150)].close,
        },
      });
    this.main.setData(this.shown.map((b) => this.pointFor(b)));
    this.chart.applyOptions({
      timeScale: {
        timeVisible: isIntraday(this.cfg.tf),
        secondsVisible: parseTf(this.cfg.tf).seconds < 60,
      },
    });
    this.chart.priceScale("right").applyOptions({
      mode: this.cfg.compare.length
        ? LW.PriceScaleMode.Percentage
        : this.cfg.log
          ? LW.PriceScaleMode.Logarithmic
          : LW.PriceScaleMode.Normal,
    });
    this.renderCompare();
    this.renderIndicators();
    this.drawings.update();
    if (resetView && this.shown.length)
      this.chart.timeScale().setVisibleLogicalRange(this.defaultRange());
    if (!resetView && this.shown.length && (this.replay || atEnd)) {
      const def = this.defaultRange();
      const w = prevRange ? Math.max(20, prevRange.to - prevRange.from) : def.to - def.from;
      const n = this.shown.length;
      this.chart
        .timeScale()
        .setVisibleLogicalRange({ from: n - w + 8, to: n + 8 });
    }
    this.updateLegend();
    this.placeChrome();
    this.updateHighLow();
  }

  renderCompare() {
    for (const s of this.compareSeries.values()) this.chart.removeSeries(s);
    this.compareSeries.clear();
    const palette = ["#ff9800", "#e91e63", "#00bcd4", "#8bc34a", "#9c27b0"];
    this.cfg.compare.forEach((sym, k) => {
      const data = (this.compareData?.[sym] || []).filter(
        (b) => !this.replay || b.time <= this.shown.at(-1)?.time,
      );
      const s = this.chart.addSeries(LW.LineSeries, {
        color: palette[k % palette.length],
        lineWidth: 2,
        priceLineVisible: false,
        title: ticker(sym),
      });
      s.setData(
        data.map((b) => ({ time: this.toChart(b.time), value: b.close })),
      );
      this.compareSeries.set(sym, s);
    });
  }

  // Indicator values for one instance: on the chart's bars, on another indicator's output
  // (source "ind:<uid>:<output>"), or on a higher timeframe mapped back without look-ahead.
  computeIndicator(ind, bars) {
    const src = String(ind.params?.source || "");
    if (BY_ID[ind.id]?.fundamental) {
      // Company figures (Fundamentals): fetched once per symbol, then drawn.
      const f = this.app.companyFigures(this.cfg.symbol, () => this.render(false));
      if (!f) return { pending: true };
      if (f.error) return { error: f.error };
      return compute(ind.id, bars, { ...ind.params, _fin: f });
    }
    if (ind.tf && ind.tf !== this.cfg.tf) {
      const h = this.mtf[ind.tf];
      if (!h) { this.loadMtf(ind.tf); return { pending: true }; }
      if (h.error) return { error: h.error };
      let hb = h.bars;
      if (this.replay && bars.length) {
        // replay: only higher-timeframe bars that had finished by the replayed bar
        const cEnd = bars.at(-1).time + parseTf(this.cfg.tf).seconds, hs = parseTf(ind.tf).seconds;
        hb = hb.filter((x, j) => (j + 1 < hb.length ? hb[j + 1].time : x.time + hs) <= cEnd);
      }
      if (!hb.length) return {};
      const res = compute(ind.id, hb, src.startsWith("ind:") ? { ...ind.params, source: "close" } : ind.params);
      return mapToChart(res, hb, ind.tf, bars, this.cfg.tf);
    }
    if (src.startsWith("ind:")) {
      const [, uid, key] = src.split(":");
      const vals = this.indResults[uid]?.[key];
      if (!Array.isArray(vals)) return { error: "Its source indicator is missing" };
      const synth = bars.map((x, i) => { const v = vals[i]; return { ...x, open: v, high: v, low: v, close: v }; });
      return compute(ind.id, synth, { ...ind.params, source: "close" });
    }
    return compute(ind.id, bars, ind.params);
  }

  async loadMtf(tf) {
    this.mtfLoading ||= {};
    if (this.mtfLoading[tf]) return;
    this.mtfLoading[tf] = true;
    try {
      if (parseTf(tf).seconds < parseTf(this.cfg.tf).seconds) throw new Error(`Pick a timeframe at or above the chart's (${this.cfg.tf})`);
      const r = await api.candles(this.cfg.symbol, tf, 2000);
      this.mtf[tf] = { bars: r.candles, at: Date.now() };
    } catch (e) {
      this.mtf[tf] = { error: e.message, at: Date.now() };
    }
    delete this.mtfLoading[tf];
    this.render(false);
  }

  renderIndicators() {
    for (const list of this.indSeries.values())
      for (const s of list) {
        try { this.chart.removeSeries(s); } catch { /* already gone */ }
      }
    this.indSeries.clear();
    for (const vp of this.vpPrims || []) { try { this.main.detachPrimitive(vp); } catch { /* gone with the series */ } }
    this.vpPrims = [];
    while (this.chart.panes().length > 1) this.chart.removePane(this.chart.panes().length - 1);
    this.indResults = {};
    this.mtf ||= {};
    const bars = this.shown, n = bars.length;
    const timeAt = (i) => (i < n ? this.times[i] : this.times[n - 1] + (i - n + 1) * this.step);
    // indicators built on another indicator's output go after their source
    const byUid = new Map(this.cfg.indicators.map((x) => [x.uid, x]));
    const depth = (x, seen = new Set()) => {
      const src = String(x.params?.source || "");
      if (!src.startsWith("ind:") || seen.has(x.uid)) return 0;
      seen.add(x.uid);
      const parent = byUid.get(src.split(":")[1]);
      return parent ? 1 + depth(parent, seen) : 0;
    };
    const ordered = [...this.cfg.indicators].sort((x, y) => depth(x) - depth(y));
    let paneIdx = 0;
    const paneOf = {};
    const markers = [];
    const barColorAt = new Map();
    for (const ind of ordered) {
      const def = BY_ID[ind.id];
      if (!def) continue;
      let res;
      try { res = n ? this.computeIndicator(ind, bars) : {}; } catch (e) { res = { error: e.message }; }
      this.indResults[ind.uid] = res;
      // Visibility tab: an indicator can be shown on some kinds of timeframe only (e.g. not on minutes).
      if (ind.hidden || !n || ind.visibility?.[parseTf(this.cfg.tf).unit] === false) continue;
      if (res.markers && !ind.tf) markers.push(...res.markers);
      if (Array.isArray(res.barColors) && !ind.tf)
        res.barColors.forEach((c, i) => c && i < n && barColorAt.set(bars[i].time, c));
      if (res.volumeProfile) {
        const vp = new VolumeProfile(this, res.volumeProfile);
        this.main.attachPrimitive(vp);
        this.vpPrims.push(vp);
      }
      if (res.sessionProfile) {
        const sp = new SessionVolumeProfile(this, res.sessionProfile);
        sp.keyOf = periodKey;
        sp.tfSeconds = parseTf(this.cfg.tf).seconds;
        this.main.attachPrimitive(sp);
        this.vpPrims.push(sp);
      }
      // Indicators that draw their own shapes (the deviation channel) keep their outputs for alerts
      // and the data window; on another timeframe there's no shape, so the outputs plot as lines.
      if (res.channel) {
        const colors = Object.fromEntries(def.outputs.map((o) => [o.key, ind.colors?.[o.key] || o.color]));
        const ch = new StdDevChannel(this, res.channel, colors);
        this.main.attachPrimitive(ch);
        this.vpPrims.push(ch);
      }
      const outs = def.outputs.filter((o) => Array.isArray(res[o.key]) && (o.plot !== false || !res.channel) && !ind.style?.off?.[o.key]);
      if (!outs.length) continue;
      const src = String(ind.params?.source || "");
      const parentPane = src.startsWith("ind:") ? paneOf[src.split(":")[1]] : undefined;
      // Volume "On the price chart": bottom fifth of the price pane, on a scale of its own.
      const bottom = ind.id === "volume" && parentPane === undefined && (ind.params?.placement ?? "On the price chart") === "On the price chart";
      if (ind.id === "volume" && PRICE_ONLY.includes(this.cfg.type)) continue; // Renko, Kagi…: bars have no volume of their own
      const pane = parentPane !== undefined ? parentPane : def.overlay || bottom ? 0 : ++paneIdx;
      paneOf[ind.uid] = pane;
      const list = [];
      for (const out of outs) {
        const color = ind.colors?.[out.key] || out.color;
        const opts = {
          // "Scale price chart only" (on by default): lines on the price chart don't stretch its scale.
          ...(def.noAutoscale || (pane === 0 && !bottom && this.app.settings.scalePriceOnly !== false) ? { autoscaleInfoProvider: () => null } : {}),
          ...(def.volumeFormat ? { priceFormat: { type: "volume" } } : {}),
          ...(def.priceFormat ? { priceFormat: def.priceFormat } : {}),
          color,
          priceLineVisible: false,
          // Style tab: "Labels on price scale" (default: on in its own pane, off on the price chart)
          lastValueVisible: ind.style?.scaleLabels ?? pane > 0,
          crosshairMarkerVisible: false,
          title: "",
          ...(bottom ? { priceScaleId: `vol-${ind.uid}`, lastValueVisible: ind.style?.scaleLabels ?? false } : {}),
        };
        const s = out.kind === "histogram"
          ? this.chart.addSeries(LW.HistogramSeries, opts, pane)
          : this.chart.addSeries(LW.LineSeries, { ...opts, lineWidth: ind.style?.width?.[out.key] || out.lineWidth || 1, lineStyle: ind.style?.dash?.[out.key] || 0, ...(out.step ? { lineType: LW.LineType.WithSteps } : {}), ...(out.dots ? { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.5 } : {}) }, pane);
        if (bottom && !list.length) this.chart.priceScale(`vol-${ind.uid}`, 0).applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        const vals = res[out.key];
        s.setData(out.kind === "histogram" ? histData(vals, res.colors, timeAt, n) : lineData(vals, res.breaks, timeAt, n));
        list.push(s);
      }
      if (parentPane === undefined)
        for (const lv of def.levels || [])
          list[0].createPriceLine({ price: lv, color: css("--muted"), lineWidth: 1, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: false });
      this.indSeries.set(ind.uid, list);
    }
    // candle colours from indicators (Pine's barcolor), only on charts drawn from the real bars
    const recolor = ["candles", "hollow", "bars"].includes(this.cfg.type) ? barColorAt : new Map();
    if (recolor.size || this.barColorAt?.size) {
      this.barColorAt = recolor;
      this.main.setData(bars.map((b) => this.pointFor(b)));
    }
    this.chart.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 1 : 0.28));
    const all = [...markers, ...this.extraMarkers, ...this.eventMarkers()]
      .map((m) => ({ ...m, time: this.toChart(m.time) }))
      .filter((m) => !this.replay || m.time <= this.times.at(-1));
    all.sort((x, y) => x.time - y.time);
    this.markers.setMarkers(all);
  }

  // Day separators and NSE-hours shading only make sense on time-based intraday charts.
  isIntradayChart() {
    return isIntraday(this.cfg.tf) && !["renko", "linebreak", "range", "kagi", "pnf"].includes(this.cfg.type);
  }

  // Dividends ("D") and splits or bonus issues ("S") under the bar they fall in, as on other charting apps.
  eventMarkers() {
    if (this.app.settings.corpActions === false || !this.events?.length || !this.shown.length) return [];
    const bars = this.shown, out = [];
    for (const e of this.events) {
      // the last bar starting on or before the event (weekly and monthly bars cover several days)
      let lo = 0, hi = bars.length - 1, at = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (bars[mid].time <= e.time) { at = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (at < 0) continue;
      out.push(e.kind === "split"
        ? { time: bars[at].time, position: "belowBar", shape: "circle", color: "#e5a43a", text: `S ${e.ratio}`, size: 0.6 }
        : { time: bars[at].time, position: "belowBar", shape: "circle", color: "#9e9e9e", text: "D", size: 0.6 });
    }
    return out;
  }
  // Dividends and splits on one bar, for the data window.
  eventsAt(barTime, nextTime) {
    return (this.events || []).filter((e) => e.time >= barTime && (nextTime == null || e.time < nextTime));
  }

  // "14 on RSI 14 (1D)": the numeric inputs, what it's built on, and its timeframe.
  indicatorParamsLabel(ind) {
    const def = BY_ID[ind.id];
    if (!def) return "";
    const nums = (def.inputs || [])
      .filter((x) => x.type !== "source" && x.type !== "bool" && (!def.legendInputs || def.legendInputs.includes(x.key)))
      .map((x) => {
        const v = ind.params?.[x.key] ?? x.default;
        if (x.type !== "time") return v;
        return v ? new Date(v * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "pick a bar";
      })
      .join(" ");
    const src = String(ind.params?.source || "");
    let on = "";
    if (src.startsWith("ind:")) {
      const parent = this.cfg.indicators.find((x) => x.uid === src.split(":")[1]);
      const pd = parent && BY_ID[parent.id];
      on = pd ? ` on ${(/\(([^)]+)\)$/.exec(pd.name)?.[1].split(" / ")[0] || pd.name)} ${this.indicatorParamsLabel(parent)}` : " on (missing)";
    }
    return `${nums}${on}${ind.tf && ind.tf !== this.cfg.tf ? ` (${ind.tf})` : ""}`;
  }

  // ---------- legend ----------
  onCrosshair(p) {
    if (this.app.tool !== "cursor" && this.drawings.temp && p.point) {
      const pts = this.drawings.temp.points;
      const pt = this.adjustPoint(this.pointAt(p), pts.at(-2), this.mods);
      if (pt) {
        pts[pts.length - 1] = pt;
        this.drawings.update();
      }
    }
    const i =
      p.logical != null && p.point
        ? Math.max(0, Math.min(this.shown.length - 1, Math.round(p.logical)))
        : null;
    this.updateLegend(i);
    this.app.panels?.onCrosshair?.(this, i);
    if (this.app.settings.syncCrosshair && p.time && p.point)
      this.app.syncCrosshair(this, p);
  }

  updateLegend(index = null) {
    const n = this.shown.length;
    const i = index ?? n - 1;
    const b = this.shown[i],
      prev = this.shown[i - 1];
    const chg = b && prev ? ((b.close - prev.close) / prev.close) * 100 : null;
    const cls = chg == null ? "" : chg >= 0 ? "up" : "down";
    // "NIFTY 50 · 1D · NSE": the symbol's display name and market, with the feed in the tooltip.
    const sym = this.cfg.symbol;
    const label = this.app.panels?.labelOf?.(sym) || ticker(sym).replace(/\.(NS|BO)$/, "");
    const market = this.app.panels?.marketOf?.(sym) || this.provider || exchange(sym);
    const name = `${label} · ${this.cfg.tf} · ${market}`;
    let html = `<div class="row"><span class="title" data-act="symbol">${esc(name)}</span>`;
    // Settings → Status line decides which parts show.
    const stl = this.app.settings;
    if (b && (stl.legendOhlc !== false || stl.legendChange !== false))
      html += `<span class="ohlc ${cls}">${stl.legendOhlc !== false ? `<span><b>O</b>${fmtPrice(b.open)}</span><span><b>H</b>${fmtPrice(b.high)}</span><span><b>L</b>${fmtPrice(b.low)}</span><span><b>C</b>${fmtPrice(b.close)}</span>` : ""}${stl.legendChange !== false ? `<span>${fmtPct(chg)}</span>` : ""}</span>`;
    html += "</div>";
    for (const sym of this.cfg.compare) {
      html += `<div class="row ind" data-compare="${esc(sym)}"><span class="name">${esc(ticker(sym))} (compare)</span><span class="acts"><button data-act="rmcompare" title="Remove">${ICON.x}</button></span></div>`;
    }
    for (const ind of this.cfg.indicators) {
      const def = BY_ID[ind.id];
      if (!def) continue;
      const res = this.indResults[ind.uid] || {};
      const params = stl.legendIndArgs !== false ? this.indicatorParamsLabel(ind) : "";
      const vals = stl.legendIndValues === false || ind.style?.statusValues === false ? "" : res.error
        ? `<span class="down">${esc(res.error)}</span>`
        : res.pending
          ? '<span class="muted">loading…</span>'
          : def.outputs
            .filter((o) => !ind.style?.off?.[o.key])
            .map((o) => {
              const v = res[o.key]?.[i];
              return Number.isFinite(v)
                ? `<span style="color:${ind.colors?.[o.key] || o.color}">${def.fmt ? def.fmt(v) : fmtPrice(v)}</span>`
                : "";
            })
            .join(" ");
      const short =
        def.short || /\(([^)]+)\)$/.exec(def.name)?.[1].split(" / ")[0] || def.name;
      html += `<div class="row ind" data-uid="${ind.uid}" style="${ind.hidden ? "opacity:.45" : ""}"><span class="name">${esc(short)} ${esc(params)}</span><span class="vals">${vals}</span><span class="acts"><button data-act="settings" title="Settings">${ICON.gear}</button><button data-act="hide" title="${ind.hidden ? "Show" : "Hide"}">${ind.hidden ? ICON.eyeOff : ICON.eye}</button><button data-act="remove" title="Remove">${ICON.x}</button></span></div>`;
    }
    for (const note of this.notes || [])
      html += `<div class="row note">${esc(note)}</div>`;
    this.legendEl.innerHTML = html;
    this.legendEl.onclick = (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "symbol") return this.app.openSymbolSearch();
      if (act === "rmcompare") {
        this.cfg.compare = this.cfg.compare.filter(
          (s) => s !== btn.closest("[data-compare]").dataset.compare,
        );
        this.app.persist();
        return this.load({ keepView: true });
      }
      const uid = btn.closest("[data-uid]")?.dataset.uid;
      const ind = this.cfg.indicators.find((x) => x.uid === uid);
      if (!ind) return;
      if (act === "remove") this.removeIndicator(uid);
      if (act === "hide") {
        ind.hidden = !ind.hidden;
        this.render(false);
        this.app.persist();
      }
      if (act === "settings") this.app.openIndicatorSettings(this, ind);
    };
  }

  // ---------- indicators ----------
  addIndicator(id, params = {}) {
    const uid = newUid();
    this.cfg.indicators.push({ uid, id, params });
    this.render(false);
    this.app.persist();
    return uid;
  }
  removeIndicator(uid) {
    this.cfg.indicators = this.cfg.indicators.filter((x) => x.uid !== uid);
    this.render(false);
    this.app.persist();
  }

  // ---------- drawing tools ----------
  pointAt(p) {
    if (p.paneIndex) return null; // drawings live on the price pane only
    if (!p.point || p.logical == null) return null;
    const logical =
      this.chart.timeScale().coordinateToLogical(p.point.x) ?? p.logical;
    const price = this.main.coordinateToPrice(p.point.y);
    const time = this.timeOfLogical(logical);
    return price == null || time == null ? null : { time, price };
  }

  onClick(p) {
    const tool = this.app.tool;
    if (tool === "anchor-pick") {
      const pick = this.app.pendingAnchor;
      const ind = pick?.pane === this && this.cfg.indicators.find((x) => x.uid === pick.uid);
      const pt = this.pointAt(p);
      if (!ind || !pt) return;
      // Snap to the raw bar under the click (works on Renko/Heikin Ashi too).
      let i = this.bars.findIndex((b) => b.time > pt.time) - 1;
      if (i < 0) i = this.bars.length - 1;
      ind.params = { ...ind.params, [pick.key]: this.bars[i].time };
      this.app.pendingAnchor = null;
      this.app.setTool("cursor");
      this.render(false);
      this.app.persist();
      this.app.toast("Anchored.");
      return;
    }
    if (tool === "replay-pick") {
      const pt = this.pointAt(p);
      if (!pt) return;
      // map the clicked time back to the raw bars (works for Renko/Heikin Ashi too)
      let i = this.bars.findIndex((b) => b.time > pt.time) - 1;
      if (i < 0) i = this.bars.length - 1;
      this.app.setTool("cursor");
      this.startReplay(Math.max(1, i));
      return;
    }
    if (tool === "cursor") {
      if (!p.point) return;
      this.drawings.selected = this.drawings.hitTest(p.point.x, p.point.y);
      this.drawings.update();
      return;
    }
    const def = TOOL_BY_ID[tool];
    if (def?.freehand) return; // the brush draws on press and drag (startBrush)
    const d = this.drawings;
    const pt = this.adjustPoint(this.pointAt(p), d.temp?.points.at(-2), p.mods);
    if (!def || !pt) return;
    if (def.indicator) {
      // Anchored VWAP: an indicator anchored to the bar under the click, not a drawing.
      let i = this.bars.findIndex((b) => b.time > pt.time) - 1;
      if (i < 0) i = this.bars.length - 1;
      if (i < 0) return;
      this.addIndicator(def.indicator, { anchor: this.bars[i].time });
      if (!this.app.settings.stayInDrawMode) this.app.setTool("cursor");
      this.app.toast("Anchored VWAP added. Change or remove it from its line in the legend.");
      return;
    }
    if (!d.temp) {
      d.temp = { id: newUid(), type: tool, points: [pt] };
      if (def.points > 1) d.temp.points.push({ ...pt });
    } else {
      d.temp.points[d.temp.points.length - 1] = pt;
      if (d.temp.points.length < def.points) d.temp.points.push({ ...pt });
      else d.temp.done = true;
    }
    if (def.points === 1) d.temp.done = true;
    if (d.temp.done) {
      const item = d.temp;
      delete item.done;
      d.temp = null;
      if (item.type === "text") {
        const text = prompt("Note text:", "");
        if (!text) {
          d.update();
          this.app.setTool("cursor");
          return;
        }
        item.text = text;
      }
      d.items.push(item);
      d.selected = item;
      this.app.saveDrawings(this.cfg.symbol, d.items);
      if (!this.app.settings.stayInDrawMode) this.app.setTool("cursor");
    }
    d.update();
  }

  // Shift locks the line to 45° steps from `anchor`; Ctrl (Cmd on Mac) snaps to the bar's open, high, low or close.
  adjustPoint(pt, anchor, mods) {
    if (!pt || !mods) return pt;
    let { time, price } = pt;
    if (mods.shiftKey && anchor) {
      const a = { x: this.timeToX(anchor.time), y: this.main.priceToCoordinate(anchor.price) };
      const b = { x: this.timeToX(time), y: this.main.priceToCoordinate(price) };
      if (a.x != null && a.y != null && b.x != null && b.y != null) {
        const c = constrain45(a, b);
        const t = this.timeOfLogical(this.chart.timeScale().coordinateToLogical(c.x));
        const pr = this.main.coordinateToPrice(c.y);
        if (t != null) time = c.axis === "v" ? anchor.time : t;
        if (pr != null) price = c.axis === "h" ? anchor.price : pr;
      }
    }
    if ((mods.ctrlKey || mods.metaKey) && this.shown.length) {
      const l = this.logicalOf(time);
      const bar = this.shown[Math.max(0, Math.min(this.shown.length - 1, Math.round(l)))];
      time = bar.time;
      price = snapToOHLC(bar, price);
    }
    return { ...pt, time, price };
  }

  // Cursor tool: drag a drawing to move it, or drag one of its points to resize it.
  startDrag(e) {
    if (this.app.tool === "brush" && e.button === 0) return this.startBrush(e);
    if (this.app.tool !== "cursor" || e.button !== 0) return;
    const r = this.chartEl.getBoundingClientRect();
    const x0 = e.clientX - r.left,
      y0 = e.clientY - r.top;
    if (y0 > this.chart.panes()[0].getHeight()) return;
    const d = this.drawings;
    const handle = d.selected ? d.handleAt(d.selected, x0, y0) : -1;
    const item = handle >= 0 ? d.selected : d.hitTest(x0, y0);
    if (!item) return;
    if (item.locked) {
      // Locked drawings can be selected (and deleted) but don't move.
      d.selected = item;
      d.update();
      this.app.panels?.onObjectsChanged?.();
      return;
    }
    e.stopPropagation(); // keeps the chart from panning while the drawing moves
    e.preventDefault();
    d.selected = item;
    this.dragging = true;
    d.update();
    const orig = item.points.map((p) => ({ ...p }));
    const ts = this.chart.timeScale();
    const move = (ev) => {
      const x = ev.clientX - r.left,
        y = ev.clientY - r.top;
      if (handle >= 0) {
        const pt = this.pointAt({ point: { x, y }, logical: ts.coordinateToLogical(x) });
        const anchor = orig[handle === 0 ? 1 : 0];
        if (pt) item.points[handle] = this.adjustPoint(pt, anchor, ev);
      } else {
        item.points = orig.map((p) => {
          const time = this.timeOfLogical(ts.coordinateToLogical(this.timeToX(p.time) + x - x0));
          const price = this.main.coordinateToPrice(this.main.priceToCoordinate(p.price) + y - y0);
          return time == null || price == null ? p : { ...p, time, price };
        });
      }
      d.update();
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      this.dragging = false;
      if (item.points.some((p, i) => p.time !== orig[i].time || p.price !== orig[i].price))
        this.app.saveDrawings(this.cfg.symbol, d.items);
      d.update();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // Zoom buttons on the left toolbar: factor < 1 shows fewer bars, > 1 more. When the latest bar is
  // in view the right edge stays put (so the chart keeps following live prices); otherwise it zooms
  // around the middle.
  zoom(factor) {
    const r = this.navRange();
    if (!r || !this.shown.length) return;
    const span = r.to - r.from;
    const next = Math.max(10, Math.min(span * factor, this.shown.length + 200));
    if (Math.abs(next - span) < 0.5) return;
    const atEnd = r.to >= this.shown.length - 2;
    const to = atEnd ? r.to : (r.from + r.to) / 2 + next / 2;
    this.setNavRange({ from: to - next, to });
  }
  // The chart applies a new range on its next frame, so quick repeated clicks build on the last target.
  navRange() {
    const pending = this._navTo && performance.now() - this._navTo.at < 250 ? this._navTo.r : null;
    return pending || this.chart.timeScale().getVisibleLogicalRange();
  }
  setNavRange(range) {
    this._navTo = { r: range, at: performance.now() };
    this.chart.timeScale().setVisibleLogicalRange(range);
  }
  // < and >: move a fifth of the visible bars back or forward.
  scrollBars(dir) {
    const r = this.navRange();
    if (!r || !this.shown.length) return;
    const d = Math.max(1, Math.round((r.to - r.from) / 5)) * dir;
    this.setNavRange({ from: r.from + d, to: r.to + d });
  }

  // The − + < > and reset buttons that show a little above the bottom of the chart while the mouse
  // is over it. Holding a button repeats it.
  bindNavButtons() {
    const box = this.el.querySelector(".nav-ctl");
    const run = (act) => {
      if (act === "in") this.zoom(0.8);
      if (act === "out") this.zoom(1 / 0.8);
      if (act === "left") this.scrollBars(-1);
      if (act === "right") this.scrollBars(1);
      if (act === "reset") {
        this.resetView();
        document.querySelectorAll("#rangeButtons button").forEach((b) => b.classList.remove("active"));
      }
    };
    let hold = null;
    const stop = () => {
      clearTimeout(hold?.t);
      clearInterval(hold?.i);
      hold = null;
    };
    box.addEventListener("pointerdown", (e) => {
      const b = e.target.closest("[data-nav]");
      if (!b || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const act = b.dataset.nav;
      run(act);
      if (act === "reset") return;
      stop();
      hold = { t: setTimeout(() => (hold.i = setInterval(() => run(act), 90)), 350) };
    });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) box.addEventListener(ev, stop);
    const cur = this.el.querySelector(".cur-label");
    cur.addEventListener("mousedown", (e) => e.stopPropagation());
    cur.addEventListener("click", (e) => {
      e.stopPropagation();
      this.app.setActive(this);
      this.openCurrencyMenu(cur);
    });
    for (const ev of ["mousedown", "click", "dblclick", "wheel"]) box.addEventListener(ev, (e) => e.stopPropagation());
  }

  // ---------- currency ----------
  // What the price scale is in: the chosen currency once its rates are in, else the symbol's own.
  shownCurrency() {
    const native = currencyOf(this.cfg.symbol);
    if (this.fx) return this.fx.code;
    if (native && this.cfg.currency && fiatOf(native) === this.cfg.currency) return this.cfg.currency;
    return native;
  }
  // Exchange rates for cfg.currency, if the chart is shown in a currency other than its own.
  async loadFx() {
    this.fx = null;
    const native = currencyOf(this.cfg.symbol);
    const want = this.cfg.currency;
    if (!want || !canConvert(native) || fiatOf(native) === want) return;
    try {
      const [from, to] = await Promise.all([this.app.usdRates(fiatOf(native)), this.app.usdRates(want)]);
      this.fx = { code: want, from, to };
    } catch (e) {
      this.app.toast(`Couldn't load ${esc(want)} exchange rates, so prices stay in ${esc(native)}: ${esc(e.message)}`, "err");
    }
  }
  async setCurrency(code) {
    const native = currencyOf(this.cfg.symbol);
    if (!code || code === native) delete this.cfg.currency;
    else this.cfg.currency = code;
    await this.loadFx();
    this.render(false);
    this.chart.priceScale("right").applyOptions({ autoScale: true });
    this.app.persist();
  }
  openCurrencyMenu(anchor) {
    document.querySelector(".cur-menu")?.remove();
    const native = currencyOf(this.cfg.symbol);
    if (!canConvert(native)) return this.app.toast(native ? `Prices in ${esc(native)} can't be converted to another currency.` : "This chart isn't priced in a currency.");
    const cur = this.shownCurrency();
    const m = document.createElement("div");
    m.className = "wl-menu cur-menu";
    const row = (code, name, note = "") => `<button data-cur="${code}" class="${code === cur ? "current" : ""}"><span><b>${code}</b> ${esc(name)}</span><span class="n">${note}</span></button>`;
    const nativeName = CURRENCIES.find(([c]) => c === fiatOf(native))?.[1] || native;
    m.innerHTML = `<div class="tpl-h">Show prices in</div>${row(native, nativeName, "symbol's own")}<div class="sep"></div><div class="cur-list">${CURRENCIES.filter(([c]) => c !== native).map(([c, n]) => row(c, n)).join("")}</div><div class="cur-note">Converted with each day's exchange rate. Volume isn't converted.</div>`;
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.top = `${r.bottom + 4}px`;
    m.style.left = `${Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8))}px`;
    m.onclick = (e) => {
      e.stopPropagation();
      const b = e.target.closest("[data-cur]");
      if (!b) return;
      m.remove();
      this.setCurrency(b.dataset.cur);
    };
    setTimeout(() => document.addEventListener("mousedown", function off(e) {
      if (m.contains(e.target)) return document.addEventListener("mousedown", off, { once: true });
      m.remove();
    }, { once: true }));
  }

  // High and low of the bars in view, as labels on the price scale that follow scrolling and zooming
  // (Settings → Scales → High and low price labels).
  updateHighLow() {
    cancelAnimationFrame(this._hlRaf);
    this._hlRaf = requestAnimationFrame(() => {
      const off = this.app.settings.highLow === false || !this.main || !this.shown.length;
      if (this._hl && this._hl.series !== this.main) this._hl = null; // the main series was rebuilt
      if (off) {
        if (this._hl) {
          try { this._hl.series.removePriceLine(this._hl.hi); this._hl.series.removePriceLine(this._hl.lo); } catch { /* gone */ }
          this._hl = null;
        }
        return;
      }
      const r = this.chart.timeScale().getVisibleLogicalRange();
      if (!r) return;
      const a = Math.max(0, Math.floor(r.from)), b = Math.min(this.shown.length - 1, Math.ceil(r.to));
      let hi = -Infinity, lo = Infinity;
      for (let i = a; i <= b; i++) {
        const x = this.shown[i];
        if (x.high > hi) hi = x.high;
        if (x.low < lo) lo = x.low;
      }
      if (!Number.isFinite(hi) || !Number.isFinite(lo)) return;
      const opts = { color: css("--muted"), lineVisible: false, axisLabelVisible: true, axisLabelColor: "#1f3266", axisLabelTextColor: "#ffffff" };
      if (!this._hl)
        this._hl = { series: this.main, hi: this.main.createPriceLine({ ...opts, price: hi, title: "H" }), lo: this.main.createPriceLine({ ...opts, price: lo, title: "L" }) };
      else {
        this._hl.hi.applyOptions({ price: hi });
        this._hl.lo.applyOptions({ price: lo });
      }
    });
  }

  // Keeps the currency label sized to the price scale and the buttons centred on the plot area.
  placeChrome() {
    try {
      const scaleW = this.chart.priceScale("right").width();
      const plotW = this.chart.timeScale().width();
      const cur = this.el.querySelector(".cur-label");
      const c = this.shownCurrency();
      cur.textContent = c || "";
      cur.classList.toggle("converted", !!this.fx);
      cur.title = c ? (canConvert(currencyOf(this.cfg.symbol)) ? "Currency: click to show prices in another one" : "Currency") : "";
      cur.classList.toggle("hidden", !c || !scaleW);
      cur.style.width = `${scaleW}px`;
      const nav = this.el.querySelector(".nav-ctl");
      nav.style.left = `${plotW / 2}px`;
      nav.style.bottom = `${this.chart.timeScale().height() + 34}px`;
    } catch {
      /* chart not ready */
    }
  }

  // Brush: press, drag and let go to draw a freehand line.
  startBrush(e) {
    const r = this.chartEl.getBoundingClientRect();
    const ts = this.chart.timeScale();
    const at = (ev) => {
      const x = ev.clientX - r.left,
        y = ev.clientY - r.top;
      if (y > this.chart.panes()[0].getHeight()) return null;
      const pt = this.pointAt({ point: { x, y }, logical: ts.coordinateToLogical(x) });
      return pt && { ...pt, x, y };
    };
    const first = at(e);
    if (!first) return;
    e.stopPropagation();
    e.preventDefault();
    const d = this.drawings;
    let last = first;
    d.temp = { id: newUid(), type: "brush", points: [{ time: first.time, price: first.price }] };
    d.update();
    const move = (ev) => {
      const pt = at(ev);
      if (!pt || Math.hypot(pt.x - last.x, pt.y - last.y) < 3) return;
      last = pt;
      d.temp.points.push({ time: pt.time, price: pt.price });
      d.update();
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      const item = d.temp;
      d.temp = null;
      if (item && item.points.length > 1) {
        d.items.push(item);
        d.selected = item;
        this.app.saveDrawings(this.cfg.symbol, d.items);
      }
      if (!this.app.settings.stayInDrawMode) this.app.setTool("cursor");
      d.update();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // A drawing point moved by (dx, dy) pixels on screen (cloning puts the copy just below and right).
  shiftPoint(pt, dx, dy) {
    const ts = this.chart.timeScale();
    const x = this.timeToX(pt.time),
      y = this.main.priceToCoordinate(pt.price);
    if (x == null || y == null) return { ...pt };
    const time = this.timeOfLogical(ts.coordinateToLogical(x + dx));
    const price = this.main.coordinateToPrice(y + dy);
    return { ...pt, time: time ?? pt.time, price: price ?? pt.price };
  }

  deleteSelectedDrawing() {
    const d = this.drawings;
    if (!d.selected) return false;
    d.items = d.items.filter((x) => x !== d.selected);
    d.selected = null;
    d.update();
    this.app.saveDrawings(this.cfg.symbol, d.items);
    return true;
  }

  clearDrawings() {
    this.drawings.items = [];
    this.drawings.selected = null;
    this.drawings.temp = null;
    this.drawings.update();
    this.app.saveDrawings(this.cfg.symbol, []);
  }

  setInteractive(on) {
    this.chart.applyOptions({ handleScroll: on, handleScale: on });
    if (on && this.drawings.temp) this.drawings.temp = null;
    this.drawings.update();
  }

  // ---------- live updates ----------
  startLive() {
    this.stopLive();
    if (this.replay || !this.bars.length) return;
    const ex = exchange(this.cfg.symbol);
    const wsTf = BINANCE_WS_TF[this.cfg.tf];
    if (ex === "BINANCE" && this.provider === "Binance" && wsTf)
      this.openSocket(ticker(this.cfg.symbol).toLowerCase(), wsTf, 0);
    else if (ex === "BINANCE" && this.provider === "Binance futures" && wsTf && wsTf !== "1s")
      this.openSocket(ticker(this.cfg.symbol).toLowerCase().replace(/\.p$/, ""), wsTf, 0, ["wss://fstream.binance.com/ws/"]);
    else this.poll();
  }

  openSocket(sym, interval, hostIdx, hosts = [
    "wss://stream.binance.com:9443/ws/",
    "wss://data-stream.binance.vision/ws/",
  ]) {
    if (hostIdx >= hosts.length) return this.poll();
    let opened = false;
    const ws = new WebSocket(`${hosts[hostIdx]}${sym}@kline_${interval}`);
    this.ws = ws;
    ws.onopen = () => {
      opened = true;
      this.app.setStatus("ok");
    };
    ws.onmessage = (m) => {
      const k = JSON.parse(m.data).k;
      if (k)
        this.merge([
          {
            time: k.t / 1000,
            open: +k.o,
            high: +k.h,
            low: +k.l,
            close: +k.c,
            volume: +k.v,
          },
        ]);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!opened) this.openSocket(sym, interval, hostIdx + 1, hosts);
      else this.liveTimer = setTimeout(() => this.startLive(), 3000);
    };
  }

  poll() {
    const kind = ["BINANCE", "COINBASE", "KRAKEN", "BYBIT", "BLOFIN"].includes(
      exchange(this.cfg.symbol),
    )
      ? 3000
      : 10000;
    const tick = async () => {
      try {
        const r = await api.candles(this.cfg.symbol, this.cfg.tf, 5);
        this.merge(r.candles);
      } catch {
        /* keep trying */
      }
      this.liveTimer = setTimeout(tick, kind);
    };
    this.liveTimer = setTimeout(tick, kind);
  }

  stopLive() {
    clearTimeout(this.liveTimer);
    this.liveTimer = null;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.close();
    }
  }

  merge(newBars) {
    if (!this.bars.length || this.replay) return;
    let changed = false;
    for (const b of newBars) {
      const last = this.bars.at(-1);
      if (b.time === last.time) {
        this.bars[this.bars.length - 1] = b;
        changed = true;
      } else if (b.time > last.time) {
        this.bars.push(b);
        changed = true;
      }
    }
    if (!changed) return;
    const last = this.bars.at(-1);
    this.app.onPrice(this.cfg.symbol, last.close);
    const simple = [
      "candles",
      "hollow",
      "bars",
      "line",
      "linemarkers",
      "step",
      "area",
      "baseline",
      "columns",
    ].includes(this.cfg.type) && !this.fx;
    if (simple) {
      this.shown = this.bars;
      if (this.times.at(-1) !== this.toChart(last.time))
        this.times.push(this.toChart(last.time));
      this.main.update(this.pointFor(last));
      this.updateHighLow();
    }
    const now = Date.now();
    if (now - (this.mtfCheckedAt || 0) > 60000) {
      this.mtfCheckedAt = now;
      for (const [tf, h] of Object.entries(this.mtf || {})) if (now - h.at > 60000) this.loadMtf(tf);
    }
    if (!simple || now - (this.lastFull || 0) > 1500) {
      this.lastFull = now;
      if (simple) {
        this.renderIndicators();
        this.updateLegend();
      } else this.render(false);
    }
  }

  // ---------- bar replay ----------
  startReplay(index) {
    this.stopLive();
    this.replay = {
      index: Math.max(1, Math.min(index, this.bars.length - 1)),
      playing: false,
      speed: 2,
    };
    let bar = this.el.querySelector(".replay-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "replay-bar";
      bar.innerHTML = `<span class="hint">Replay</span>
        <button data-r="back" title="Step back">&#9664;&#9664;</button>
        <button data-r="play" title="Play / pause">&#9654;</button>
        <button data-r="fwd" title="Step forward">&#9654;&#9654;</button>
        <select data-r="speed" title="Speed"><option value="0.5">0.5x</option><option value="1">1x</option><option value="2" selected>2x</option><option value="5">5x</option><option value="10">10x</option></select>
        <button data-r="pick" title="Pick a new start bar">Jump to…</button>
        ${this.app.panes.length > 1 ? `<label class="hint" title="Replay every chart in the layout to the same moment"><input type="checkbox" data-r="sync" ${this.app.settings.syncReplay ? "checked" : ""}> All charts</label>` : ""}
        <button data-r="exit" title="Back to live">Exit</button>`;
      this.el.appendChild(bar);
      bar.addEventListener("click", (e) => {
        const r = e.target.closest("[data-r]")?.dataset.r;
        if (r === "back") this.replayStep(-1);
        if (r === "fwd") this.replayStep(1);
        if (r === "play") this.toggleReplay();
        if (r === "pick") this.app.setTool("replay-pick");
        if (r === "exit") this.stopReplay();
      });
      const sync = bar.querySelector('[data-r="sync"]');
      if (sync)
        sync.onchange = (e) => {
          this.app.settings.syncReplay = e.target.checked;
          this.app.persist();
          if (e.target.checked) this.app.onReplayStart?.(this);
          else this.app.onReplayStop?.(this, { keepSelf: true });
        };
      bar.querySelector('[data-r="speed"]').onchange = (e) => {
        this.replay.speed = Number(e.target.value);
        if (this.replay.playing) {
          this.toggleReplay();
          this.toggleReplay();
        }
      };
    }
    this.render(false);
    this.app.onReplayStart?.(this);
  }

  // Follow another chart's replay: show only the bars that had finished by `endTime`.
  replayTo(endTime) {
    const sec = parseTf(this.cfg.tf).seconds;
    let i = this.bars.length - 1;
    while (i > 0 && this.bars[i].time + sec > endTime) i--;
    if (!this.replay) {
      this.stopLive();
      this.replay = { index: i, playing: false, speed: 2, follower: true };
      this.el.querySelector(".replay-bar")?.remove();
      const tag = document.createElement("div");
      tag.className = "replay-bar follower";
      tag.innerHTML = '<span class="hint">Synced replay</span>';
      this.el.appendChild(tag);
    } else this.replay.index = i;
    this.render(false);
  }

  replayStep(dir) {
    if (!this.replay) return;
    const next = this.replay.index + dir;
    if (next < 1 || next >= this.bars.length) {
      if (this.replay.playing) this.toggleReplay();
      return;
    }
    this.replay.index = next;
    this.render(false);
    this.app.onReplayBar?.(this, this.bars[next]);
  }

  toggleReplay() {
    if (!this.replay) return;
    this.replay.playing = !this.replay.playing;
    clearInterval(this.replayTimer);
    if (this.replay.playing)
      this.replayTimer = setInterval(
        () => this.replayStep(1),
        1000 / this.replay.speed,
      );
    const btn = this.el.querySelector('[data-r="play"]');
    if (btn)
      btn.innerHTML = this.replay.playing ? "&#10074;&#10074;" : "&#9654;";
  }

  stopReplay() {
    clearInterval(this.replayTimer);
    const wasFollower = this.replay?.follower;
    this.replay = null;
    this.el.querySelector(".replay-bar")?.remove();
    this.render(true);
    this.startLive();
    if (!wasFollower) this.app.onReplayStop?.(this);
  }

  // ---------- export ----------
  screenshot() {
    const canvas = this.chart.takeScreenshot(true);
    const ctx = canvas.getContext("2d");
    ctx.font = "600 14px -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = css("--text");
    ctx.fillText(`${ticker(this.cfg.symbol)} · ${this.cfg.tf}`, 12, 22);
    return canvas;
  }

  // ---------- countdown to bar close (next to the last price on the price scale) ----------
  // Indian stocks and indices count down within NSE hours (09:15–15:30 IST, Mon–Fri) and show
  // nothing while the market is closed; crypto and forex count down around the clock.
  barCloseIn(nowSec = Date.now() / 1000) {
    const tf = parseTf(this.cfg.tf).seconds;
    if (!tf || this.replay || !this.shown.length) return null;
    const ex = exchange(this.cfg.symbol);
    if (ex === "YAHOO") {
      if (tf > 86400) return null;
      const ist = nowSec + 19800;
      const day = new Date(ist * 1000).getUTCDay();
      const mins = Math.floor((ist % 86400) / 60);
      if (day < 1 || day > 5 || mins < 555 || mins >= 930) return null;
      const sessEnd = Math.floor(ist / 86400) * 86400 + 930 * 60 - 19800;
      if (tf >= 86400) return sessEnd - nowSec;
      const sessStart = sessEnd - 375 * 60;
      return Math.min(sessEnd, sessStart + (Math.floor((nowSec - sessStart) / tf) + 1) * tf) - nowSec;
    }
    if (ex === "CSV") return null;
    if (tf === 604800) return Math.floor((nowSec - 345600) / 604800) * 604800 + 345600 + 604800 - nowSec; // weeks start Monday 00:00 UTC
    if (tf > 604800) {
      const d = new Date(nowSec * 1000);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000 - nowSec;
    }
    return (Math.floor(nowSec / tf) + 1) * tf - nowSec;
  }
  tickCountdown() {
    if (!this.main) return;
    const left = this.barCloseIn();
    let txt = "";
    if (left != null && left > 0) {
      const s = Math.floor(left), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      const two = (n) => String(n).padStart(2, "0");
      txt = d ? `${d}d ${two(h)}h` : h ? `${two(h)}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
    }
    if (txt !== this.countdownTxt) {
      this.countdownTxt = txt;
      this.main.applyOptions({ title: txt });
    }
  }

  destroy() {
    this.stopLive();
    clearInterval(this.countdownTimer);
    clearInterval(this.replayTimer);
    this.chart.remove();
  }
}
