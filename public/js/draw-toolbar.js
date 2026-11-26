// The small toolbar that floats above a selected drawing: colour, line thickness, line style,
// edit text (notes), alert (lines), lock, clone and delete. One per chart; it follows the drawing
// as the chart scrolls and hides while a drawing is being made or dragged.
import { colorOf, DASHES } from "./drawings.js";
import { askText } from "./dialog.js";

const PALETTE = [
  "#f23645", "#ff9800", "#ffeb3b", "#4caf50", "#089981", "#00bcd4", "#2962ff", "#7c5cff", "#9c27b0", "#e91e63",
  "#ffffff", "#d1d1d1", "#9e9e9e", "#787b86", "#5d606b", "#434651", "#2a2e39", "#1e1e1e", "#000000", "#8d6e63",
];
const WIDTHS = [1, 2, 3, 4];
const STYLES = [
  ["solid", "Solid"],
  ["dashed", "Dashed"],
  ["dotted", "Dotted"],
];
const LINE_TYPES = new Set(["trend", "ray", "extended", "hline", "hray", "channel", "arrow", "crossline"]);
const NO_STROKE = new Set(["text", "arrowup", "arrowdown"]);

const svg = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
const ICONS = {
  text: svg('<path d="M5 6h14M12 6v13"/>'),
  alert: svg('<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20h4"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  unlock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>'),
  clone: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  del: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
};
const lineIcon = (w, dash) =>
  `<svg viewBox="0 0 24 24" class="dtb-line"><path d="M3 12h18" style="stroke-width:${w}" stroke-dasharray="${(DASHES[dash] || []).map((v) => v * 1.3).join(" ")}" stroke-linecap="butt"/></svg>`;

export class DrawToolbar {
  constructor(pane) {
    this.pane = pane;
    this.el = document.createElement("div");
    this.el.className = "dtb hidden";
    this.bar = document.createElement("div");
    this.bar.className = "dtb-bar";
    this.el.appendChild(this.bar);
    pane.el.appendChild(this.el);
    this.item = null;
    this.key = "";
    // Clicks on the toolbar stay off the chart underneath.
    for (const ev of ["mousedown", "click", "dblclick", "wheel"]) this.el.addEventListener(ev, (e) => e.stopPropagation());
    this.el.addEventListener("click", (e) => this.onClick(e));
    pane.drawings.onDraw = () => this.place();
  }

  hide() {
    this.el.classList.add("hidden");
    this.closePop();
    this.item = null;
    this.key = "";
  }

  // Called after every repaint of the drawings: show, refresh and move the toolbar as needed.
  place() {
    const p = this.pane,
      d = p.drawings.selected;
    if (!d || d.hidden || p.drawings.temp || p.dragging || p.app.tool !== "cursor" || !p.drawings.items.includes(d)) return this.hide();
    const box = p.drawings.boxOf(d);
    if (!box) return this.hide();
    const key = `${d.id}|${colorOf(d)}|${d.width || ""}|${d.dash || ""}|${d.locked ? 1 : 0}`;
    if (key !== this.key || this.item !== d) {
      this.item = d;
      this.key = key;
      this.render(d);
    }
    this.el.classList.remove("hidden");
    const chartW = p.chart.timeScale().width();
    const chartH = p.chart.panes()[0].getHeight();
    const w = this.el.offsetWidth,
      h = this.el.offsetHeight;
    const cx = Math.max(0, Math.min(chartW, (box.left + box.right) / 2));
    let top = Math.max(box.top, 0) - h - 14;
    if (top < 6) top = Math.min(chartH - h - 6, Math.min(box.bottom, chartH) + 14);
    const left = Math.max(6, Math.min(chartW - w - 6, cx - w / 2));
    this.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(6, top))}px)`;
  }

  render(d) {
    const stroke = !NO_STROKE.has(d.type);
    const btn = (act, inner, title, cls = "") => `<button data-act="${act}" class="${cls}" title="${title}">${inner}</button>`;
    this.bar.innerHTML =
      btn("color", `<span class="dtb-swatch" style="background:${colorOf(d)}"></span>`, "Colour") +
      (stroke ? btn("width", lineIcon(d.width || 1.5, "solid"), "Line thickness") + btn("dash", lineIcon(2, d.dash || "solid"), "Line style") : "") +
      (d.type === "text" ? btn("text", ICONS.text, "Edit text") : "") +
      (LINE_TYPES.has(d.type) ? btn("alert", ICONS.alert, "Add alert on this line") : "") +
      '<span class="dtb-sep"></span>' +
      btn("lock", d.locked ? ICONS.lock : ICONS.unlock, d.locked ? "Unlock (allow moving)" : "Lock (stop it moving)", d.locked ? "on" : "") +
      btn("clone", ICONS.clone, "Clone") +
      btn("delete", ICONS.del, "Remove (Delete key)");
  }

  save() {
    const p = this.pane;
    p.app.saveDrawings(p.cfg.symbol, p.drawings.items);
    p.drawings.update();
  }

  async onClick(e) {
    const b = e.target.closest("[data-act],[data-set]");
    const d = this.item;
    if (!b || !d) return;
    const p = this.pane;
    if (b.dataset.set) {
      const [k, v] = b.dataset.set.split(":");
      if (k === "color") d.color = v;
      if (k === "width") d.width = Number(v);
      if (k === "dash") d.dash = v === "solid" ? undefined : v;
      this.closePop();
      return this.save();
    }
    const act = b.dataset.act;
    if (["color", "width", "dash"].includes(act)) return this.togglePop(act, b);
    this.closePop();
    if (act === "text") {
      const t = await askText("Note text:", d.text || "", { ok: "Done" });
      if (t != null && t.trim()) {
        d.text = t.trim();
        this.save();
      }
    }
    if (act === "alert") p.app.alertOnSelectedDrawing();
    if (act === "lock") {
      d.locked = !d.locked;
      this.save();
    }
    if (act === "clone") {
      const copy = structuredClone(d);
      copy.id = Math.random().toString(36).slice(2, 10);
      delete copy.locked;
      copy.points = d.points.map((pt) => p.shiftPoint(pt, 24, 24));
      p.drawings.items.push(copy);
      p.drawings.selected = copy;
      this.save();
    }
    if (act === "delete") p.deleteSelectedDrawing();
  }

  togglePop(kind, anchor) {
    if (this.pop?.dataset.kind === kind) return this.closePop();
    this.closePop();
    const d = this.item;
    const pop = document.createElement("div");
    pop.className = "dtb-pop";
    pop.dataset.kind = kind;
    if (kind === "color")
      pop.innerHTML =
        `<div class="dtb-pal">${PALETTE.map((c) => `<button data-set="color:${c}" class="${c === colorOf(d) ? "on" : ""}" style="background:${c}" title="${c}"></button>`).join("")}</div>` +
        `<label class="dtb-custom">Custom <input type="color" value="${/^#[0-9a-f]{6}$/i.test(colorOf(d)) ? colorOf(d) : "#7c5cff"}" /></label>`;
    if (kind === "width")
      pop.innerHTML = WIDTHS.map((w) => `<button data-set="width:${w}" class="row ${Math.round(d.width || 1.5) === w ? "on" : ""}">${lineIcon(w, "solid")}<span>${w}px</span></button>`).join("");
    if (kind === "dash")
      pop.innerHTML = STYLES.map(([v, l]) => `<button data-set="dash:${v}" class="row ${(d.dash || "solid") === v ? "on" : ""}">${lineIcon(2, v)}<span>${l}</span></button>`).join("");
    this.el.appendChild(pop);
    pop.style.left = `${anchor.offsetLeft}px`;
    const input = pop.querySelector('input[type="color"]');
    if (input)
      input.oninput = (e) => {
        d.color = e.target.value;
        this.save();
      };
    this.pop = pop;
    this.offPop = (ev) => {
      if (!this.el.contains(ev.target)) this.closePop();
    };
    setTimeout(() => document.addEventListener("mousedown", this.offPop), 0);
  }

  closePop() {
    this.pop?.remove();
    this.pop = null;
    if (this.offPop) document.removeEventListener("mousedown", this.offPop);
    this.offPop = null;
  }
}
