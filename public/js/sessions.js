// Intraday chart background: a dashed line where each new trading day starts, and (on 24-hour
// markets such as crypto and forex) a light band over NSE trading hours, 09:15–15:30 IST on weekdays.
// Drawn behind the candles as a Lightweight Charts series primitive.
const IST = 19800;

export class SessionLayer {
  constructor(pane) {
    this.pane = pane;
    this._view = {
      zOrder: () => "bottom",
      renderer: () => ({
        draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.draw(context, mediaSize)),
      }),
    };
  }
  attached({ requestUpdate }) {
    this.requestUpdate = requestUpdate;
  }
  detached() {}
  updateAllViews() {}
  paneViews() {
    return [this._view];
  }

  draw(ctx, size) {
    const p = this.pane, s = p.app.settings;
    const bars = p.shown;
    if (!bars?.length || !p.isIntradayChart?.()) return;
    const showSep = s.daySeparators !== false;
    const nseMarket = /^YAHOO:/.test(p.cfg.symbol);
    const showBand = s.nseHours !== false && !nseMarket && !/^CSV:/.test(p.cfg.symbol);
    if (!showSep && !showBand) return;
    const ts = p.chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const from = Math.max(0, Math.floor(range.from) - 1), to = Math.min(bars.length - 1, Math.ceil(range.to) + 1);
    const x = (i) => ts.logicalToCoordinate(i);
    const half = Math.max(0.5, ((x(from + 1) ?? 0) - (x(from) ?? 0)) / 2);
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    // Indian symbols split days on India's calendar; others on the time the axis shows.
    const off = nseMarket ? IST : s.utc ? 0 : -new Date().getTimezoneOffset() * 60;
    const dayOf = (t) => Math.floor((t + off) / 86400);
    const inNse = (t) => {
      const ist = t + IST, d = new Date(ist * 1000).getUTCDay(), m = Math.floor((ist % 86400) / 60);
      return d >= 1 && d <= 5 && m >= 555 && m < 930;
    };
    ctx.save();
    if (showBand) {
      ctx.fillStyle = css("--accent-soft") || "rgba(255,255,255,.06)";
      ctx.globalAlpha = 0.45;
      let start = null;
      for (let i = from; i <= to + 1; i++) {
        const on = i <= to && inNse(bars[i].time);
        if (on && start == null) start = i;
        if (!on && start != null) {
          const x1 = (x(start) ?? 0) - half, x2 = (x(i - 1) ?? 0) + half;
          ctx.fillRect(x1, 0, x2 - x1, size.height);
          start = null;
        }
      }
      ctx.globalAlpha = 1;
    }
    if (showSep) {
      ctx.strokeStyle = css("--muted") || "#888";
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      for (let i = Math.max(1, from); i <= to; i++) {
        if (dayOf(bars[i].time) === dayOf(bars[i - 1].time)) continue;
        const xx = Math.round((x(i) ?? 0) - half) + 0.5;
        ctx.beginPath();
        ctx.moveTo(xx, 0);
        ctx.lineTo(xx, size.height);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
