#!/usr/bin/env node
// The `openwick` command the installers add:
//   openwick            start (or just open the browser if it's running)
//   openwick stop       stop it
//   openwick status     is it running, and where
//   openwick update     download the newest version (keeps your data)
//   openwick doctor     check Node.js and which data sources you can reach
//   openwick where      show the install and data folders
//   openwick uninstall  remove it (your data folder is kept; --delete-data removes it too)
//   openwick version
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { prepareShared } from "../lib/user-dirs.js";

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOME = process.env.OPENWICK_HOME || path.dirname(APP);
const NAME = "OpenWick", ID = "openwick";
const win = process.platform === "win32";
const pkg = JSON.parse(fs.readFileSync(path.join(APP, "package.json"), "utf8"));
// An installed copy keeps your data in the folder it shares with the desktop app (lib/user-dirs.js).
// The first run after an update moves over what the older version kept inside the app folder.
const installed = fs.existsSync(path.join(HOME, ".openwick-install")) && path.resolve(path.join(HOME, "app")) === path.resolve(APP);
if (installed) process.env.OPENWICK_HOME ||= HOME; // so messages name the `openwick` command
if (installed && !process.env.OW_DATA_DIR) {
  try {
    const { env } = prepareShared(APP, { oldData: path.join(APP, "data"), oldCustom: path.join(APP, "custom") });
    Object.assign(process.env, env);
  } catch (e) {
    console.error(`Couldn't set up the data folder (${e.message}). Using the app folder instead.`);
  }
}
const DATA = process.env.OW_DATA_DIR || path.join(APP, "data");
const CUSTOM_DIR = process.env.OW_CUSTOM_DIR || path.join(APP, "custom");
const same = (a, b) => !!a && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const node = (script, ...args) => spawnSync(process.execPath, [path.join(APP, "scripts", script), ...args], { stdio: "inherit" }).status ?? 1;
const [cmd = "start", ...rest] = process.argv.slice(2);

async function running() {
  const first = Number(process.env.PORT) || 3777;
  for (let p = first; p < first + 21; p++) {
    try {
      const h = await (await fetch(`http://127.0.0.1:${p}/api/health`, { signal: AbortSignal.timeout(700) })).json();
      if (h.app === "openwick" && (same(h.root, APP) || same(h.data, DATA))) return p;
    } catch { /* not here */ }
  }
  return null;
}

const HELP = `${NAME} ${pkg.version}, created by Sourav Chakraborty (MIT licence)

  ${ID}            start it and open your browser
  ${ID} stop       stop it
  ${ID} status     is it running
  ${ID} update     get the newest version (keeps your data)
  ${ID} doctor     check Node.js and the data sources
  ${ID} where      show the install and data folders
  ${ID} uninstall  remove it (your charts and settings are kept)
  ${ID} version
`;

switch (cmd) {
  case "start":
  case "open":
    process.exit(node("launch.js", ...rest));
  case "stop":
    process.exit(node("stop.js", ...rest));
  case "status": {
    const p = await running();
    console.log(p ? `${NAME} is running at http://localhost:${p}` : `${NAME} is not running. Start it with: ${ID}`);
    break;
  }
  case "doctor":
    process.exit(node("doctor.js", ...rest));
  case "where":
    console.log(`App:   ${APP}\nData:  ${DATA}\nYour indicators:  ${CUSTOM_DIR}${installed ? "\n(The data folders are shared with the OpenWick desktop app.)" : ""}`);
    break;
  case "version":
  case "--version":
  case "-v":
    console.log(pkg.version);
    break;
  case "update": {
    // The installer that came with this version does the update, so the same rules apply.
    // It runs from a temporary copy, because the update replaces the folder it came from.
    const env = { ...process.env, OPENWICK_HOME: HOME };
    const script = path.join(os.tmpdir(), `${ID}-install-${process.pid}${win ? ".ps1" : ".sh"}`);
    fs.copyFileSync(path.join(APP, win ? "install.ps1" : "install.sh"), script);
    const r = win
      ? spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], { stdio: "inherit", env, cwd: os.homedir() })
      : spawnSync("sh", [script], { stdio: "inherit", env, cwd: os.homedir() });
    fs.rmSync(script, { force: true });
    process.exit(r.status ?? 1);
  }
  case "uninstall": {
    // Only ever delete a folder the installer made (it leaves a marker file there).
    if (!fs.existsSync(path.join(HOME, ".openwick-install")) || path.resolve(path.join(HOME, "app")) !== path.resolve(APP)) {
      console.log(`This copy wasn't set up by the installer (it lives in ${APP}). Delete that folder to remove it.`);
      break;
    }
    const yes = rest.includes("--yes") || rest.includes("-y");
    if (!yes) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const a = await rl.question(`Remove ${NAME} from ${HOME}? Your charts and settings are kept. [y/N] `);
      rl.close();
      if (!/^y/i.test(a.trim())) { console.log("Nothing removed."); break; }
    }
    node("stop.js");
    // Your data isn't in the app folder, so removing the app leaves it (the desktop app uses it too).
    if (rest.includes("--delete-data")) {
      for (const d of [DATA, CUSTOM_DIR, process.env.OW_LISTS_DIR]) if (d && !same(path.dirname(d), APP)) fs.rmSync(d, { recursive: true, force: true });
      console.log("Your data was deleted too.");
    } else console.log(`Your charts and settings stay in ${path.dirname(DATA)} (shared with the desktop app). Delete that folder to remove them, or run: ${ID} uninstall --delete-data`);
    const shortcuts = win
      // Not HOME\bin: openwick.cmd is still running from it. The clean-up script below removes HOME, bin included.
      ? [path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", `${NAME}.lnk`), path.join(os.homedir(), "Desktop", `${NAME}.lnk`)]
      : [path.join(os.homedir(), ".local", "bin", ID), path.join(os.homedir(), ".local", "share", "applications", `${ID}.desktop`), path.join(os.homedir(), "Applications", `${NAME}.app`)];
    for (const f of shortcuts) fs.rmSync(f, { recursive: true, force: true });
    // Windows can't delete the running node.exe's folder from inside it, so a short script finishes the job.
    if (win) {
      const bat = path.join(os.tmpdir(), `${ID}-uninstall.cmd`);
      fs.writeFileSync(bat, `@echo off\r\ntimeout /t 2 /nobreak >nul\r\nrmdir /s /q "${HOME}"\r\ndel "%~f0"\r\n`);
      spawnSync("cmd", ["/c", "start", "", "/min", bat], { detached: true, stdio: "ignore" });
    } else fs.rmSync(HOME, { recursive: true, force: true });
    console.log(`${NAME} is removed.${win ? "" : ' The PATH line in your shell profile (marked "added by OpenWick") can stay or go.'}`);
    break;
  }
  case "help":
  case "--help":
  case "-h":
    console.log(HELP);
    break;
  default:
    console.log(`Unknown command "${cmd}".\n\n${HELP}`);
    process.exit(1);
}
