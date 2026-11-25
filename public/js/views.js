// Full-screen views of the chart's symbol, picked from the dropdown next to the symbol name in the
// top bar: Chart (the normal workspace), Financials, Seasonals, News and Technicals (rating meters).
import { renderNews, renderSeasonals, renderFinancials } from "./research.js";
import { drawTechnicals, TECH_TFS } from "./technicals-view.js";

const VIEWS = [
  ["chart", "Chart", '<path d="M4 19h16M7 15V9M11 15V6M15 15v-4M19 15V8"/>'],
  ["financials", "Financials", '<path d="M5 20V10M10 20V4M15 20v-7M20 20V8"/>'],
  ["seasonals", "Seasonals", '<path d="M3 15c3-6 5-6 8-2s5 4 10-4"/><path d="M3 20h18"/>'],
  ["news", "News", '<path d="M5 5h11v14H7a2 2 0 0 1-2-2zM16 9h3v8a2 2 0 0 1-2 2M8 9h5M8 12h5M8 15h3"/>'],
  ["technicals", "Technicals", '<path d="M4 17a8 8 0 0 1 16 0"/><path d="M12 17l4-5"/>'],
];
const $ = (s) => document.querySelector(s);

export function initViews(app, P) {
  const main = $(".main"),
    host = $("#fullView"),
    menu = $("#viewMenu"),
    dd = $("#viewDd");
  let current = "chart";
  let techTf = null;

  menu.innerHTML = '<div class="dd-title">View</div>' + VIEWS.map(([k, label, icon]) => `<button data-view="${k}"><svg viewBox="0 0 24 24">${icon}</svg><span>${label}</span></button>`).join("");
  $("#viewBtn").onclick = (e) => {
    e.stopPropagation();
    const r = $("#viewBtn").getBoundingClientRect();
    Object.assign(menu.style, { left: `${r.left}px`, top: `${r.bottom + 4}px` });
    menu.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === current));
    dd.classList.toggle("open");
  };
  menu.onclick = (e) => {
    const b = e.target.closest("[data-view]");
    if (!b) return;
    dd.classList.remove("open");
    setView(b.dataset.view);
  };
  document.addEventListener("click", () => dd.classList.remove("open"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && current !== "chart" && !document.querySelector(".modal:not(.hidden)")) setView("chart");
  });
  // A panel icon on the right rail brings the chart back (the side panels belong to it).
  $("#sideTabs").addEventListener("click", (e) => {
    if (current === "chart" || !e.target.closest("button")) return;
    e.stopPropagation();
    setView("chart");
  }, true);

  function setView(v) {
    if (!VIEWS.some(([k]) => k === v)) v = "chart";
    current = v;
    $("#viewLabel").textContent = VIEWS.find(([k]) => k === v)[1];
    $("#viewBtn").classList.toggle("on", v !== "chart");
    main.classList.toggle("view-on", v !== "chart");
    host.classList.toggle("hidden", v === "chart");
    host.dataset.view = v;
    if (v === "chart") {
      host.innerHTML = "";
      return;
    }
    draw();
  }

  function draw() {
    host.innerHTML = '<div class="fv-inner"></div>';
    const el = host.firstChild;
    if (current === "financials") renderFinancials(el, app);
    else if (current === "seasonals") renderSeasonals(el, app);
    else if (current === "news") renderNews(el, app);
    else if (current === "technicals") renderTechnicals(el);
  }

  // ---------- technicals ----------
  function renderTechnicals(el) {
    const chartTf = app.active?.cfg.tf;
    const sym = app.active?.cfg.symbol;
    drawTechnicals(el, sym, {
      tf: techTf || (TECH_TFS.includes(chartTf) ? chartTf : "1D"),
      onTf: (t) => (techTf = t),
      stale: () => app.active?.cfg.symbol !== sym,
    });
  }

  P.setView = setView;
  P.currentView = () => current;
  P.onViewSymbol = () => {
    if (current !== "chart") draw();
  };
}
