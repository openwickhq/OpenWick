// Draws the Standard Deviation Channel: straight dashed lines from the channel's first bar to its
// last (optionally extended to the chart's edges), a fill between Upper 1 and the middle line and
// between the middle line and Lower 1, and Pearson's R under the start of Lower 1. Lines are
// straight on screen, like lines drawn by a Pine script, also on a log scale.
const LINES = ["upper2", "upper1", "base", "lower1", "lower2"];

const rgba = (hex, a) => {
  const h = String(hex || "#888").replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(v, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export class StdDevChannel {
  constructor(pane, channel, colors) {
    this.pane = pane;
    this.c = channel;
    this.colors = colors;
    this._view = {
      zOrder: () => "normal",
      renderer: () => ({
        draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.draw(context, mediaSize)),
      }),
    };
  }
  attached({ series, requestUpdate }) {
    this.series = series;
    this.requestUpdate = requestUpdate;
  }
  detached() {
    this.series = null;
  }
  updateAllViews() {}
  paneViews() {
    return [this._view];
  }
  price(key, i) {
    const c = this.c;
    const base = c.start + (c.to > c.from ? ((i - c.from) * (c.end - c.start)) / (c.to - c.from) : 0);
    return key === "base" ? base : base + c.offsets[key];
  }
  // Keep the whole channel in view when the price scale fits itself to the chart, unless Settings →
  // Scales → "Scale price chart only" is on (then the candles alone set the scale).
  autoscaleInfo(from, to) {
    if (this.pane.app.settings.scalePriceOnly !== false) return null;
    const c = this.c;
    if (to < c.from && !c.extendRight) return null;
    if (from > c.to && !c.extendLeft) return null;
    const a = Math.max(from, c.extendLeft ? from : c.from), b = Math.min(to, c.extendRight ? to : c.to);
    if (a > b) return null;
    const vals = LINES.flatMap((k) => [this.price(k, a), this.price(k, b)]);
    return { priceRange: { minValue: Math.min(...vals), maxValue: Math.max(...vals) } };
  }

  draw(ctx, size) {
    const c = this.c, s = this.series, ts = this.pane.chart.timeScale();
    if (!s) return;
    const x1 = ts.logicalToCoordinate(c.from), x2 = ts.logicalToCoordinate(c.to);
    if (x1 == null || x2 == null) return;
    // Each line as two screen points, then stretched to the edges if it's extended.
    const seg = (key) => {
      const y1 = s.priceToCoordinate(this.price(key, c.from)), y2 = s.priceToCoordinate(this.price(key, c.to));
      if (y1 == null || y2 == null) return null;
      const k = x2 !== x1 ? (y2 - y1) / (x2 - x1) : 0;
      const L = c.extendLeft ? Math.min(x1, -2) : x1, R = c.extendRight ? Math.max(x2, size.width + 2) : x2;
      return { xa: L, ya: y1 + (L - x1) * k, xb: R, yb: y1 + (R - x1) * k, y1 };
    };
    const P = Object.fromEntries(LINES.map((k) => [k, seg(k)]));
    ctx.save();
    const fill = (a, b, color) => {
      if (!a || !b || !(c.fillOpacity > 0)) return;
      ctx.fillStyle = rgba(color, c.fillOpacity);
      ctx.beginPath();
      ctx.moveTo(a.xa, a.ya);
      ctx.lineTo(a.xb, a.yb);
      ctx.lineTo(b.xb, b.yb);
      ctx.lineTo(b.xa, b.ya);
      ctx.closePath();
      ctx.fill();
    };
    fill(P.upper1, P.base, this.colors.upper1);
    fill(P.base, P.lower1, this.colors.lower1);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (const k of LINES) {
      const p = P[k];
      if (!p) continue;
      ctx.strokeStyle = this.colors[k];
      ctx.beginPath();
      ctx.moveTo(p.xa, p.ya);
      ctx.lineTo(p.xb, p.yb);
      ctx.stroke();
    }
    if (c.showR && P.lower1) {
      ctx.setLineDash([]);
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = this.colors.upper1;
      ctx.fillText(String(Number(c.pearsonR.toFixed(16))), x1, P.lower1.y1 + 6);
    }
    ctx.restore();
  }
}
