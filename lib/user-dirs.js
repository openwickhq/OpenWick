// The one folder where an installed OpenWick keeps your things, shared by the desktop app and the
// one-command install, so a chart saved in one shows up in the other:
//   Windows  %APPDATA%\OpenWick
//   macOS    ~/Library/Application Support/OpenWick
//   Linux    ~/.config/OpenWick   (or $XDG_CONFIG_HOME/OpenWick)
// Inside it: data/ (charts, watchlists, alerts, logos), custom/ (your indicators) and lists/
// (the refreshed stock and coin lists). A copy run from the source folder (npm start) keeps
// using its own data/ folder instead, unless OW_DATA_DIR says otherwise.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function sharedDir() {
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "OpenWick");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "OpenWick");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "OpenWick");
}

export function sharedEnv(base = sharedDir()) {
  return {
    OW_DATA_DIR: path.join(base, "data"),
    OW_CUSTOM_DIR: path.join(base, "custom"),
    OW_LISTS_DIR: path.join(base, "lists"),
  };
}

const hasFiles = (d) => {
  try { return fs.readdirSync(d).some((f) => !f.startsWith(".")); } catch { return false; }
};

// Make the folders. The first time: copy the example indicators that ship with the app, and bring
// over what an older install kept inside its own folder (oldData, oldCustom). Nothing is deleted:
// the old folder gets a note saying where its contents went.
export function prepareShared(appRoot, { oldData, oldCustom, base = sharedDir() } = {}) {
  const env = sharedEnv(base);
  for (const d of Object.values(env)) fs.mkdirSync(d, { recursive: true });
  const moved = [];
  if (oldData && hasFiles(oldData) && !fs.existsSync(path.join(env.OW_DATA_DIR, "state.json"))
      && !fs.existsSync(path.join(oldData, "MOVED.txt"))) {
    for (const f of fs.readdirSync(oldData)) {
      if (f === "server.log") continue;
      const to = path.join(env.OW_DATA_DIR, f);
      if (!fs.existsSync(to)) fs.cpSync(path.join(oldData, f), to, { recursive: true });
    }
    fs.writeFileSync(path.join(oldData, "MOVED.txt"), `OpenWick now keeps your data in ${env.OW_DATA_DIR}\n(shared with the desktop app). This folder is an old copy and can be deleted.\n`);
    moved.push(oldData);
  }
  const marker = path.join(env.OW_CUSTOM_DIR, ".seeded");
  if (!fs.existsSync(marker)) {
    for (const from of [oldCustom, path.join(appRoot, "custom")]) {
      if (!from || !fs.existsSync(from)) continue;
      for (const f of fs.readdirSync(from))
        if (f.endsWith(".js") && !fs.existsSync(path.join(env.OW_CUSTOM_DIR, f)))
          fs.copyFileSync(path.join(from, f), path.join(env.OW_CUSTOM_DIR, f));
    }
    fs.writeFileSync(marker, "The example indicators were copied here once. Edit or delete them freely.\n");
  }
  return { env, moved };
}
