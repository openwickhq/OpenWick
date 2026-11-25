// Condition builder shared by the strategy tester, alerts and the screener page's technical scan.
import { esc } from "./api.js";
import { INDICATORS, BY_ID } from "../lib/indicators.js";
import { OPS } from "../lib/backtest.js";

// ---------- operand picker (shared by tester, alerts, screener scans) ----------
export const PRICE = [
  "close",
  "open",
  "high",
  "low",
  "volume",
  "hl2",
  "hlc3",
  "ohlc4",
];
export const OP_LABEL = {
  ">": "is above",
  "<": "is below",
  ">=": "is at or above",
  "<=": "is at or below",
  crossesAbove: "crosses above",
  crossesBelow: "crosses below",
  crosses: "crosses",
};
export const outputsOf = (def) => [
  ...def.outputs.map((o) => o.key),
  ...(def.id === "supertrend" ? ["direction"] : []),
];
const mainInput = (def) =>
  (def.inputs || []).find((i) => i.type === "int" || i.type === "float");

function operandHtml(o) {
  const val =
    o.kind === "line"
      ? "l"
      : o.kind === "value"
        ? "v"
        : o.kind === "price"
          ? `p:${o.field}`
          : `i:${o.id}`;
  const opts = [
    o.kind === "line" ? `<option value="l" selected>${esc(o.label || "Drawn line")}</option>` : "",
    `<optgroup label="Price">${PRICE.map((f) => `<option value="p:${f}" ${val === `p:${f}` ? "selected" : ""}>${f === "close" ? "Price (close)" : f}</option>`).join("")}</optgroup>`,
    `<option value="v" ${val === "v" ? "selected" : ""}>Value</option>`,
    `<optgroup label="Indicators">${INDICATORS.filter((d) => d.outputs.length)
      .map(
        (d) =>
          `<option value="i:${esc(d.id)}" ${val === `i:${d.id}` ? "selected" : ""}>${esc(d.name)}</option>`,
      )
      .join("")}</optgroup>`,
  ].join("");
  let extra = "";
  if (o.kind === "value")
    extra = `<input class="num" data-v type="number" step="any" value="${o.v ?? 0}">`;
  if (o.kind === "ind") {
    const def = BY_ID[o.id];
    const mi = def && mainInput(def);
    if (mi)
      extra += `<input class="num" data-p="${mi.key}" type="number" step="any" title="${esc(mi.label)}" value="${o.params?.[mi.key] ?? mi.default}">`;
    const outs = def ? outputsOf(def) : [];
    if (outs.length > 1)
      extra += `<select data-out>${outs.map((k) => `<option ${k === o.output ? "selected" : ""}>${k}</option>`).join("")}</select>`;
  }
  const lineData = o.kind === "line" ? ` data-line="${esc(JSON.stringify(o.line))}" data-label="${esc(o.label || "Drawn line")}"` : "";
  return `<span class="operand"${lineData}><select data-kind>${opts}</select>${extra}</span>`;
}

function readOperand(span) {
  const k = span.querySelector("[data-kind]").value;
  if (k === "l") return { kind: "line", line: JSON.parse(span.dataset.line), label: span.dataset.label };
  if (k === "v")
    return {
      kind: "value",
      v: Number(span.querySelector("[data-v]")?.value || 0),
    };
  if (k.startsWith("p:")) return { kind: "price", field: k.slice(2) };
  const id = k.slice(2),
    def = BY_ID[id];
  const params = {};
  const p = span.querySelector("[data-p]");
  if (p) params[p.dataset.p] = Number(p.value);
  return {
    kind: "ind",
    id,
    params,
    output: span.querySelector("[data-out]")?.value || outputsOf(def)[0],
  };
}

export function ruleHtml(r) {
  return `<div class="rule">${operandHtml(r.left)}<select data-op>${OPS.map((o) => `<option value="${o}" ${o === r.op ? "selected" : ""}>${OP_LABEL[o]}</option>`).join("")}</select>${operandHtml(r.right)}<button class="x" title="Remove">&times;</button></div>`;
}

export function bindRules(container, onChange = () => {}) {
  container.addEventListener("change", (e) => {
    const span = e.target.closest(".operand");
    if (span && e.target.matches("[data-kind]")) {
      const k = e.target.value;
      const o =
        k === "v"
          ? { kind: "value", v: 0 }
          : k.startsWith("p:")
            ? { kind: "price", field: k.slice(2) }
            : {
                kind: "ind",
                id: k.slice(2),
                params: {},
                output: outputsOf(BY_ID[k.slice(2)])[0],
              };
      span.outerHTML = operandHtml(o);
    }
    onChange();
  });
  container.addEventListener("click", (e) => {
    if (e.target.matches(".rule .x")) {
      e.target.closest(".rule").remove();
      onChange();
    }
  });
}

export const readRules = (container) =>
  [...container.querySelectorAll(".rule")].map((r) => {
    const ops = r.querySelectorAll(".operand");
    return {
      left: readOperand(ops[0]),
      op: r.querySelector("[data-op]").value,
      right: readOperand(ops[1]),
    };
  });

export function compileRules(groups) {
  const indicators = {};
  const ref = (o) => {
    if (o.kind === "line") return { line: o.line };
    if (o.kind === "value") return Number(o.v);
    if (o.kind === "price") return o.field;
    const key = `${o.id}_${Object.values(o.params || {}).join("_")}`.replace(
      /[^a-z0-9_]/gi,
      "_",
    );
    indicators[key] = { id: o.id, params: o.params || {} };
    return `${key}.${o.output}`;
  };
  const out = { indicators };
  for (const [name, rules] of Object.entries(groups))
    out[name] = rules.map((r) => ({
      left: ref(r.left),
      op: r.op,
      right: ref(r.right),
    }));
  return out;
}

export function toOperand(x, indicators) {
  if (x && typeof x === "object" && x.line) return { kind: "line", line: x.line, label: "Drawn line" };
  if (typeof x === "number") return { kind: "value", v: x };
  if (PRICE.includes(x)) return { kind: "price", field: x };
  const [k, out] = String(x).split(".");
  const s = indicators[k];
  const def = BY_ID[s?.id];
  if (!def) return { kind: "value", v: 0 };
  return {
    kind: "ind",
    id: s.id,
    params: { ...(s.params || {}) },
    output: out || s.output || outputsOf(def)[0],
  };
}

export const defaultRule = () => ({
  left: { kind: "price", field: "close" },
  op: "crossesAbove",
  right: { kind: "ind", id: "ema", params: { length: 50 }, output: "value" },
});

