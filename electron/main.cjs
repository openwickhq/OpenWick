// Starts the OpenWick desktop app: the version this installer came with, or a newer one the app
// downloaded by itself (electron/updater.cjs keeps those in your user folder). Kept tiny on
// purpose: this file is the one part an update can't replace, so the app itself is in app.cjs.
const { app } = require("electron");
const path = require("node:path");

app.setName("OpenWick"); // before anything asks for the user folder
const installed = path.join(__dirname, "..");
let root = installed;
// Only an installed app updates itself; a source copy (npm run desktop) runs as it is.
if (app.isPackaged || process.env.OW_TEST_UPDATES === "1") {
  try {
    const picked = require("./updater.cjs").pickVersion(app.getPath("userData"), installed, parseInt(process.versions.electron, 10));
    if (picked) root = picked;
  } catch {
    /* anything wrong with the downloads: run the installed version */
  }
}
process.env.OW_INSTALLED_ROOT = installed;
require(path.join(root, "electron", "app.cjs"));
