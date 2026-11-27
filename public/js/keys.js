// Keyboard: what you type for an interval, and the list of shortcuts shown with "?".

// What you type in the interval box ("15", "4h", "1D", "2w", "D", "30s") as an interval the
// chart understands, or null. A bare number is minutes, and whole hours become hours (60 → 1h,
// 240 → 4h), as on other charting apps. Lower-case m is minutes and capital M is months.
export function parseIntervalInput(raw) {
  const t = String(raw || "").replace(/\s+/g, "");
  const m = /^(\d*)([smhHdDwWM]?)$/.exec(t);
  if (!m || (!m[1] && !m[2])) return null;
  const n = m[1] ? Number(m[1]) : 1;
  if (!Number.isInteger(n) || n < 1 || n > 9999) return null;
  const unit = { "": "m", s: "s", m: "m", h: "h", H: "h", d: "D", D: "D", w: "W", W: "W", M: "M" }[m[2]];
  if (unit === "m" && n >= 60 && n % 60 === 0) return `${n / 60}h`;
  return `${n}${unit}`;
}

// [keys, what they do] in sections, for the shortcuts list.
export function shortcutSections(drawKeys, toolLabel) {
  return [
    {
      title: "Chart",
      rows: [
        ["Type a name", "Symbol search"],
        ["Type a number or ,", "Change interval: 15, 4h, 1D, 2W…"],
        ["Ctrl + Z", "Undo"],
        ["Ctrl + Y  /  Ctrl + Shift + Z", "Redo"],
        ["Ctrl + S", "Save layout"],
        ["Alt + R", "Reset chart view"],
        ["Alt + A", "Add an alert (on the selected line, if any)"],
        ["/", "Add an indicator"],
        ["Alt + Shift + S", "Save a chart image"],
        ["Right-click the chart", "Chart menu: price actions, drawings, indicators, image, settings"],
        ["Esc", "Close a dialog, stop drawing or deselect"],
        ["?", "This list"],
      ],
    },
    {
      title: "Drawing",
      rows: [
        ...Object.entries(drawKeys).map(([code, tool]) => [`Alt + ${code.replace(/^Key/, "")}`, toolLabel(tool)]),
        ["Delete  /  Backspace", "Remove the selected drawing"],
        ["Ctrl + D", "Clone the selected drawing"],
        ["Ctrl + C  /  Ctrl + V", "Copy the selected drawing, paste it on any chart"],
        ["Arrow keys", "Move the selected drawing (Shift: 10 pixels)"],
        ["Alt + Shift + H", "Hide or show all drawings"],
        ["Alt + Shift + L", "Lock or unlock all drawings"],
        ["Right-click while drawing", "Cancel the tool"],
        ["Shift while drawing", "Lock the line to 45° steps"],
        ["Ctrl while drawing", "Snap to the candle's open, high, low or close"],
        ["Right-click a tool group", "Every tool in the group"],
      ],
    },
    {
      title: "Other pages",
      rows: [["Ctrl + K", "Search (home, screener, news and other pages)"]],
    },
  ];
}
