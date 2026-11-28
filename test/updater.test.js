// The desktop app's self-update (electron/updater.cjs): packages are checked and unpacked
// safely, the right version is started, and a broken or skipped one never is.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const up = require("../electron/updater.cjs");
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");

// A minimal ustar archive, like `git archive --prefix=openwick/` writes.
function tar(files) {
  const blocks = [];
  for (const [name, content] of Object.entries(files)) {
    const body = Buffer.from(content);
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, "utf8");
    h.write("0000644\0", 100);
    h.write("0000000\0", 108);
    h.write("0000000\0", 116);
    h.write(body.length.toString(8).padStart(11, "0") + "\0", 124);
    h.write("00000000000\0", 136);
    h.write("        ", 148);
    h.write("0", 156);
    h.write("ustar\0", 257);
    h.write("00", 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
const appFiles = (version, electron = 45) => ({
  "openwick/package.json": JSON.stringify({ name: "openwick", version, desktop: { electron } }),
  "openwick/server.js": "// server",
  "openwick/electron/app.cjs": "// app",
  "openwick/public/index.html": "<!doctype html>",
});
// A fake GitHub release serving the package and its checksum.
function release(version, files, { badSum = false } = {}) {
  const gz = zlib.gzipSync(tar(files));
  const sum = badSum ? "0".repeat(64) : crypto.createHash("sha256").update(gz).digest("hex");
  const served = { "https://x/pkg": gz, "https://x/sums": Buffer.from(`${sum}  openwick.tar.gz\nabc  openwick.zip\n`) };
  const fetch = async (u) => ({ ok: !!served[u], status: served[u] ? 200 : 404, arrayBuffer: async () => served[u] });
  return {
    rel: { tag_name: `v${version}`, html_url: "https://x/rel", assets: [{ name: "openwick.tar.gz", browser_download_url: "https://x/pkg" }, { name: "SHA256SUMS", browser_download_url: "https://x/sums" }] },
    fetch,
  };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ow-upd-"));
function installedApp(version) {
  const d = tmp();
  fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ version, desktop: { electron: 45 } }));
  return d;
}

test("updater: version order", () => {
  assert.ok(up.newer("0.3.1", "0.3.0"));
  assert.ok(up.newer("v0.10.0", "0.9.9"));
  assert.ok(!up.newer("0.3.0", "0.3.0"));
  assert.ok(!up.newer("0.2.9", "0.3.0"));
});

test("updater: unpacking never writes outside its folder", () => {
  const d = tmp();
  const n = up.untar(tar({ "openwick/ok.txt": "fine", "openwick/../../evil.txt": "no", "openwick/a/../../evil2.txt": "no" }), d, 1);
  assert.equal(n, 1);
  assert.equal(fs.readFileSync(path.join(d, "ok.txt"), "utf8"), "fine");
  assert.ok(!fs.existsSync(path.join(d, "..", "evil.txt")));
  assert.ok(!fs.existsSync(path.join(path.dirname(d), "evil2.txt")));
});

test("updater: download checks the checksum and the Electron version", async () => {
  const home = tmp();
  const good = release("0.3.1", appFiles("0.3.1"));
  const r = await up.download(home, good.rel, { electronMajor: 45, fetch: good.fetch });
  assert.equal(r.version, "0.3.1");
  assert.ok(up.ready(home, "0.3.1"));
  // A wrong checksum: rejected, nothing left behind.
  const bad = release("0.3.2", appFiles("0.3.2"), { badSum: true });
  await assert.rejects(up.download(home, bad.rel, { electronMajor: 45, fetch: bad.fetch }), (e) => e.reason === "checksum");
  assert.ok(!up.ready(home, "0.3.2"));
  // Built for a newer Electron: the installer is needed instead.
  const newer = release("0.4.0", appFiles("0.4.0", 46));
  await assert.rejects(up.download(home, newer.rel, { electronMajor: 45, fetch: newer.fetch }), (e) => e.reason === "needs-installer");
  assert.ok(!up.ready(home, "0.4.0"));
  // A release without an update package.
  await assert.rejects(up.download(home, { tag_name: "v0.4.1", assets: [] }, { electronMajor: 45, fetch: good.fetch }), (e) => e.reason === "no-package");
});

test("updater: start-up picks a working newer version, and falls back from a broken one", async () => {
  const home = tmp();
  const installed = installedApp("0.3.0");
  assert.equal(up.pickVersion(home, installed, 45), null, "nothing downloaded: the installed app");
  const a = release("0.3.1", appFiles("0.3.1"));
  await up.download(home, a.rel, { electronMajor: 45, fetch: a.fetch });
  const dir = up.pickVersion(home, installed, 45);
  assert.ok(dir && dir.endsWith("0.3.1"));
  up.confirm(home, "0.3.1");
  assert.ok(up.pickVersion(home, installed, 45)?.endsWith("0.3.1"), "confirmed: used again");
  up.confirm(home, "0.3.1");
  // 0.3.2 starts but never confirms (its window never opened): the next start goes back to 0.3.1.
  const b = release("0.3.2", appFiles("0.3.2"));
  await up.download(home, b.rel, { electronMajor: 45, fetch: b.fetch });
  assert.ok(up.pickVersion(home, installed, 45).endsWith("0.3.2"));
  assert.ok(up.pickVersion(home, installed, 45).endsWith("0.3.1"), "the broken one is set aside");
  // An older Electron than a download needs: the installed app.
  assert.equal(up.pickVersion(home, installed, 44), null);
});

test("updater: an installer run (upgrade or rollback) clears downloads; skip is remembered", async () => {
  const home = tmp();
  const a = release("0.3.1", appFiles("0.3.1"));
  await up.download(home, a.rel, { electronMajor: 45, fetch: a.fetch });
  assert.ok(up.pickVersion(home, installedApp("0.3.0"), 45));
  // Rolled back by installing 0.2.0: what was downloaded is cleared and the installer's version runs.
  assert.equal(up.pickVersion(home, installedApp("0.2.0"), 45), null);
  assert.equal(up.downloaded(home).length, 0);
  // Skip this version.
  const installed = installedApp("0.3.0");
  up.pickVersion(home, installed, 45);
  await up.download(home, a.rel, { electronMajor: 45, fetch: a.fetch });
  up.skip(home, "0.3.1");
  assert.ok(up.skipped(home, "0.3.1"));
  assert.equal(up.pickVersion(home, installed, 45), null);
});

test("updater: package.json's desktop.electron matches the Electron the installers are built with", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const yml = fs.readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8");
  const built = parseInt(/electronVersion:\s*(\d+)/.exec(yml)[1], 10);
  assert.equal(pkg.desktop.electron, built, "update package.json desktop.electron when Electron changes");
  assert.match(pkg.scripts.desktop, new RegExp(`electron@${built}\\.`));
});
