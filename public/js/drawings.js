// Drawing tools, rendered as a Lightweight Charts series primitive. Points are stored as
// { time (UTC seconds), price } so drawings stay put when you change timeframe.

export const TOOLS = [
  { id: "cursor", label: "Cursor", icon: '<path d="M5 3l14 7-6 2-2 6z"/>' },
  {
    id: "trend",
    label: "Trend line",
    points: 2,
    icon: '<path d="M4 19L20 5"/><circle cx="4" cy="19" r="1.6"/><circle cx="20" cy="5" r="1.6"/>',
  },
  {
    id: "ray",
    label: "Ray",
    points: 2,
    icon: '<path d="M4 19L21 4"/><circle cx="4" cy="19" r="1.6"/><circle cx="11" cy="13" r="1.6"/>',
  },
  {
    id: "extended",
    label: "Extended line",
    points: 2,
    icon: '<path d="M2 21L22 3"/><circle cx="8" cy="16" r="1.6"/><circle cx="16" cy="9" r="1.6"/>',
  },
  {
    id: "hline",
    label: "Horizontal line",
    points: 1,
    icon: '<path d="M3 12h18"/><circle cx="12" cy="12" r="1.6"/>',
  },
  {
    id: "hray",
    label: "Horizontal ray",
    points: 1,
    icon: '<path d="M8 12h13"/><circle cx="8" cy="12" r="1.6"/>',
  },
  {
    id: "vline",
    label: "Vertical line",
    points: 1,
    icon: '<path d="M12 3v18"/><circle cx="12" cy="12" r="1.6"/>',
  },
  {
    id: "channel",
    label: "Parallel channel",
    points: 3,
    icon: '<path d="M3 15L15 5M9 21l12-10"/>',
  },
  {
    id: "rect",
    label: "Rectangle",
    points: 2,
    icon: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  },
  {
    id: "fib",
    label: "Fib retracement",
    points: 2,
    icon: '<path d="M3 5h18M3 10h18M3 14h18M3 19h18" stroke-dasharray="2 2"/>',
  },
  {
    id: "measure",
    label: "Measure",
    points: 2,
    icon: '<path d="M3.5 15.5l12-12 5 5-12 12z"/><path d="M7 12l2 2M10 9l1.5 1.5M13 6l2 2"/>',
  },
  {
    id: "long",
    label: "Long position",
    points: 2,
    icon: '<rect x="4" y="5" width="16" height="7" fill="currentColor" fill-opacity=".25"/><rect x="4" y="12" width="16" height="7"/>',
  },
  {
    id: "short",
    label: "Short position",
    points: 2,
    icon: '<rect x="4" y="5" width="16" height="7"/><rect x="4" y="12" width="16" height="7" fill="currentColor" fill-opacity=".25"/>',
  },
  {
    id: "text",
    label: "Text note",
    points: 1,
    icon: '<path d="M5 6h14M12 6v13"/>',
  },
  {
    id: "crossline",
    label: "Cross line",
    points: 1,
    icon: '<path d="M3 12h18M12 3v18"/><circle cx="12" cy="12" r="1.6"/>',
  },
  {
    id: "arrow",
    label: "Arrow",
    points: 2,
    icon: '<path d="M4 20L19 5"/><path d="M11 5h8v8"/>',
  },
  {
    id: "fibext",
    label: "Trend-based fib extension",
    points: 3,
    icon: '<path d="M3 20l4-8 4 5" stroke-dasharray="2 2"/><path d="M12 5h9M12 9h9M12 13h9M12 17h9"/>',
  },
  {
    id: "pitchfork",
    label: "Pitchfork",
    points: 3,
    icon: '<path d="M3 13h18M9 6h12M9 20h12M9 6v14"/><circle cx="3" cy="13" r="1.6"/>',
  },
  {
    id: "ellipse",
    label: "Ellipse",
    points: 2,
    icon: '<ellipse cx="12" cy="12" rx="9" ry="6"/>',
  },
  {
    id: "triangle",
    label: "Triangle",
    points: 3,
    icon: '<path d="M12 4L21 19H3z"/>',
  },
  {
    id: "brush",
    label: "Brush (press and drag)",
    freehand: true,
    icon: '<path d="M3 17c3-6 6 2 9-3s4-7 9-8"/>',
  },
  {
    id: "arrowup",
    label: "Arrow mark up",
    points: 1,
    icon: '<path d="M12 4l6 7h-4v9h-4v-9H6z"/>',
  },
  {
    id: "arrowdown",
    label: "Arrow mark down",
    points: 1,
    icon: '<path d="M12 20l6-7h-4V4h-4v9H6z"/>',
  },
  {
    id: "pricerange",
    label: "Price range",
    points: 2,
    icon: '<path d="M5 4h14M5 20h14M12 7v10M9 10l3-3 3 3M9 14l3 3 3-3"/>',
  },
  {
    id: "daterange",
    label: "Date range",
    points: 2,
    icon: '<path d="M4 5v14M20 5v14M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3"/>',
  },
  {
    id: "avwap",
    label: "Anchored VWAP (click the start bar)",
    points: 1,
    indicator: "avwap",
    icon: '<path d="M4 18c4-1 5-8 9-9s5 2 7 1"/><circle cx="4" cy="18" r="1.8"/>',
  },
];
export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
// How the tools are grouped on the left toolbar: each group is one button that shows the tool
// last used from it, with a menu of the rest.
export const TOOL_GROUPS = [
  { id: "cursor", label: "Cursor", tools: ["cursor"] },
  { id: "lines", label: "Lines", tools: ["trend", "ray", "extended", "hline", "hray", "vline", "crossline", "arrow", "channel"] },
  { id: "fib", label: "Fibonacci and pitchfork", tools: ["fib", "fibext", "pitchfork"] },
  { id: "shapes", label: "Shapes", tools: ["rect", "ellipse", "triangle", "brush"] },
  { id: "notes", label: "Notes and arrow marks", tools: ["text", "arrowup", "arrowdown"] },
  { id: "measure", label: "Positions and ranges", tools: ["long", "short", "pricerange", "daterange", "avwap"] },
  // Its own button, below the groups, next to zoom in and zoom out.
  { id: "ruler", label: "Measure", tools: ["measure"], own: true },
];
export const FIBEXT_LEVELS = [0, 0.382, 0.618, 1, 1.272, 1.618, 2, 2.618];

// Trend-based fib extension: the move from a to b, repeated from c, at `lv` of its size.
export const fibExtPrice = (a, b, c, lv) => c + (b - a) * lv;

// Pitchfork from three screen points: the median line runs from `a` through the middle of b–c,
// and the two outer lines run from b and c parallel to it. Each line is [start, far end].
export function pitchforkLines(a, b, c, far = 1e5) {
  const m = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
  const dx = m.x - a.x,
    dy = m.y - a.y,
    len = Math.hypot(dx, dy) || 1;
  const go = (p) => ({ x: p.x + (dx / len) * far, y: p.y + (dy / len) * far });
  return { median: [a, go(a)], upper: [b, go(b)], lower: [c, go(c)], base: [b, c], mid: m };
}

// Is (x, y) inside the triangle a, b, c?
export function inTriangle(x, y, a, b, c) {
  const s = (p, q) => (x - q.x) * (p.y - q.y) - (p.x - q.x) * (y - q.y);
  const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

// A length of time as "45m", "6h 30m", "12d" or "3d 4h", for the date range tool.
export function fmtSpan(sec) {
  sec = Math.abs(Math.round(sec));
  const d = Math.floor(sec / 86400),
    h = Math.floor((sec % 86400) / 3600),
    m = Math.floor((sec % 3600) / 60);
  if (d >= 10) return `${d}d`;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618];
// Line styles a drawing can have (set from the toolbar that shows on a selected drawing).
export const DASHES = { solid: [], dashed: [6, 4], dotted: [1.5, 3] };

// Shift: the end point `b` locked to the nearest 45° step from `a` (pixels). axis says when the
// result is flat ("h") or upright ("v"), so callers can copy the anchor's price or time exactly.
export function constrain45(a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    r = Math.hypot(dx, dy);
  if (!r) return { x: b.x, y: b.y, axis: null };
  const k = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
  const ang = (k * Math.PI) / 4;
  return {
    x: a.x + r * Math.cos(ang),
    y: a.y + r * Math.sin(ang),
    axis: k % 4 === 0 ? "h" : k % 4 === 2 ? "v" : null,
  };
}

// Ctrl (Cmd on Mac): the bar's open, high, low or close nearest to `price`.
export function snapToOHLC(bar, price) {
  return [bar.open, bar.high, bar.low, bar.close].reduce((best, v) =>
    Math.abs(v - price) < Math.abs(best - price) ? v : best,
  );
}

const COLORS = {
  line: "#7c5cff",
  fib: "#787b86",
  up: "rgba(8,153,129,",
  down: "rgba(242,54,69,",
};
// The colour a drawing is shown in when it has none of its own.
export const colorOf = (d) =>
  d.color || { fib: COLORS.fib, fibext: COLORS.fib, arrowup: "#089981", arrowdown: "#f23645" }[d.type] || COLORS.line;

export class DrawingLayer {
  constructor(pane) {
    this.pane = pane;
    this.items = [];
    this.temp = null;
    this.selected = null;
    this._view = {
      zOrder: () => "top",
      renderer: () => ({
        draw: (target) =>
          target.useMediaCoordinateSpace(({ context, mediaSize }) =>
            this.draw(context, mediaSize),
          ),
      }),
    };
  }

  // --- ISeriesPrimitive ---
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
  update() {
    this.requestUpdate?.();
  }

  x(t) {
    return this.pane.timeToX(t);
  }
  y(p) {
    return this.series?.priceToCoordinate(p) ?? null;
  }

  setItems(items) {
    this.items = items || [];
    this.selected = null;
    this.update();
  }

  draw(ctx, size) {
    ctx.save();
    ctx.font = "11px -apple-system, Segoe UI, Roboto, sans-serif";
    for (const d of [...this.items, ...(this.temp ? [this.temp] : [])]) {
      if (d.hidden) continue;
      try {
        this.drawOne(ctx, size, d, d === this.selected || d === this.temp);
      } catch {
        /* off-screen */
      }
    }
    ctx.restore();
    this.onDraw?.(size);
  }

  drawOne(ctx, size, d, active) {
    const pts = d.points.map((p) => ({
      x: this.x(p.time),
      y: this.y(p.price),
      ...p,
    }));
    if (pts.some((p) => p.x == null || p.y == null)) return;
    const color = colorOf(d);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = (d.width || 1.5) + (active ? 0.5 : 0);
    const dash = DASHES[d.dash] || [];
    ctx.setLineDash(dash);
    const [a, b, c] = pts;
    const line = (x1, y1, x2, y2) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    const label = (txt, x, y, align = "left", bg = null) => {
      ctx.textAlign = align;
      ctx.textBaseline = "middle";
      if (bg) {
        const w = ctx.measureText(txt).width + 10;
        ctx.fillStyle = bg;
        ctx.fillRect(
          align === "center" ? x - w / 2 : align === "right" ? x - w : x,
          y - 9,
          w,
          18,
        );
        ctx.fillStyle = "#fff";
        ctx.fillText(
          txt,
          align === "center" ? x : align === "right" ? x - 5 : x + 5,
          y,
        );
        ctx.fillStyle = color;
      } else ctx.fillText(txt, x, y);
    };
    const extend = (p, q, both) => {
      const dx = q.x - p.x,
        dy = q.y - p.y;
      if (dx === 0 && dy === 0) return [p, q];
      const far = 1e5;
      const len = Math.hypot(dx, dy);
      const e2 = { x: p.x + (dx / len) * far, y: p.y + (dy / len) * far };
      const e1 = both
        ? { x: p.x - (dx / len) * far, y: p.y - (dy / len) * far }
        : p;
      return [e1, e2];
    };
    const price = (v) => this.pane.formatPrice(v);

    switch (d.type) {
      case "trend":
        line(a.x, a.y, b.x, b.y);
        break;
      case "ray": {
        const [p, q] = extend(a, b, false);
        line(p.x, p.y, q.x, q.y);
        break;
      }
      case "extended": {
        const [p, q] = extend(a, b, true);
        line(p.x, p.y, q.x, q.y);
        break;
      }
      case "hline":
        line(0, a.y, size.width, a.y);
        label(price(a.price), size.width - 4, a.y - 10, "right");
        break;
      case "hray":
        line(a.x, a.y, size.width, a.y);
        label(price(a.price), size.width - 4, a.y - 10, "right");
        break;
      case "vline":
        line(a.x, 0, a.x, size.height);
        break;
      case "channel": {
        line(a.x, a.y, b.x, b.y);
        if (c) {
          const off =
            c.y - (a.y + ((b.y - a.y) * (c.x - a.x)) / (b.x - a.x || 1));
          line(a.x, a.y + off, b.x, b.y + off);
          ctx.globalAlpha = 0.08;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(b.x, b.y + off);
          ctx.lineTo(a.x, a.y + off);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        break;
      }
      case "rect": {
        ctx.globalAlpha = 0.12;
        ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.globalAlpha = 1;
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        break;
      }
      case "fib": {
        const x1 = Math.min(a.x, b.x),
          x2 = Math.max(a.x, b.x);
        ctx.strokeStyle = d.color || COLORS.fib;
        for (const lv of FIB_LEVELS) {
          const p = b.price + (a.price - b.price) * lv;
          const y = this.y(p);
          if (y == null) continue;
          ctx.globalAlpha = lv === 0.5 || lv === 0.618 ? 1 : 0.7;
          line(x1, y, x2, y);
          ctx.globalAlpha = 1;
          ctx.fillStyle = d.color || COLORS.fib;
          label(`${lv} (${price(p)})`, x1 + 2, y - 8);
        }
        ctx.setLineDash([3, 3]);
        line(a.x, a.y, b.x, b.y);
        ctx.setLineDash(dash);
        break;
      }
      case "measure": {
        const up = b.price >= a.price;
        ctx.fillStyle = (up ? COLORS.up : COLORS.down) + "0.15)";
        ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.strokeStyle = (up ? COLORS.up : COLORS.down) + "1)";
        line((a.x + b.x) / 2, a.y, (a.x + b.x) / 2, b.y);
        const bars = Math.round(
          this.pane.logicalOf(b.time) - this.pane.logicalOf(a.time),
        );
        const diff = b.price - a.price,
          pct = (diff / a.price) * 100;
        ctx.fillStyle = (up ? COLORS.up : COLORS.down) + "1)";
        label(
          `${diff >= 0 ? "+" : ""}${price(diff)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)  ${bars} bars`,
          (a.x + b.x) / 2,
          b.y + (up ? -14 : 14),
          "center",
          (up ? COLORS.up : COLORS.down) + "0.9)",
        );
        break;
      }
      case "long":
      case "short": {
        // first point = entry, second point sets the stop (its price) and the width (its time); target = 2R
        const dir = d.type === "long" ? 1 : -1;
        const risk = Math.abs(a.price - b.price) || a.price * 0.01;
        const stop = a.price - dir * risk,
          target = a.price + dir * risk * (d.rr || 2);
        const ys = this.y(stop),
          yt = this.y(target);
        const x1 = Math.min(a.x, b.x),
          w = Math.max(Math.abs(b.x - a.x), 40);
        ctx.fillStyle = COLORS.up + "0.18)";
        ctx.fillRect(x1, a.y, w, yt - a.y);
        ctx.fillStyle = COLORS.down + "0.18)";
        ctx.fillRect(x1, a.y, w, ys - a.y);
        ctx.strokeStyle = "#787b86";
        line(x1, a.y, x1 + w, a.y);
        ctx.fillStyle = COLORS.up + "1)";
        label(
          `Target ${price(target)} (${(((target - a.price) / a.price) * 100 * dir).toFixed(2)}%)`,
          x1 + w / 2,
          yt + (dir > 0 ? 10 : -10),
          "center",
          COLORS.up + "0.9)",
        );
        label(
          `Stop ${price(stop)} (${(((a.price - stop) / a.price) * 100 * dir).toFixed(2)}%)`,
          x1 + w / 2,
          ys + (dir > 0 ? -10 : 10),
          "center",
          COLORS.down + "0.9)",
        );
        ctx.fillStyle = "#787b86";
        label(
          `Entry ${price(a.price)}  R:R ${(d.rr || 2).toFixed(1)}`,
          x1 + 4,
          a.y - 9,
        );
        break;
      }
      case "text": {
        ctx.font = "13px -apple-system, Segoe UI, Roboto, sans-serif";
        label(d.text || "Note", a.x, a.y, "left", d.color || COLORS.line);
        break;
      }
      case "crossline":
        line(0, a.y, size.width, a.y);
        line(a.x, 0, a.x, size.height);
        label(price(a.price), size.width - 4, a.y - 10, "right");
        break;
      case "arrow": {
        line(a.x, a.y, b.x, b.y);
        const ang = Math.atan2(b.y - a.y, b.x - a.x),
          L = 10 + (d.width || 1.5) * 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - L * Math.cos(ang - 0.42), b.y - L * Math.sin(ang - 0.42));
        ctx.lineTo(b.x - L * Math.cos(ang + 0.42), b.y - L * Math.sin(ang + 0.42));
        ctx.closePath();
        ctx.fill();
        ctx.setLineDash(dash);
        break;
      }
      case "fibext": {
        ctx.setLineDash([3, 3]);
        line(a.x, a.y, b.x, b.y);
        if (c) line(b.x, b.y, c.x, c.y);
        ctx.setLineDash(dash);
        if (!c) break;
        const x1 = c.x,
          x2 = c.x + Math.max(Math.abs(b.x - a.x), 80);
        for (const lv of FIBEXT_LEVELS) {
          const p = fibExtPrice(a.price, b.price, c.price, lv);
          const y = this.y(p);
          if (y == null) continue;
          ctx.globalAlpha = lv === 1 || lv === 1.618 ? 1 : 0.7;
          line(x1, y, x2, y);
          ctx.globalAlpha = 1;
          label(`${lv} (${price(p)})`, x2 + 4, y);
        }
        break;
      }
      case "pitchfork": {
        if (!c) {
          line(a.x, a.y, b.x, b.y);
          break;
        }
        const f = pitchforkLines(a, b, c);
        ctx.globalAlpha = 0.07;
        ctx.beginPath();
        ctx.moveTo(f.upper[0].x, f.upper[0].y);
        ctx.lineTo(f.upper[1].x, f.upper[1].y);
        ctx.lineTo(f.lower[1].x, f.lower[1].y);
        ctx.lineTo(f.lower[0].x, f.lower[0].y);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        for (const k of ["median", "upper", "lower", "base"]) line(f[k][0].x, f[k][0].y, f[k][1].x, f[k][1].y);
        break;
      }
      case "ellipse": {
        ctx.beginPath();
        ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
        ctx.globalAlpha = 0.12;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
        break;
      }
      case "triangle": {
        if (!c) {
          line(a.x, a.y, b.x, b.y);
          break;
        }
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.closePath();
        ctx.globalAlpha = 0.12;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
        break;
      }
      case "brush": {
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
        break;
      }
      case "arrowup":
      case "arrowdown": {
        // The arrow's tip sits on the clicked price: below the bar pointing up, or above pointing down.
        const s = d.type === "arrowup" ? 1 : -1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + 8, a.y + s * 9);
        ctx.lineTo(a.x + 3, a.y + s * 9);
        ctx.lineTo(a.x + 3, a.y + s * 22);
        ctx.lineTo(a.x - 3, a.y + s * 22);
        ctx.lineTo(a.x - 3, a.y + s * 9);
        ctx.lineTo(a.x - 8, a.y + s * 9);
        ctx.closePath();
        ctx.fill();
        if (d.text) label(d.text, a.x, a.y + s * 32, "center");
        break;
      }
      case "pricerange":
      case "daterange": {
        ctx.globalAlpha = 0.12;
        ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.globalAlpha = 1;
        const mx = (a.x + b.x) / 2,
          my = (a.y + b.y) / 2;
        const head = (x, y, ang) => {
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - 7 * Math.cos(ang - 0.5), y - 7 * Math.sin(ang - 0.5));
          ctx.lineTo(x - 7 * Math.cos(ang + 0.5), y - 7 * Math.sin(ang + 0.5));
          ctx.closePath();
          ctx.fill();
          ctx.setLineDash(dash);
        };
        let txt;
        if (d.type === "pricerange") {
          line(a.x, a.y, b.x, a.y);
          line(a.x, b.y, b.x, b.y);
          line(mx, a.y, mx, b.y);
          head(mx, b.y, b.y > a.y ? Math.PI / 2 : -Math.PI / 2);
          const diff = b.price - a.price,
            pct = (diff / a.price) * 100;
          txt = `${diff >= 0 ? "+" : ""}${price(diff)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
          label(txt, mx, b.y + (b.y > a.y ? 14 : -14), "center", color);
        } else {
          line(a.x, a.y, a.x, b.y);
          line(b.x, a.y, b.x, b.y);
          line(a.x, my, b.x, my);
          head(b.x, my, b.x >= a.x ? 0 : Math.PI);
          const bars = Math.round(this.pane.logicalOf(b.time) - this.pane.logicalOf(a.time));
          txt = `${bars} bars, ${fmtSpan(b.time - a.time)}`;
          label(txt, mx, Math.max(a.y, b.y) + 14, "center", color);
        }
        break;
      }
      default:
        break;
    }
    if (active && d.type !== "brush") {
      ctx.setLineDash([]);
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // The drawing's points on screen as { left, right, top, bottom }, or null when it isn't on the chart.
  boxOf(d) {
    const pts = d.points.map((p) => ({ x: this.x(p.time), y: this.y(p.price) }));
    if (!pts.length || pts.some((p) => p.x == null || p.y == null)) return null;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  }

  // Index of the drawing's point under (x, y), or -1, for resizing by its handles.
  handleAt(d, x, y) {
    if (d.type === "brush") return -1;
    return d.points.findIndex(
      (p) => Math.hypot(this.x(p.time) - x, this.y(p.price) - y) <= 7,
    );
  }

  // Nearest drawing within a few pixels of (x, y), for selecting.
  hitTest(x, y) {
    let best = null,
      bestD = 7;
    const segDist = (p, q) => {
      const dx = q.x - p.x,
        dy = q.y - p.y,
        l2 = dx * dx + dy * dy;
      const t = l2
        ? Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / l2))
        : 0;
      return Math.hypot(x - (p.x + t * dx), y - (p.y + t * dy));
    };
    for (const d of this.items) {
      if (d.hidden) continue;
      const pts = d.points.map((p) => ({
        x: this.x(p.time),
        y: this.y(p.price),
      }));
      if (pts.some((p) => p.x == null || p.y == null)) continue;
      const [a, b, c] = pts;
      let dist = Infinity;
      const near = (list) => Math.min(...list.map(([p, q]) => segDist(p, q)));
      if (d.type === "crossline") dist = Math.min(Math.abs(y - a.y), Math.abs(x - a.x));
      else if (d.type === "brush") dist = near(pts.slice(1).map((q, i) => [pts[i], q]));
      else if (d.type === "arrowup" || d.type === "arrowdown") {
        const s = d.type === "arrowup" ? 1 : -1;
        dist = Math.abs(x - a.x) <= 9 && (y - a.y) * s >= -3 && (y - a.y) * s <= 25 ? 0 : Infinity;
      } else if (d.type === "ellipse" && b) {
        const rx = Math.abs(b.x - a.x) / 2 || 1,
          ry = Math.abs(b.y - a.y) / 2 || 1;
        dist = ((x - (a.x + b.x) / 2) / rx) ** 2 + ((y - (a.y + b.y) / 2) / ry) ** 2 <= 1.15 ? 3 : Infinity;
      } else if (d.type === "triangle" && c) dist = inTriangle(x, y, a, b, c) ? 3 : near([[a, b], [b, c], [c, a]]);
      else if (d.type === "pitchfork" && c) {
        const f = pitchforkLines(a, b, c);
        dist = near([f.median, f.upper, f.lower, f.base]);
      } else if (d.type === "fibext" && c) {
        const ys = FIBEXT_LEVELS.map((lv) => this.y(fibExtPrice(d.points[0].price, d.points[1].price, d.points[2].price, lv))).filter((v) => v != null);
        const x2 = c.x + Math.max(Math.abs(b.x - a.x), 80);
        const inside = x >= c.x - 4 && x <= x2 + 4 && y >= Math.min(...ys) - 4 && y <= Math.max(...ys) + 4;
        dist = inside ? 3 : near([[a, b], [b, c]]);
      } else if (d.type === "hline") dist = Math.abs(y - a.y);
      else if (d.type === "hray")
        dist = x >= a.x - 4 ? Math.abs(y - a.y) : Infinity;
      else if (d.type === "vline") dist = Math.abs(x - a.x);
      else if (d.type === "text")
        dist =
          x >= a.x - 4 && x <= a.x + 120 && Math.abs(y - a.y) < 12
            ? 0
            : Infinity;
      else if (["rect", "fib", "measure", "long", "short", "pricerange", "daterange"].includes(d.type)) {
        const inside =
          x >= Math.min(a.x, b.x) - 4 &&
          x <= Math.max(a.x, b.x, a.x + 40) + 4 &&
          y >= Math.min(a.y, b.y) - 40 &&
          y <= Math.max(a.y, b.y) + 40;
        dist = inside ? 3 : Infinity;
      } else if (b) {
        const far = (p, q, both) => {
          const dx = q.x - p.x,
            dy = q.y - p.y,
            len = Math.hypot(dx, dy) || 1;
          return [
            both ? { x: p.x - (dx / len) * 1e5, y: p.y - (dy / len) * 1e5 } : p,
            { x: p.x + (dx / len) * 1e5, y: p.y + (dy / len) * 1e5 },
          ];
        };
        const [p, q] =
          d.type === "ray"
            ? far(a, b, false)
            : d.type === "extended"
              ? far(a, b, true)
              : [a, b];
        dist = segDist(p, q);
      }
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best;
  }
}
