// Where the symbol and company lists live. They ship in lib/universe. An installed desktop app
// can't write there, so it sets OW_LISTS_DIR and the background refresh saves its copies in that
// folder instead. Reading picks whichever copy is newer, so an app update that ships fresher
// lists still wins over an older refresh.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BUNDLED = path.join(path.dirname(fileURLToPath(import.meta.url)), "universe");
export const LISTS_OUT = process.env.OW_LISTS_DIR || BUNDLED;

const stamp = (file) => {
  try {
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    return [d.updated, d.sharesUpdated, d.sizesUpdated].filter(Boolean).sort().pop() || "";
  } catch {
    return null;
  }
};
export function listPath(name) {
  const own = path.join(LISTS_OUT, name), shipped = path.join(BUNDLED, name);
  if (own === shipped) return shipped;
  const a = stamp(own);
  if (a === null) return shipped;
  const b = stamp(shipped);
  return b !== null && b > a ? shipped : own;
}
