#!/usr/bin/env node
// Build the release downloads the installers fetch: dist/openwick.tar.gz (macOS, Linux) and
// dist/openwick.zip (Windows), plus SHA256SUMS. They hold exactly the committed files (git
// archive), so your data folder, logs and anything uncommitted can never end up in a release.
//   node scripts/package.js            build from the last commit
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ID = "openwick";
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;

if (git("status", "--porcelain")) console.warn("Note: you have uncommitted changes. The release holds only the last commit.\n");
const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
for (const fmt of ["tar.gz", "zip"]) git("archive", `--format=${fmt}`, `--prefix=${ID}/`, "-o", path.join(dist, `${ID}.${fmt}`), "HEAD");

const sums = fs.readdirSync(dist).map((f) => {
  const h = crypto.createHash("sha256").update(fs.readFileSync(path.join(dist, f))).digest("hex");
  return `${h}  ${f}`;
});
fs.writeFileSync(path.join(dist, "SHA256SUMS"), sums.join("\n") + "\n");
const size = (f) => `${(fs.statSync(path.join(dist, f)).size / 1048576).toFixed(1)} MB`;
console.log(`OpenWick ${version} (commit ${git("rev-parse", "--short", "HEAD")})\n`);
for (const f of fs.readdirSync(dist)) console.log(`  dist/${f}${f === "SHA256SUMS" ? "" : `  ${size(f)}`}`);
