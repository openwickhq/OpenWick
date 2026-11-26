// The Notes page: every note, with the list on the left and the open note on the right. Same notes
// as the chart page's Notes tab (see notes.js). Prices for the notes' symbols come from quotes,
// refreshed every minute, for the "since written", upside and R:R figures.
import { api } from "./api.js";
import { $, mountSite, chartUrl } from "./site.js";
import { notesView } from "./notes.js";

await mountSite("notes");

const prices = {};
const stand = { active: null, prices, setSymbol: (s) => (location.href = chartUrl(s)) };
let all = [];
async function loadPrices(syms) {
  syms = [...new Set(syms.filter(Boolean))].slice(0, 600);
  if (!syms.length) return;
  try {
    const q = await api.quotes(syms);
    for (const [s, v] of Object.entries(q)) if (v?.price != null) prices[s] = v.price;
    view.refresh();
  } catch { /* figures that need a price stay hidden */ }
}
const view = notesView({
  listEl: $("#ntList"),
  editEl: $("#ntEdit"),
  app: stand,
  // Called with all notes when they load, and with a symbol just picked for a note.
  onPick(notes, sym, done) {
    all = notes;
    $("#ntCount").textContent = notes.length ? `${notes.length} note${notes.length === 1 ? "" : "s"}` : "";
    if (!sym) return loadPrices(notes.map((n) => n.symbol));
    loadPrices([sym]).then(() => done?.(prices[sym]));
  },
});
$("#ntNewTop").onclick = () => view.newNote();
$("#ntExportAll").onclick = () => view.exportAll();
await view.render();
setInterval(() => !document.hidden && loadPrices(all.map((n) => n.symbol)), 60e3);
