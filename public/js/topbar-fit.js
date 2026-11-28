// Keeps the chart page's top bar on one line at any window width, with no scrolling. When it
// doesn't fit, it folds in steps, least-used first, until it does: some labels become icons, then
// buttons move into the "More" (⋯) menu at the right end. Widening the window unfolds them again.
const STEPS = [
  { fold: ["#typeLabel", "#gridLabel"] },
  { fold: ["#alertBtn > span", "#replayBtn > span"] },
  { fold: ["#layoutName"] },
  { more: ["#fullBtn", "#snapBtn", "#csvBtn", "#themeBtn"] },
  { more: ["#syncLabel", "#tplBtn", "#compareBtn"] },
  { more: ["#undoBtn", "#redoBtn"] },
  { more: ["#replayBtn", "#alertBtn"] },
  { fold: ["#indicatorsBtn > span", "#viewBtn .caret"] },
  { fold: [":scope > .sep"], tight: true },
];
// What each button is called in the More menu.
const LABEL = {
  fullBtn: "Fullscreen", snapBtn: "Download chart image", csvBtn: "Export chart data (CSV)", themeBtn: "Light / dark theme",
  syncLabel: "Same symbol on every chart", tplBtn: "Chart templates", compareBtn: "Compare or add symbol",
  undoBtn: "Undo", redoBtn: "Redo", replayBtn: "Bar replay", alertBtn: "Create alert",
};
const SYNC_IC = '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
const KEYS = { undoBtn: "Ctrl+Z", redoBtn: "Ctrl+Y", alertBtn: "Alt+A" };

export function initTopbarFit() {
  const bar = document.querySelector(".topbar");
  const moreDd = document.querySelector("#moreDd"), moreBtn = document.querySelector("#moreBtn"), menu = document.querySelector("#moreMenu");
  if (!bar || !moreDd) return;
  const all = (sels) => sels.flatMap((s) => [...bar.querySelectorAll(s)]);

  const fits = () => bar.scrollWidth <= bar.clientWidth + 1;
  let busy = false;
  function fit() {
    if (busy) return;
    busy = true;
    for (const el of bar.querySelectorAll(".tb-fold, .tb-more")) el.classList.remove("tb-fold", "tb-more");
    bar.classList.remove("tight");
    moreDd.hidden = true;
    for (const step of STEPS) {
      if (fits()) break;
      for (const el of all(step.fold || [])) el.classList.add("tb-fold");
      for (const el of all(step.more || [])) el.classList.add("tb-more");
      if (step.more) moreDd.hidden = false;
      if (step.tight) bar.classList.add("tight");
    }
    if (moreDd.hidden) close();
    busy = false;
  }
  let raf = 0;
  const later = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(fit);
  };
  new ResizeObserver(later).observe(bar);
  // A longer symbol or layout name needs room too.
  new MutationObserver(later).observe(bar, { childList: true, characterData: true, subtree: true });
  document.fonts?.ready.then(later);
  fit();

  // ----- the More menu -----
  function draw() {
    menu.innerHTML = [...bar.querySelectorAll(".tb-more")].map((el) => {
      const id = el.id, ic = el.querySelector("svg")?.outerHTML || "";
      if (id === "syncLabel") {
        const on = el.querySelector("input").checked;
        return `<button role="menuitemcheckbox" aria-checked="${on}" data-for="${id}">${SYNC_IC}<span class="cm-l">${LABEL[id]}</span><span class="n">${on ? "On" : "Off"}</span></button>`;
      }
      return `<button role="menuitem" data-for="${id}" ${el.disabled ? "disabled" : ""}>${ic}<span class="cm-l">${LABEL[id] || el.title}</span><span class="n">${KEYS[id] || ""}</span></button>`;
    }).join("");
  }
  function open() {
    draw();
    moreDd.classList.add("open");
    moreBtn.setAttribute("aria-expanded", "true");
    const r = moreBtn.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${Math.max(6, r.right - menu.offsetWidth)}px`;
  }
  function close() {
    moreDd.classList.remove("open");
    moreBtn.setAttribute("aria-expanded", "false");
  }
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    moreDd.classList.contains("open") ? close() : open();
  });
  menu.addEventListener("click", (e) => {
    e.stopPropagation();
    const b = e.target.closest("[data-for]");
    if (!b || b.disabled) return;
    const el = document.getElementById(b.dataset.for);
    close();
    if (el.id === "syncLabel") {
      const box = el.querySelector("input");
      box.checked = !box.checked;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    } else el.click();
  });
  document.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && moreDd.classList.contains("open")) {
      close();
      moreBtn.focus();
    }
  });
}
