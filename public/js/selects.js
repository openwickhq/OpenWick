// Lets a long choice in a <select> end in "…" with the arrow still showing, instead of pushing the
// arrow out of the box. Browsers that style select lists like menus (Chromium 135+, so the desktop
// app too) show the chosen option through a <selectedcontent> inside a <button> in the select;
// this adds that pair to every select, including ones made later. The button takes no clicks or
// focus (the select still gets them), and options, value and selectedIndex are untouched.
// Other browsers keep their own select, so nothing is added there.
const supported = typeof CSS !== "undefined" && CSS.supports?.("appearance", "base-select");

function fit(sel) {
  if (sel.multiple || sel.size > 1) return;
  const first = sel.firstElementChild;
  if (first?.classList?.contains("sel-fit")) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "sel-fit";
  b.tabIndex = -1;
  b.setAttribute("aria-hidden", "true");
  b.appendChild(document.createElement("selectedcontent"));
  sel.prepend(b);
}

function fitAll(root) {
  if (root.nodeType !== 1) return;
  if (root.tagName === "SELECT") return fit(root);
  root.querySelectorAll?.("select").forEach(fit);
}

if (supported) {
  fitAll(document.body);
  // Selects added later, and selects whose options were rewritten (innerHTML drops the button).
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.target.tagName === "SELECT") fit(m.target);
      else m.addedNodes.forEach(fitAll);
    }
  }).observe(document.body, { childList: true, subtree: true });
}
