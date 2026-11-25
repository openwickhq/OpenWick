// Undo / redo for the charts. Each entry is a snapshot of what's on screen: the layout, every
// chart's symbol, interval, type, indicators and compared symbols, the drawings, and the chart
// settings. App.persist() records one after each change; Ctrl+Z and Ctrl+Y step through them.
// Watchlists, alerts, paper trades, templates and saved layouts are left out: undo is for the chart.

// Settings that are about the page around the chart rather than the chart itself.
export const UI_ONLY_SETTINGS = new Set(["theme", "wlClosed", "wlFlaggedOnly", "wlSort", "syncSymbol", "syncReplay"]);

export function chartSnapshot(state) {
  const settings = Object.fromEntries(
    Object.entries(state.settings || {}).filter(([k]) => !UI_ONLY_SETTINGS.has(k)),
  );
  return JSON.stringify({
    layout: state.layout,
    active: state.active ?? 0,
    panes: state.panes || [],
    drawings: state.drawings || {},
    settings,
  });
}

export class History {
  // Changes that land within `mergeMs` of each other (one action that saves twice) count as one step.
  constructor({ limit = 100, mergeMs = 350, now = () => Date.now() } = {}) {
    this.limit = limit;
    this.mergeMs = mergeMs;
    this.now = now;
    this.reset(null);
  }
  reset(snap) {
    this.undoStack = [];
    this.redoStack = [];
    this.current = snap;
    this.lastAt = 0;
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  // Returns true when this snapshot is a new step.
  record(snap) {
    if (this.current == null) {
      this.current = snap;
      return false;
    }
    if (snap === this.current) return false;
    const t = this.now();
    const merge = t - this.lastAt < this.mergeMs && this.undoStack.length > 0;
    this.lastAt = t;
    this.redoStack = [];
    if (!merge) {
      this.undoStack.push(this.current);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.current = snap;
    return !merge;
  }
  undo() {
    if (!this.canUndo) return null;
    this.redoStack.push(this.current);
    this.current = this.undoStack.pop();
    this.lastAt = 0;
    return this.current;
  }
  redo() {
    if (!this.canRedo) return null;
    this.undoStack.push(this.current);
    this.current = this.redoStack.pop();
    this.lastAt = 0;
    return this.current;
  }
}
