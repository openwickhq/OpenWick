// Standard Deviation Channel: checked against a plain least-squares fit worked out separately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compute, stdDevChannel, validateIndicator } from '../public/lib/indicators.js';

const bars = Array.from({ length: 400 }, (_, i) => {
  const c = 100 + i * 0.3 + 6 * Math.sin(i / 4) + (i % 7) * 0.4;
  return { time: i * 86400, open: c, high: c + 1.5 + (i % 3), low: c - 1 - (i % 5) * 0.3, close: c, volume: 1 };
});

function reference(L) {
  const ys = bars.slice(-L).map((b) => b.close), xs = ys.map((_, k) => k);
  const mx = xs.reduce((a, b) => a + b) / L, my = ys.reduce((a, b) => a + b) / L;
  const b = xs.reduce((a, x, k) => a + (x - mx) * (ys[k] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const fit = xs.map((x) => my + b * (x - mx));
  const sd = Math.sqrt(ys.reduce((a, y, k) => a + (y - fit[k]) ** 2, 0) / (L - 1));
  const r = xs.reduce((a, x, k) => a + (x - mx) * (ys[k] - my), 0) /
    Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0) * ys.reduce((a, y) => a + (y - my) ** 2, 0));
  const hi = bars.slice(-L).map((x) => x.high), lo = bars.slice(-L).map((x) => x.low);
  return { start: fit[0], end: fit[L - 1], sd, r, up: Math.max(...hi.map((h, k) => h - fit[k])), dn: Math.max(...lo.map((l, k) => fit[k] - l)) };
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} vs ${b}`);

test('line, deviation, furthest high/low and Pearson R match a least-squares fit', () => {
  const ref = reference(128);
  const c = stdDevChannel(bars.map((b) => b.close), bars.map((b) => b.high), bars.map((b) => b.low), 128);
  close(c.start, ref.start); close(c.end, ref.end); close(c.stdDev, ref.sd); close(c.pearsonR, ref.r);
  close(c.upDev, Math.max(0, ref.up)); close(c.dnDev, Math.max(0, ref.dn));
  assert.equal(c.from, 400 - 128); assert.equal(c.to, 399);
});

test('outputs follow the settings: multipliers, and "off" uses the furthest high or low', () => {
  const ref = reference(128);
  const r = compute('stddevchannel', bars, { upper2Mult: 3, lower1On: false });
  close(r.base.at(-1), ref.end);
  close(r.upper1.at(-1) - r.base.at(-1), ref.sd);
  close(r.upper2.at(-1) - r.base.at(-1), 3 * ref.sd);
  close(r.base.at(-1) - r.lower1.at(-1), ref.dn);
  close(r.base.at(-1) - r.lower2.at(-1), 2 * ref.sd);
  assert.ok(Number.isNaN(r.base[400 - 129])); // nothing before the channel's first bar
  assert.equal(r.channel.extendRight, true);
  assert.equal(r.channel.fillOpacity, 0.05);
});

test('short history uses what there is; bool inputs pass the format check', () => {
  const r = compute('stddevchannel', bars.slice(0, 50), { length: 128 });
  assert.equal(r.channel.from, 0);
  assert.equal(compute('stddevchannel', bars.slice(0, 1), {}).channel, undefined);
  const def = (d) => ({ id: 'booltest', name: 'Bool test', overlay: true, inputs: [{ key: 'on', label: 'On', type: 'bool', default: d }], outputs: [{ key: 'a', label: 'A', kind: 'line', color: '#ffffff' }], calc: (b) => ({ a: b.map((x) => x.close) }) });
  assert.doesNotThrow(() => validateIndicator(def(true)));
  assert.throws(() => validateIndicator(def(1)), /true or false/);
});
