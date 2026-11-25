// Reads a holdings file in the browser (nothing is uploaded anywhere):
//   • Kite holdings download (CSV): Instrument, Qty., Avg. cost, LTP, …
//   • Console holdings (XLSX or CSV): Symbol, ISIN, Sector, Quantity Available, …, Average Price, …
//   • Console tradebook (CSV or XLSX): symbol, trade_date, trade_type, quantity, price, … — holdings
//     are worked out from the trades (average cost), with realised profit on sales
//   • any sheet with a symbol, quantity and average price column
// No DOM use, so it also runs under Node for the tests.

// ---------- CSV ----------
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim()));
}

// ---------- XLSX (zip of XML files) ----------
async function inflate(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}
async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("This isn't a valid Excel (.xlsx) file.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    files[name] = { method, data: u8.subarray(start, start + size) };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d)).replace(/&amp;/g, "&");
const colIndex = (ref) => [...ref.replace(/\d+/g, "")].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export async function parseXlsx(buf) {
  const files = await unzip(buf);
  const text = async (name) => {
    const f = files[name];
    if (!f) return "";
    return new TextDecoder().decode(f.method === 8 ? await inflate(f.data) : f.data);
  };
  const strings = [...(await text("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const sheet = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)))[0];
  if (!sheet) throw new Error("No worksheet in this Excel file.");
  const rows = [];
  for (const m of (await text(sheet)).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of m[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], inner = c[2] || "";
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const t = /t="([^"]+)"/.exec(attrs)?.[1];
      let v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "";
      if (t === "s") v = strings[Number(v)] ?? "";
      else if (t === "inlineStr") v = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("");
      v = unxml(String(v));
      row[ref ? colIndex(ref) : row.length] = v;
    }
    rows.push(Array.from(row, (x) => x ?? ""));
  }
  return rows.filter((r) => r.some((x) => String(x).trim()));
}

// ---------- rows -> holdings ----------
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
// NSE symbol from Kite/Console names: "RELIANCE", "RELIANCE-BE", "NSE:TCS".
const cleanSym = (s) => String(s || "").trim().toUpperCase().replace(/^(NSE|BSE):/, "").replace(/-(EQ|BE|BZ|SM|ST)$/, "");

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const h = rows[i].map(norm);
    const sym = h.findIndex((x) => ["symbol", "instrument", "tradingsymbol", "trading symbol", "stock", "scrip", "stock name"].includes(x));
    const qty = h.findIndex((x) => /^(qty|quantity|quantity available|net qty|shares)$/.test(x));
    if (sym >= 0 && qty >= 0) return { i, h };
  }
  return null;
}

export function rowsToHoldings(rows) {
  const found = findHeader(rows);
  if (!found) throw new Error("Couldn't find a symbol and quantity column. Use Kite's holdings download, Console's holdings or tradebook, or a sheet with Symbol, Quantity and Average price columns.");
  const { i, h } = found;
  const col = (...names) => h.findIndex((x) => names.includes(x));
  const body = rows.slice(i + 1);
  const cSym = col("symbol", "instrument", "tradingsymbol", "trading symbol", "stock", "scrip", "stock name");
  const cType = col("trade type", "trade_type", "type", "buy sell", "side");
  // Tradebook: work out holdings from the trades.
  if (cType >= 0 && col("price", "trade price") >= 0) {
    const cQty = col("quantity", "qty"), cPx = col("price", "trade price");
    const cDate = col("trade date", "date"), cTime = col("order execution time", "execution time", "time");
    const cSeg = col("segment");
    const trades = body
      .filter((r) => r[cSym] && (cSeg < 0 || !r[cSeg] || /^eq$/i.test(String(r[cSeg]).trim())))
      .map((r, k) => ({ s: cleanSym(r[cSym]), buy: /^b/i.test(String(r[cType]).trim()), q: num(r[cQty]), p: num(r[cPx]), t: `${r[cDate] || ""} ${r[cTime] || ""}`, k }))
      .filter((t) => t.q > 0)
      .sort((a, b) => a.t.localeCompare(b.t) || a.k - b.k);
    const pos = {};
    let realised = 0, oversold = 0;
    for (const t of trades) {
      const x = (pos[t.s] ||= { qty: 0, cost: 0 });
      if (t.buy) { x.qty += t.q; x.cost += t.q * t.p; }
      else {
        const sell = Math.min(t.q, x.qty);
        if (sell < t.q) oversold++;
        const avg = x.qty ? x.cost / x.qty : 0;
        realised += (t.p - avg) * sell;
        x.qty -= sell;
        x.cost -= avg * sell;
      }
    }
    const holdings = Object.entries(pos).filter(([, x]) => x.qty > 0.0001).map(([symbol, x]) => ({ symbol, qty: +x.qty.toFixed(4), avg: x.cost / x.qty }));
    const notes = [`Worked out from ${trades.length} trades (average cost). Only trades in this file count, so download the tradebook from your first trade for a full picture.`];
    if (oversold) notes.push(`${oversold} sale${oversold === 1 ? "" : "s"} had no matching purchase in the file and ${oversold === 1 ? "was" : "were"} left out of realised profit.`);
    return { kind: "tradebook", holdings, realised, notes };
  }
  // Holdings: one row per stock.
  const cAvail = col("quantity available"), cQty = col("qty", "quantity", "net qty", "shares");
  const extraQty = ["quantity discrepant", "quantity pledged margin", "quantity pledged loan"].map((n) => col(n)).filter((x) => x >= 0);
  const cAvg = col("avg cost", "average price", "avg price", "average cost", "buy price", "avg", "buy avg");
  const cSector = col("sector", "industry");
  const holdings = [];
  for (const r of body) {
    const symbol = cleanSym(r[cSym]);
    if (!symbol || /^total/i.test(symbol)) continue;
    const qty = cAvail >= 0 ? num(r[cAvail]) + extraQty.reduce((a, c) => a + num(r[c]), 0) : num(r[cQty]);
    if (!(qty > 0)) continue;
    holdings.push({ symbol, qty, avg: cAvg >= 0 ? num(r[cAvg]) : 0, ...(cSector >= 0 && r[cSector] ? { sector: String(r[cSector]).trim() } : {}) });
  }
  const notes = cAvg < 0 ? ["No average price column, so profit and loss can't be worked out."] : [];
  return { kind: "holdings", holdings, realised: 0, notes };
}

// A File (or {name, arrayBuffer()}) -> { kind, holdings, realised, notes }
export async function readHoldingsFile(file) {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 4));
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (/\.xls$/i.test(file.name) && !isZip) throw new Error("Old .xls files aren't supported. Download CSV or .xlsx instead.");
  const rows = isZip ? await parseXlsx(buf) : parseCsv(new TextDecoder().decode(buf).replace(/^﻿/, ""));
  return rowsToHoldings(rows);
}
