// Updates for the desktop app, without downloading the whole installer again.
//
// Each GitHub release has the app's own files as a small package (openwick.tar.gz, about 7 MB,
// with its SHA-256 in SHA256SUMS). The app downloads it, checks the checksum, and unpacks it into
// your user folder, under updates/v/<version>. The installed app is never changed (a Linux
// AppImage can't be, and a Mac app's signature covers its files), so this works the same on
// Windows, macOS and Linux. On the next start, electron/main.cjs runs the newest downloaded
// version that fits this copy's Electron; otherwise the installed one.
//
// Safe by design:
//   • A version that starts but never finishes opening its window is set aside, and the next
//     start uses the one before it.
//   • Installing a different installer (newer, or an older one to roll back) clears the downloads.
//   • A release that needs a newer Electron isn't downloaded: the app offers the installer instead.
//   • "Skip this version" is remembered until a newer one comes out.
// Plain Node, no Electron, so it can be tested on its own (test/updater.test.js).
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

const PACKAGE = "openwick.tar.gz";
const SUMS = "SHA256SUMS";
const KEEP = 2; // the version in use and the one before it

// ---------- versions ----------
const parts = (v) => String(v || "").replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
function newer(a, b) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}
const VERSION = /^\d+\.\d+\.\d+$/;

// ---------- where things are ----------
const dirs = (userData) => {
  const base = path.join(userData, "updates");
  return { base, versions: path.join(base, "v"), state: path.join(base, "state.json") };
};
const readJson = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; }
};
const writeJson = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(v, null, 1));
  fs.renameSync(`${f}.tmp`, f);
};
const readState = (userData) => ({ bad: [], ...readJson(dirs(userData).state, {}) });
const writeState = (userData, s) => writeJson(dirs(userData).state, s);
const pkgOf = (root) => readJson(path.join(root, "package.json"), null);
// Whether a package's files can run on this Electron (package.json "desktop.electron" is the
// major version it was built for).
const fits = (pkg, electronMajor) => !!pkg && Number(pkg.desktop?.electron || 0) <= electronMajor;
const complete = (root) => ["package.json", "server.js", "electron/app.cjs", "public/index.html"].every((f) => fs.existsSync(path.join(root, f)));

// The downloaded versions, newest first: [{ version, dir }].
function downloaded(userData) {
  const d = dirs(userData).versions;
  let names = [];
  try { names = fs.readdirSync(d); } catch { return []; }
  return names
    .filter((n) => VERSION.test(n))
    .map((n) => ({ version: n, dir: path.join(d, n) }))
    .sort((a, b) => (newer(a.version, b.version) ? -1 : newer(b.version, a.version) ? 1 : 0));
}
const remove = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* next time */ } };

// ---------- at start (electron/main.cjs) ----------
// Which app folder to run: a downloaded version, or null for the installed one.
function pickVersion(userData, installedRoot, electronMajor) {
  const installed = pkgOf(installedRoot)?.version || "0.0.0";
  let s = readState(userData);
  // Another installer was run since last time (an upgrade, or an older one to roll back): it wins.
  if (s.installed && s.installed !== installed) {
    for (const x of downloaded(userData)) remove(x.dir);
    s = { bad: [] };
  }
  s.installed = installed;
  // Started last time but never confirmed: it didn't get as far as opening its window.
  if (s.trying) {
    if (!s.bad.includes(s.trying)) s.bad.push(s.trying);
    s.trying = null;
  }
  const pick = downloaded(userData).find((x) => {
    if (!newer(x.version, installed) || s.bad.includes(x.version) || s.skip === x.version) return false;
    const p = pkgOf(x.dir);
    return p?.version === x.version && fits(p, electronMajor) && complete(x.dir);
  });
  s.trying = pick ? pick.version : null;
  try { writeState(userData, s); } catch { /* read-only: just run */ }
  return pick ? pick.dir : null;
}

// Called once the window has loaded: this version works. Kept: it, anything newer waiting for
// the next start, and one earlier version to fall back on. Deleted: the rest, failed ones, and
// any no newer than the installed app.
function confirm(userData, version) {
  const s = readState(userData);
  if (s.trying === version) s.trying = null;
  s.good = version;
  writeState(userData, s);
  let earlier = 0;
  for (const x of downloaded(userData)) {
    if (s.bad.includes(x.version) || !newer(x.version, s.installed || "0.0.0")) remove(x.dir);
    else if (x.version === version || newer(x.version, version)) continue;
    else if (earlier++ >= KEEP - 1) remove(x.dir);
  }
}

// "Skip this version": not used, and not offered again until a newer one.
function skip(userData, version) {
  const s = readState(userData);
  s.skip = version;
  writeState(userData, s);
  const x = downloaded(userData).find((d) => d.version === version);
  if (x) remove(x.dir);
}
const skipped = (userData, version) => readState(userData).skip === version;
// Already downloaded and ready for the next start.
const ready = (userData, version) => downloaded(userData).some((x) => x.version === version && complete(x.dir));

// ---------- tar (what `git archive` writes) ----------
function untar(buf, dest, strip = 1) {
  const root = path.resolve(dest);
  let off = 0, longName = null, pax = {}, files = 0;
  const text = (b) => b.toString("utf8").replace(/\0[\s\S]*$/, "");
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    let name = text(h.subarray(0, 100));
    const prefix = text(h.subarray(345, 500));
    if (prefix) name = `${prefix}/${name}`;
    const size = parseInt(text(h.subarray(124, 136)).trim() || "0", 8) || 0;
    const type = String.fromCharCode(h[156] || 48);
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === "g") continue; // git's commit id
    if (type === "x") {
      // "<len> path=<name>\n" records
      for (const line of body.toString("utf8").split("\n")) {
        const m = /^\d+ ([^=]+)=([\s\S]*)$/.exec(line);
        if (m) pax[m[1]] = m[2];
      }
      continue;
    }
    if (type === "L") { longName = text(body); continue; }
    if (pax.path) name = pax.path;
    if (longName) name = longName;
    pax = {};
    longName = null;
    const segs = name.split("/").filter(Boolean).slice(strip);
    if (!segs.length || segs.some((p) => p === ".." || p === "." || p.includes("\\"))) continue;
    const out = path.resolve(root, ...segs);
    if (!out.startsWith(root + path.sep)) continue; // never outside the folder
    if (type === "5") fs.mkdirSync(out, { recursive: true });
    else if (type === "0" || type === "7") {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, body);
      files++;
    }
    // Links and anything else are skipped: a release has plain files and folders.
  }
  return files;
}

// ---------- download ----------
// Finds the package for a GitHub release, checks it fits, downloads and unpacks it. Resolves with
// { version, dir }; rejects with err.reason "no-package" (offer the installer instead),
// "needs-installer" (a newer Electron) or a download or checksum problem.
async function download(userData, release, { electronMajor, fetch = globalThis.fetch, onProgress = () => {} } = {}) {
  const version = String(release.tag_name || "").replace(/^v/, "");
  const fail = (reason, msg) => Object.assign(new Error(msg), { reason });
  if (!VERSION.test(version)) throw fail("no-package", `Unexpected release name ${release.tag_name}`);
  const asset = (n) => (release.assets || []).find((a) => a.name === n);
  const pkgAsset = asset(PACKAGE), sumsAsset = asset(SUMS);
  if (!pkgAsset || !sumsAsset) throw fail("no-package", "This release has no update package");
  const get = async (u) => {
    const r = await fetch(u, { headers: { "User-Agent": "OpenWick-desktop" }, redirect: "follow" });
    if (!r.ok) throw fail("download", `Download failed (${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  };
  const sums = (await get(sumsAsset.browser_download_url)).toString("utf8");
  const want = sums.split("\n").map((l) => l.trim().split(/\s+/)).find(([, f]) => f === PACKAGE)?.[0];
  if (!/^[0-9a-f]{64}$/i.test(want || "")) throw fail("checksum", "The release's checksum list has no entry for the package");
  onProgress(0.1);
  const gz = await get(pkgAsset.browser_download_url);
  onProgress(0.8);
  const got = crypto.createHash("sha256").update(gz).digest("hex");
  if (got.toLowerCase() !== want.toLowerCase()) throw fail("checksum", "The download didn't match its checksum, so it wasn't used");
  const tar = zlib.gunzipSync(gz);
  const d = dirs(userData);
  const part = path.join(d.versions, `${version}.part`);
  const dir = path.join(d.versions, version);
  remove(part);
  fs.mkdirSync(part, { recursive: true });
  try {
    untar(tar, part, 1);
    const p = pkgOf(part);
    if (p?.version !== version || !complete(part)) throw fail("package", "The update package is incomplete");
    if (!fits(p, electronMajor)) throw fail("needs-installer", `OpenWick ${version} needs a newer desktop app`);
    remove(dir);
    fs.renameSync(part, dir);
  } catch (e) {
    remove(part);
    throw e;
  }
  onProgress(1);
  // A fresh download of a version that once failed gets another chance.
  const s = readState(userData);
  s.bad = s.bad.filter((v) => v !== version);
  writeState(userData, s);
  return { version, dir };
}

module.exports = { newer, pickVersion, confirm, skip, skipped, ready, download, untar, downloaded, PACKAGE, SUMS };
