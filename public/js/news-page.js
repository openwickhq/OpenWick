// News page: Indian market and crypto headlines, or headlines for one stock or coin.
import { api, esc } from "./api.js";
import { $, mountSite, ago } from "./site.js";

const qp = new URLSearchParams(location.search);
let topic = qp.get("symbol") ? null : qp.get("topic") === "crypto" ? "crypto" : "india";

async function show(symbol, label) {
  document.querySelectorAll("#topics button").forEach((b) => b.classList.toggle("active", b.dataset.t === symbol));
  $("#list").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  $("#newsNote").textContent = "";
  try {
    const r = await api.get(`/api/news?symbol=${encodeURIComponent(symbol)}`);
    $("#newsNote").textContent = label ? `${r.note || ""}` : r.note || "";
    const items = r.items || [];
    $("#list").innerHTML = items.length
      ? items.map((n, i) => `<a class="story ${i === 0 ? "lead" : ""}" href="${esc(n.url)}" target="_blank" rel="noopener">
          <span class="src">${esc(n.source || "")}${n.time ? ` · ${esc(ago(n.time))}` : ""}</span>
          <b>${esc(n.title)}</b>
          ${n.summary ? `<p>${esc(n.summary)}</p>` : ""}
        </a>`).join("")
      : '<div class="empty">No headlines right now.</div>';
  } catch (e) {
    $("#list").innerHTML = `<div class="empty">News isn't loading right now (${esc(e.message)}).</div>`;
  }
}

$("#topics").onclick = (e) => {
  const t = e.target.closest("[data-t]")?.dataset.t;
  if (!t) return;
  $("#forSym").value = "";
  history.replaceState(null, "", `/news?topic=${t}`);
  show(t);
};
$("#forSym").onkeydown = (e) => {
  const q = $("#forSym").value.trim();
  if (e.key !== "Enter" || !q) return;
  history.replaceState(null, "", `/news?symbol=${encodeURIComponent(q)}`);
  show(q, q);
};

await mountSite("news");
if (topic) show(topic);
else {
  $("#forSym").value = qp.get("symbol");
  show(qp.get("symbol"), qp.get("symbol"));
}
setInterval(() => {
  if (!$("#forSym").value) show(document.querySelector("#topics .active")?.dataset.t || "india");
}, 10 * 60e3);
