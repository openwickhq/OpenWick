#!/usr/bin/env node
// Before publishing: write your GitHub address into the installers and the README.
//   node scripts/set-repo.js your-name/openwick
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const slug = process.argv[2] || "";
if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(slug)) {
  console.error("Usage: node scripts/set-repo.js <github-user>/<repository>   e.g. asha-dev/openwick");
  process.exit(1);
}
let n = 0;
for (const f of ["install.sh", "install.ps1", "README.md", "electron/app.cjs"]) {
  const p = path.join(root, f);
  const s = fs.readFileSync(p, "utf8");
  const out = s.split("OWNER/openwick").join(slug);
  if (out !== s) {
    fs.writeFileSync(p, out);
    n += s.split("OWNER/openwick").length - 1;
    console.log(`  ${f}`);
  }
}
console.log(n ? `Set github.com/${slug} in ${n} places. Commit, push, then tag a release.` : "Nothing to change (already set?).");
