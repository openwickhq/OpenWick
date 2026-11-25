// The few desktop-only actions the app's Settings page offers (Settings → General → Desktop app).
// Nothing else from the computer is exposed to the page.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openwickDesktop", {
  about: () => ipcRenderer.invoke("ow:about"),
  checkForUpdates: () => ipcRenderer.invoke("ow:updates"),
  openDataFolder: () => ipcRenderer.invoke("ow:data-folder"),
  getZoom: () => ipcRenderer.invoke("ow:get-zoom"),
  setZoom: (v) => ipcRenderer.invoke("ow:set-zoom", v),
});
