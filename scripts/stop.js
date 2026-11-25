#!/usr/bin/env node
// Stop the OpenWick running from this folder. --all stops every copy on this computer.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const all = process.argv.includes('--all');
const same = (a, b) => !!a && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const first = Number(process.env.PORT) || 3777;
let stopped = 0;
for (let p = first; p < first + 21; p++) {
  try {
    const h = await (await fetch(`http://127.0.0.1:${p}/api/health`, { signal: AbortSignal.timeout(700) })).json();
    if (h.app !== 'openwick' || (!all && !same(h.root, root))) continue;
    await fetch(`http://127.0.0.1:${p}/api/shutdown`, { method: 'POST', headers: { 'x-ow': '1' } });
    // Wait until it has really exited, so a launch straight after starts the new copy.
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try { await fetch(`http://127.0.0.1:${p}/api/health`, { signal: AbortSignal.timeout(300) }); } catch { break; }
    }
    console.log(`Stopped OpenWick on port ${p}`);
    stopped++;
  } catch { /* nothing here */ }
}
if (!stopped) console.log('OpenWick was not running from this folder.');
