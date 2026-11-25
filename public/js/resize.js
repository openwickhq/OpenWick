// Drag handles for the bottom panel (height) and the side panel (width). Sizes are kept in localStorage.

export const LIMITS = {
  bottom: { min: 120, keepChart: 160, fallback: 320 },
  side: { min: 280, keepChart: 360, fallback: 340 },
  paper: { min: 300, keepChart: 420, fallback: 380 },
};

// Clamp a dragged size so the panel stays usable and the chart keeps at least `keepChart` px.
export function clampSize(size, available, { min, keepChart }) {
  const max = Math.max(min, available - keepChart);
  return Math.round(Math.min(max, Math.max(min, size)));
}

function load(key, fallback) {
  try { return Number(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}
function save(key, v) {
  try { localStorage.setItem(key, String(v)); } catch { /* storage off */ }
}

// axis "y": handle on the panel's top edge, dragging up makes it taller. axis "x": handle on the left
// edge, or on the right edge with edge "right" (a panel docked on the left).
export function makeResizable(panel, container, { axis, key, limits, onResize, edge }) {
  const dir = edge === "right" ? -1 : 1;
  const prop = axis === "y" ? "height" : "width";
  const avail = () => (axis === "y" ? container.clientHeight : container.clientWidth);
  const apply = (v) => { panel.style[prop] = `${clampSize(v, avail(), limits)}px`; };
  apply(load(key, limits.fallback));

  const handle = document.createElement("div");
  handle.className = `resize-handle resize-${axis}${edge === "right" ? " resize-right" : ""}`;
  handle.title = "Drag to resize, double-click to reset";
  panel.prepend(handle);

  handle.addEventListener("pointerdown", (e) => {
    if (panel.classList.contains("collapsed")) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const start = axis === "y" ? e.clientY : e.clientX,
      startSize = panel.getBoundingClientRect()[prop];
    document.body.classList.add(`resizing-${axis}`);
    const move = (ev) => {
      const now = axis === "y" ? ev.clientY : ev.clientX;
      apply(startSize + (start - now) * dir);
      onResize?.();
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      document.body.classList.remove(`resizing-${axis}`);
      save(key, parseFloat(panel.style[prop]));
      onResize?.();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
  handle.addEventListener("dblclick", () => {
    apply(limits.fallback);
    save(key, limits.fallback);
    onResize?.();
  });
  window.addEventListener("resize", () => apply(parseFloat(panel.style[prop]) || limits.fallback));
}
