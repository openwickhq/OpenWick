// The first-run setup: on a new install, before anything else, OpenWick asks which markets the
// person follows and which one is home. That makes their first watchlists (country.js
// starterLists) and sets the market the home page, screener and calendar show. Saved in the data
// folder (/api/setup), so the desktop app and a browser on the same computer agree. It can be run
// again from Settings → General, which only adds lists, never replaces them.
import { api, esc } from "./api.js";
import { PICKS, countryCode, starterLists } from "./country.js";
import { shortName } from "../lib/markets.js";

const KEY = "ow.country";
// The exchanges under each name, short enough for the box.
const WHERE = { IN: "NSE · BSE", US: "NYSE · Nasdaq", GB: "London (LSE)", JP: "Tokyo (TSE)", DE: "Xetra · Frankfurt", HK: "HKEX" };

// Called first thing on every page. Shows the setup on a new install; on a browser (or the
// desktop app) that hasn't picked a market yet, uses the one saved on this computer.
export async function firstRun() {
  let s;
  try {
    s = await api.get("/api/setup");
  } catch {
    return; // an older server, or offline: the usual guess applies
  }
  if (!s) return;
  if (s.needed) {
    const choice = await openSetup();
    try {
      const lists = starterLists(choice);
      await api.put("/api/state", { watchlists: lists, activeWatchlist: Object.keys(lists)[0] });
      await api.post("/api/setup", choice);
    } catch {
      /* the defaults still apply */
    }
    return reloadAs(choice.home);
  }
  if (s.home && !localStorage.getItem(KEY) && s.home !== countryCode()) return reloadAs(s.home);
  if (s.home && !localStorage.getItem(KEY)) localStorage.setItem(KEY, s.home);
}

// Loads the page again for the chosen market. Never resolves, so nothing else on the page starts
// with the old choice in the meantime.
function reloadAs(home) {
  localStorage.setItem(KEY, home);
  location.reload();
  return new Promise(() => {});
}

// The setup screen. Resolves with { countries, home, crypto }, or null when cancelled (only
// offered when run again from Settings, with `current` holding the earlier choice).
export function openSetup({ again = false, current = null } = {}) {
  const guess = countryCode();
  const picked = new Set(current?.countries?.length ? current.countries : [guess]);
  let crypto = current?.crypto ?? true;
  let home = current?.home || guess;

  const wrap = document.createElement("div");
  wrap.className = `fr-wrap ${again ? "again" : ""}`;
  wrap.innerHTML = `<div class="fr" role="dialog" aria-modal="true" aria-labelledby="frTitle">
    <img class="fr-logo" src="/img/logo.svg" alt="" width="40" height="40" />
    <h2 id="frTitle">${again ? "Your markets" : "Welcome to OpenWick"}</h2>
    <p class="fr-sub">Which markets do you follow? Tick one or more.</p>
    <div class="fr-grid">
      ${PICKS.map((c) => `<label class="fr-opt"><input type="checkbox" value="${c.code}" ${picked.has(c.code) ? "checked" : ""}><span class="fr-box"></span><span class="fr-name">${esc(shortName(c))}</span><span class="fr-ex">${esc(WHERE[c.code] || "")}</span></label>`).join("")}
      <label class="fr-opt"><input type="checkbox" value="CRYPTO" ${crypto ? "checked" : ""}><span class="fr-box"></span><span class="fr-name">Crypto</span><span class="fr-ex">BTC, ETH and more</span></label>
    </div>
    <label class="fr-home"><span>Home market</span><select></select></label>
    <p class="fr-note"></p>
    <div class="fr-btns">${again ? '<button type="button" class="btn" data-r="cancel">Cancel</button>' : ""}<button type="button" class="btn primary" data-r="ok">${again ? "Add" : "Start"}</button></div>
  </div>`;
  document.body.append(wrap);
  const sel = wrap.querySelector("select");
  const note = wrap.querySelector(".fr-note");
  const ok = wrap.querySelector('[data-r="ok"]');

  const draw = () => {
    const ticked = PICKS.filter((c) => picked.has(c.code));
    const homes = ticked.length ? ticked : PICKS;
    if (!homes.some((c) => c.code === home)) home = homes[0].code;
    sel.innerHTML = homes.map((c) => `<option value="${c.code}" ${c.code === home ? "selected" : ""}>${esc(shortName(c))}</option>`).join("");
    const lists = Object.keys(starterLists({ countries: [...picked], home, crypto }, again ? current?.lists || {} : null));
    ok.disabled = !ticked.length && !crypto;
    if (again) ok.textContent = lists.length ? "Add" : "Save";
    note.textContent = ok.disabled
      ? "Tick at least one."
      : again
        ? lists.length ? `Adds ${lists.length === 1 ? "a watchlist" : "watchlists"}: ${lists.join(", ")}. Your lists stay as they are.` : "Those watchlists are already there; this only changes your home market."
        : `Your first ${lists.length === 1 ? "watchlist" : "watchlists"}: ${lists.join(", ")}, with the main indices and the five biggest stocks of each market. The home page, screener and calendar open on ${shortName(PICKS.find((c) => c.code === home))}. You can change all of it later.`;
  };
  draw();
  wrap.addEventListener("change", (e) => {
    if (e.target === sel) home = sel.value;
    else if (e.target.value === "CRYPTO") crypto = e.target.checked;
    else if (e.target.type === "checkbox") (e.target.checked ? picked.add(e.target.value) : picked.delete(e.target.value));
    draw();
  });
  ok.focus();

  return new Promise((resolve) => {
    const done = (v) => {
      wrap.remove();
      resolve(v);
    };
    wrap.querySelector(".fr-btns").onclick = (e) => {
      const r = e.target.closest("[data-r]")?.dataset.r;
      if (r === "cancel") done(null);
      if (r === "ok" && !ok.disabled) done({ countries: PICKS.filter((c) => picked.has(c.code)).map((c) => c.code), home, crypto });
    };
    wrap.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && again) done(null);
      if (e.key === "Enter" && e.target.tagName !== "SELECT" && !ok.disabled) ok.click();
    });
  });
}
