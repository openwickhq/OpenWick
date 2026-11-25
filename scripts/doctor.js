#!/usr/bin/env node
// Checks this machine can run OpenWick and which free data sources it can reach.
// Exit code 0 = ready (crypto + at least one stock source work), 1 = something needs fixing.
import { probeAll } from '../lib/providers.js';
import { relaunchForProxy, proxyNote } from '../lib/proxy.js';

const relaunched = relaunchForProxy();
if (relaunched) process.exit(await relaunched);

const major = Number(process.versions.node.split('.')[0]);
const lines = [];
let ok = true;
lines.push(`Node.js ${process.version} on ${process.platform} (${process.arch})  ${major >= 18 ? 'OK' : 'TOO OLD: install Node 18 or newer from https://nodejs.org'}`);
if (major < 18) ok = false;
if (proxyNote()) lines.push(proxyNote());

const res = await probeAll();
for (const [name, r] of Object.entries(res)) lines.push(`${r.ok ? 'OK  ' : 'FAIL'}  ${name}${r.ok ? ` (${r.ms} ms)` : `: ${r.error}`}`);
const crypto = res['Binance (crypto)'].ok || res['Coinbase (crypto fallback)'].ok || res['Kraken (crypto + forex)'].ok;
const stocks = res['Yahoo (Indian stocks and indices)'].ok;
if (!crypto) { ok = false; lines.push('No crypto source reachable. Check your internet connection or firewall.'); }
if (!stocks) lines.push('Yahoo is busy or rate limiting you, so Indian stocks and indices may not load for a few minutes. Crypto still works.');
if (!res['Binance (crypto)'].ok && crypto) lines.push('Binance is blocked from your location; crypto charts use Coinbase and Kraken automatically.');

console.log(`\nOpenWick doctor\n${'-'.repeat(40)}\n${lines.join('\n')}\n\n${ok ? 'READY: run "node scripts/launch.js"' : 'NOT READY: fix the FAIL lines above'}\n`);
process.exit(ok ? 0 : 1);
