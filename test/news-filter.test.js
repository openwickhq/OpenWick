// Indian market feeds without the Wall Street stories they also carry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUsOnlyHeadline } from '../lib/market-info.js';

const us = (title, summary = '') => isUsOnlyHeadline({ title, summary });

test('US market and US company stories are dropped', () => {
  assert.ok(us('Nasdaq climbs from lows, now down 1.3%, Dow rises 400 pts: US Stock Market Live Updates'));
  assert.ok(us('Hewlett Packard Enterprise shares crash 16%, set for biggest 1-day fall in 18 months; what went wrong?'));
  assert.ok(us('Who is Lori Huang? How Jensen Huang’s wife holds the keys to Nvidia founder’s $109 billion fortune'));
  assert.ok(us('US markets slide, Asian markets rebound as Nvidia rally fizzles out'));
});

test('stories that tie back to India stay', () => {
  assert.ok(!us('Fed rate cut: what it means for Nifty and Sensex on Monday'));
  assert.ok(!us('Nvidia rally lifts Indian IT stocks; Infosys, TCS gain'));
  assert.ok(!us('South Indian Bank shares in focus as RBI approves SBI Mutual Fund stake'));
  assert.ok(!us('IIFCL IPO: Govt to part sale stake, company to issue fresh shares'));
  assert.ok(!us('Apple supplier plans ₹5,000 crore plant', ''));
});
