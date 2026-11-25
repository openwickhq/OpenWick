// Saved logos: only files named in the expected shape are served, and the index becomes a module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-logos-'));
process.env.OW_DATA_DIR = dir;
fs.mkdirSync(path.join(dir, 'logos', 's'), { recursive: true });
fs.writeFileSync(path.join(dir, 'logos', 's', 'M&M.png'), Buffer.from('89504e47', 'hex'));
fs.writeFileSync(path.join(dir, 'logos', 's', 'X.svg'), '<svg></svg>');
fs.writeFileSync(path.join(dir, 'secret.json'), '{}');
fs.writeFileSync(path.join(dir, 'logos', 'index.json'), JSON.stringify({ s: { 'M&M': 's/M&M.png' }, c: {}, w: ['s/M&M.png'], miss: { Z: 1 } }));
const logos = await import('../lib/logos.js');

test('serves saved logos with an image type', () => {
  const f = logos.file('s/M&M.png');
  assert.equal(f.headers['Content-Type'], 'image/png');
  assert.equal(f.body.length, 4);
  assert.equal(logos.file('s/NOPE.png'), null);
});

test('refuses anything outside the logos folder or of another type', () => {
  for (const bad of ['../secret.json', 's/../../secret.json', 's/M&M.html', 'index.json', 'x/M&M.png', '/etc/passwd']) assert.equal(logos.file(bad), null, bad);
});

test('SVG logos are served sandboxed', () => {
  const f = logos.file('s/X.svg');
  assert.equal(f.headers['Content-Type'], 'image/svg+xml');
  assert.match(f.headers['Content-Security-Policy'], /sandbox/);
  assert.equal(f.headers['X-Content-Type-Options'], 'nosniff');
});

test('the index module lists stocks, coins and wide logos only', () => {
  const js = logos.indexJs();
  assert.match(js, /^export default \{/);
  const data = JSON.parse(js.replace(/^export default /, '').replace(/;$/, ''));
  assert.deepEqual(data, { s: { 'M&M': 's/M&M.png' }, c: {}, w: ['s/M&M.png'] });
});
