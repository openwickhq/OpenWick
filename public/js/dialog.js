// In-app dialogs in place of the browser's alert / confirm / prompt (which show "localhost says"
// and look out of place). Each returns a promise:
//   await notice("Saved.")                                   -> undefined
//   await ask("Delete this note?", { ok: "Delete", danger }) -> true / false
//   await askText("Name for the new list:", "Main")          -> the text, or null if cancelled
// Enter confirms, Escape or a click outside cancels, focus goes to the field or the main button and
// comes back to where it was afterwards. Only one shows at a time; a newer one replaces an older one.
import { esc } from "./api.js";

let current = null;

function open({ title, message, field, ok = "OK", cancel = "Cancel", danger = false, hideCancel = false }) {
  current?.close(undefined);
  const before = document.activeElement;
  const wrap = document.createElement("div");
  wrap.className = "ow-dlg-wrap";
  wrap.innerHTML = `<div class="ow-dlg" role="dialog" aria-modal="true" aria-labelledby="owDlgMsg">
    ${title ? `<div class="ow-dlg-title">${esc(title)}</div>` : ""}
    <div class="ow-dlg-msg" id="owDlgMsg">${esc(message)}</div>
    ${field ? `<input class="ow-dlg-in" type="text" maxlength="${field.max || 200}" placeholder="${esc(field.placeholder || "")}" value="${esc(field.value ?? "")}" spellcheck="false" />` : ""}
    <div class="ow-dlg-btns">
      ${hideCancel ? "" : `<button type="button" class="ow-dlg-btn" data-r="cancel">${esc(cancel)}</button>`}
      <button type="button" class="ow-dlg-btn main ${danger ? "danger" : ""}" data-r="ok">${esc(ok)}</button>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  const input = wrap.querySelector(".ow-dlg-in");
  return new Promise((resolve) => {
    const close = (value) => {
      if (current?.wrap !== wrap) return;
      current = null;
      wrap.classList.add("out");
      setTimeout(() => wrap.remove(), 120);
      document.removeEventListener("keydown", onKey, true);
      if (before?.focus && document.contains(before)) before.focus({ preventScroll: true });
      resolve(value);
    };
    const done = (yes) => close(field ? (yes ? input.value : null) : !!yes);
    const onKey = (e) => {
      if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), done(false));
      else if (e.key === "Enter" && !e.isComposing) (e.preventDefault(), e.stopPropagation(), done(true));
      else if (e.key === "Tab") {
        // Keep Tab inside the dialog.
        const els = [...wrap.querySelectorAll("input, button")];
        const i = els.indexOf(document.activeElement);
        e.preventDefault();
        els[(i + (e.shiftKey ? -1 : 1) + els.length) % els.length].focus();
      } else e.stopPropagation(); // typing in the field mustn't reach the chart's shortcuts
    };
    document.addEventListener("keydown", onKey, true);
    wrap.addEventListener("mousedown", (e) => e.target === wrap && done(false));
    wrap.querySelector(".ow-dlg-btns").onclick = (e) => {
      const r = e.target.closest("[data-r]")?.dataset.r;
      if (r) done(r === "ok");
    };
    current = { wrap, close };
    requestAnimationFrame(() => {
      if (input) (input.focus(), input.select());
      else wrap.querySelector('[data-r="ok"]').focus();
    });
  });
}

export const notice = (message, opts = {}) => open({ message, ok: "OK", hideCancel: true, ...opts }).then(() => undefined);
export const ask = (message, opts = {}) => open({ message, ok: "OK", ...opts });
export const askText = (message, value = "", opts = {}) => open({ ok: "Save", ...opts, message, field: { ...(opts.field || {}), value } });
