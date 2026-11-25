#!/usr/bin/env node
// Start OpenWick in the background and open your browser. It keeps running after this
// terminal closes. If it's already running, this just opens the browser.
//   node scripts/launch.js            node scripts/launch.js --no-open
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const first = Number(process.env.PORT) || 3777;
const same = (a, b) => !!a && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

let borrowed = false; // the server found belongs to another copy (the desktop app) on the same data
async function running() {
  for (let p = first; p < first + 21; p++) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/api/health`, { signal: AbortSignal.timeout(700) });
      const j = await r.json();
      borrowed = !same(j.root, root);
      // Only this folder's copy counts; another install on the same port range is left alone.
      // A server using the same data folder counts too, such as the desktop app's: two servers on
      // one data folder would overwrite each other's saves.
      if (j.app === 'openwick' && (same(j.root, root) || (process.env.OW_DATA_DIR && same(j.data, process.env.OW_DATA_DIR)))) return p;
    } catch { /* not this port */ }
  }
  return null;
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { const c = spawn(cmd, args, { detached: true, stdio: 'ignore' }); c.on('error', () => {}); c.unref(); } catch { /* headless */ }
}

let port = await running();
if (!port) {
  const dataDir = process.env.OW_DATA_DIR || path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const log = path.join(dataDir, 'server.log');
  const fd = fs.openSync(log, 'a');
  const child = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, detached: true, stdio: ['ignore', fd, fd], windowsHide: true, env: process.env });
  child.unref();
  for (let i = 0; i < 40 && !port; i++) { await new Promise((r) => setTimeout(r, 400)); port = await running(); }
  if (!port) {
    console.error(`OpenWick didn't start. Last lines of ${log}:\n${fs.readFileSync(log, 'utf8').split('\n').slice(-20).join('\n')}`);
    process.exit(1);
  }
}
const url = `http://localhost:${port}`;
if (!process.argv.includes('--no-open') && process.env.OW_NO_OPEN !== '1') openBrowser(url);
console.log(borrowed
  ? `OpenWick is running at ${url} (the desktop app's copy, which uses the same data). Closing the desktop app stops it.`
  : `OpenWick is running at ${url}\nStop it any time with: ${process.env.OPENWICK_HOME ? 'openwick stop' : 'node scripts/stop.js'}`);
process.exit(0);
