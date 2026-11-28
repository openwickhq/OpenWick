// OpenWick desktop app. A thin window around the same local server the browser version uses:
// it starts server.js with Electron's built-in Node, waits for it, and shows the app in a window.
//
// Your data is kept in your user folder (not in the install folder, which can be read-only),
// the same folder the one-command install uses, so both see the same charts (lib/user-dirs.js):
//   Windows  %APPDATA%\OpenWick      macOS  ~/Library/Application Support/OpenWick
//   Linux    ~/.config/OpenWick
// If OpenWick is already running on that folder (started with the `openwick` command), the
// window uses that server instead of starting a second one that would overwrite its saves.
// Run it from a source copy with `npm run desktop`.
//
// electron/main.cjs starts this file: from the install folder, or from a newer version the app
// downloaded by itself (electron/updater.cjs), in which case ROOT below is that version's folder.
const { app, BrowserWindow, Menu, dialog, shell, nativeTheme, ipcMain, screen } = require("electron");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const pkg = require(path.join(ROOT, "package.json"));
const updater = require("./updater.cjs");
// Where downloaded versions are kept, and whether this copy may update itself (an installed app;
// OW_TEST_UPDATES=1 lets a source copy try it).
const UPDATES_HOME = (app.setName("OpenWick"), app.getPath("userData"));
const SELF_UPDATE = app.isPackaged || process.env.OW_TEST_UPDATES === "1";
const RUNNING_DOWNLOADED = !!process.env.OW_INSTALLED_ROOT && path.resolve(process.env.OW_INSTALLED_ROOT) !== path.resolve(ROOT);
const { autoScale, SIZES } = require("./scale.cjs");
const REPO = "openwickhq/OpenWick"; // set by scripts/set-repo.js when publishing
const CREATOR = "Sourav Chakraborty";
const PORT = 3787; // its own port, so it doesn't clash with a copy started from the terminal

app.setName("OpenWick");
if (process.platform === "win32") app.setAppUserModelId("app.openwick.desktop");

// One copy at a time: opening it again brings the running window forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null, server = null, url = null, quitting = false;
  let user = app.getPath("userData");
  let dirs = { OW_DATA_DIR: path.join(user, "data") };
  const logFile = () => path.join(dirs.OW_DATA_DIR, "desktop.log");
  const log = (m) => {
    try { fs.appendFileSync(logFile(), `${new Date().toISOString()} ${m}\n`); } catch { /* not fatal */ }
  };

  // The shared folders, made on first run (the example indicators are copied in once).
  async function firstRun() {
    const ud = await import(pathToFileURL(path.join(ROOT, "lib", "user-dirs.js")).href);
    user = ud.sharedDir();
    dirs = ud.prepareShared(ROOT).env;
  }

  const same = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  // An OpenWick server already running on the same data folder, if there is one.
  async function findRunning() {
    for (let p = 3777; p <= 3797; p++) {
      try {
        const r = await fetch(`http://127.0.0.1:${p}/api/health`, { signal: AbortSignal.timeout(500) });
        const h = await r.json();
        if (h.app === "openwick" && same(h.data, dirs.OW_DATA_DIR)) return `http://127.0.0.1:${p}`;
      } catch { /* not here */ }
    }
    return null;
  }
  // When borrowing another server, keep an eye on it: if it's stopped, start our own and reload.
  function watchBorrowed() {
    const t = setInterval(async () => {
      try {
        await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
      } catch {
        clearInterval(t);
        log(`the server at ${url} went away; starting our own`);
        url = null;
        try {
          await startServer();
          if (win) win.loadURL(`${url}/`);
        } catch (e) {
          dialog.showErrorBox("OpenWick stopped", `${e.message}\n\nDetails: ${logFile()}`);
          app.quit();
        }
      }
    }, 4000);
  }

  // Start server.js with Electron acting as plain Node. Resolves with the address it's on.
  function startServer() {
    return new Promise((resolve, reject) => {
      server = spawn(process.execPath, [path.join(ROOT, "server.js")], {
        cwd: ROOT,
        env: { ...process.env, ...dirs, ELECTRON_RUN_AS_NODE: "1", PORT: String(PORT) },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let out = "";
      const timer = setTimeout(() => reject(new Error(`The server didn't start in 60 seconds.\n\n${out.slice(-1500)}`)), 60000);
      const onData = (b) => {
        const s = b.toString();
        out += s;
        log(s.trimEnd());
        const m = out.match(/Open:\s+(http:\/\/localhost:\d+)/);
        if (m && !url) {
          clearTimeout(timer);
          url = m[1].replace("localhost", "127.0.0.1");
          resolve(url);
        }
      };
      server.stdout.on("data", onData);
      server.stderr.on("data", onData);
      server.on("exit", (code) => {
        clearTimeout(timer);
        log(`server exited (${code})`);
        if (!url) reject(new Error(`The server stopped (code ${code}).\n\n${out.slice(-1500)}`));
        else if (!quitting) {
          dialog.showErrorBox("OpenWick stopped", `The background server stopped unexpectedly (code ${code}). Details are in:\n${logFile()}`);
          app.quit();
        }
      });
    });
  }

  // Remember the window's size and place between runs.
  const boundsFile = path.join(user, "window.json");
  // First run: 90% of the screen, centred. After that, wherever you left it.
  const savedBounds = () => {
    try { return JSON.parse(fs.readFileSync(boundsFile, "utf8")); } catch { /* first run */ }
    const a = screen.getPrimaryDisplay().workArea;
    const width = Math.round(a.width * 0.9), height = Math.round(a.height * 0.9);
    return { width, height, x: a.x + Math.round((a.width - width) / 2), y: a.y + Math.round((a.height - height) / 2) };
  };

  // ---------- Interface size ----------
  // "auto" scales everything to the screen the window is on (electron/scale.cjs): smaller on a
  // small tablet, 100% on a laptop, up to 250% on an 8K monitor. You can pick a fixed size in
  // Settings → General, or with Ctrl + and Ctrl −; Ctrl 0 goes back to auto.
  const prefsFile = path.join(user, "desktop.json");
  const prefs = (() => { try { return JSON.parse(fs.readFileSync(prefsFile, "utf8")); } catch { return {}; } })();
  const savePrefs = () => { try { fs.writeFileSync(prefsFile, JSON.stringify(prefs)); } catch { /* not fatal */ } };
  const autoZoom = () => {
    const d = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
    return autoScale(d.size.width, d.size.height);
  };
  const zoomSetting = () => (typeof prefs.zoom === "number" ? prefs.zoom : "auto");
  const currentZoom = () => (zoomSetting() === "auto" ? autoZoom() : prefs.zoom);
  const applyZoom = () => {
    if (win && !win.isDestroyed()) win.webContents.setZoomFactor(currentZoom());
  };
  const setZoom = (v) => {
    if (v === "auto") delete prefs.zoom;
    else prefs.zoom = Math.max(0.5, Math.min(3, Number(v) || 1));
    savePrefs();
    applyZoom();
    return { setting: zoomSetting(), factor: currentZoom() };
  };
  const stepZoom = (dir) => {
    const cur = currentZoom();
    const next = dir > 0 ? SIZES.find((z) => z > cur + 0.001) : [...SIZES].reverse().find((z) => z < cur - 0.001);
    if (next) setZoom(next);
  };
  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    try { fs.writeFileSync(boundsFile, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch { /* not fatal */ }
  };

  const isLocal = (u) => typeof u === "string" && url && u.startsWith(url);

  function createWindow() {
    const b = savedBounds();
    win = new BrowserWindow({
      ...b,
      minWidth: 900,
      minHeight: 560,
      title: "OpenWick",
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#050505" : "#ffffff",
      icon: path.join(ROOT, "build", "icon.png"),
      show: false,
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.cjs") },
    });
    if (b.maximized) win.maximize();
    win.setMenuBarVisibility(false);
    // Size the interface for this screen, again after each page load, and when the window moves
    // to another monitor.
    win.webContents.on("did-finish-load", applyZoom);
    let moveTimer = null;
    win.on("moved", () => { clearTimeout(moveTimer); moveTimer = setTimeout(applyZoom, 300); });
    // No menu bar on Windows and Linux, so the usual keys are handled here.
    win.webContents.on("before-input-event", (e, i) => {
      if (i.type !== "keyDown") return;
      const mod = i.control || i.meta, k = i.key.toLowerCase();
      const act =
        i.key === "F11" ? () => win.setFullScreen(!win.isFullScreen())
        : i.key === "F5" || (mod && k === "r") ? () => win.webContents.reload()
        : mod && i.shift && k === "i" ? () => win.webContents.toggleDevTools()
        : mod && (k === "=" || k === "+") ? () => stepZoom(1)
        : mod && k === "-" ? () => stepZoom(-1)
        : mod && k === "0" ? () => setZoom("auto")
        : null;
      if (act) { e.preventDefault(); act(); }
    });
    win.once("ready-to-show", () => win.show());
    // A downloaded version that got this far works: keep it (and tidy older downloads).
    if (RUNNING_DOWNLOADED) win.webContents.once("did-finish-load", () => {
      try { updater.confirm(UPDATES_HOME, pkg.version); log(`running OpenWick ${pkg.version} (downloaded update)`); } catch (e) { log(`update confirm: ${e.message}`); }
    });
    win.on("close", saveBounds);
    win.on("closed", () => { win = null; });
    // Pages of the app open inside it; anything else (news, sources) opens in your browser.
    win.webContents.setWindowOpenHandler(({ url: u }) => {
      if (isLocal(u)) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true } };
      if (/^https?:\/\//.test(u)) shell.openExternal(u);
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (e, u) => {
      if (isLocal(u)) return;
      e.preventDefault();
      if (/^https?:\/\//.test(u)) shell.openExternal(u);
    });
    win.loadURL(`${url}/`); // the home page first, like the website
  }

  function about() {
    dialog.showMessageBox(win, {
      type: "info",
      title: "About OpenWick",
      message: `OpenWick ${pkg.version}`,
      detail:
        `Created by ${CREATOR} and the OpenWick contributors.\n` +
        "Open source under the MIT licence. Built on Quant Terminal by Lewis Jackson.\n" +
        "Charts drawn with TradingView's Lightweight Charts™ (Apache 2.0).\n\n" +
        "Nothing in this app is investment advice.\n\n" +
        `Your data: ${user}`,
      buttons: ["OK", "Open data folder"],
    }).then(({ response }) => response === 1 && shell.openPath(user));
  }

  // ---------- Updates ----------
  // Looks at the project's latest GitHub release. If it's newer, the installed app downloads just
  // OpenWick's own files (about 7 MB, checksum-verified) in the background, then asks to restart.
  // Only when a release needs a newer Electron (or has no update package) does it point to the
  // full installer instead. See electron/updater.cjs.
  let updating = false;
  const asked = new Set();
  const electronMajor = parseInt(process.versions.electron, 10);
  async function checkForUpdates(quiet) {
    if (REPO.startsWith("OWNER/")) {
      if (!quiet) dialog.showMessageBox(win, { message: "Update checks start once the project is published on GitHub." });
      return;
    }
    if (updating) {
      if (!quiet) dialog.showMessageBox(win, { message: "An update is downloading.", detail: "OpenWick will ask to restart when it's ready." });
      return;
    }
    let rel = null, latest = "";
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { "User-Agent": "OpenWick-desktop", Accept: "application/vnd.github+json" } });
      if (r.status === 404) {
        if (!quiet) dialog.showMessageBox(win, { message: "No release has been published yet.", detail: `You have OpenWick ${pkg.version}.` });
        return;
      }
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      rel = await r.json();
      latest = String(rel.tag_name || "").replace(/^v/, "");
      if (!latest || !updater.newer(latest, pkg.version)) {
        if (!quiet) dialog.showMessageBox(win, { message: "You have the latest version.", detail: `OpenWick ${pkg.version}` });
        return;
      }
      if (quiet && (updater.skipped(UPDATES_HOME, latest) || asked.has(latest))) return;
      if (!SELF_UPDATE) return offerInstaller(latest, rel);
      if (!updater.ready(UPDATES_HOME, latest)) {
        updating = true;
        log(`downloading OpenWick ${latest}`);
        try {
          await updater.download(UPDATES_HOME, rel, { electronMajor, onProgress: (p) => win?.setProgressBar(p < 1 ? p : -1) });
        } finally {
          updating = false;
          win?.setProgressBar(-1);
        }
        log(`OpenWick ${latest} downloaded`);
      }
      asked.add(latest);
      await askRestart(latest, rel);
    } catch (e) {
      log(`update: ${e.message}`);
      if (rel && (e.reason === "no-package" || e.reason === "needs-installer")) return offerInstaller(latest, rel, e.reason === "needs-installer");
      if (!quiet) dialog.showMessageBox(win, { type: "warning", message: "Couldn't update OpenWick.", detail: `${e.message}\n\nYou can also download the installer from the project's Releases page.` });
    }
  }
  async function askRestart(version, rel) {
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      title: "Update ready",
      message: `OpenWick ${version} is ready`,
      detail: `You have ${pkg.version}. Restarting takes a few seconds; your charts, watchlists and settings are kept.\n\nChoose Later and it's used the next time you open OpenWick.`,
      buttons: ["Restart now", "Later", "Skip this version", "What's new"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      // An AppImage runs from a temporary mount, so restart the AppImage file itself.
      app.relaunch(process.env.APPIMAGE ? { execPath: process.env.APPIMAGE, args: process.argv.slice(1) } : undefined);
      app.quit();
    } else if (response === 2) updater.skip(UPDATES_HOME, version);
    else if (response === 3) shell.openExternal(rel.html_url);
  }
  // The full installer: when this copy can't update itself to that version.
  async function offerInstaller(version, rel, needsNewer = false) {
    asked.add(version);
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      message: `OpenWick ${version} is available`,
      detail: `You have ${pkg.version}. ${needsNewer ? "This version comes with a newer desktop app, so it needs the installer this once. " : ""}Download it and install it over this one; your charts and settings are kept.`,
      buttons: ["Download", "Later"],
    });
    if (response === 0) shell.openExternal(rel.html_url);
  }

  // Windows and Linux: no menu bar (the desktop actions are in Settings → General). A Mac app keeps
  // the standard menu at the top of the screen, which is where Mac users expect Quit, Copy and Paste.
  function buildMenu() {
    if (process.platform !== "darwin") return Menu.setApplicationMenu(null);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: "OpenWick", submenu: [{ label: "About OpenWick", click: about }, { label: "Check for updates…", click: () => checkForUpdates(false) }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] },
      { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
      { label: "View", submenu: [{ role: "reload" }, { role: "togglefullscreen" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] },
      { role: "windowMenu" },
    ]));
  }
  ipcMain.handle("ow:about", () => about());
  ipcMain.handle("ow:get-zoom", () => ({ setting: zoomSetting(), factor: currentZoom(), auto: autoZoom() }));
  ipcMain.handle("ow:set-zoom", (_e, v) => setZoom(v));
  ipcMain.handle("ow:updates", () => checkForUpdates(false));
  ipcMain.handle("ow:data-folder", () => shell.openPath(user));

  app.on("second-instance", () => {
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    try {
      await firstRun();
      url = await findRunning();
      if (url) {
        log(`using the OpenWick already running at ${url}`);
        watchBorrowed();
      } else await startServer();
    } catch (e) {
      log(e.stack || e.message);
      dialog.showErrorBox("OpenWick couldn't start", `${e.message}\n\nDetails: ${logFile()}`);
      return app.quit();
    }
    buildMenu();
    createWindow();
    screen.on("display-metrics-changed", applyZoom);
    screen.on("display-added", applyZoom);
    screen.on("display-removed", applyZoom);
    // Once, quietly, a few seconds after the app opens: tell the user only if there's something new.
    setTimeout(() => checkForUpdates(true), 8000);
    app.on("activate", () => { if (!win) createWindow(); });
  });

  // Closing the window quits (on a Mac it stays in the Dock, as Mac apps do).
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("before-quit", () => {
    quitting = true;
    if (server && server.exitCode === null) server.kill();
  });
}
