// Offline checks for the news readers (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRss, parseGoogleNews, INDIA_FEEDS } from '../lib/market-info.js';

test('Google News titles lose the " - Publisher" ending and keep the publisher as the source', () => {
  const xml = `<rss><channel>
    <item><title>Reliance shares rise 2% after results - The Economic Times</title><link>https://news.google.com/a</link><pubDate>Mon, 24 Nov 2026 10:00:00 GMT</pubDate><source url="https://economictimes.indiatimes.com">The Economic Times</source></item>
    <item><title>Reliance Jio adds users - Mint</title><link>https://news.google.com/b</link><pubDate>Mon, 24 Nov 2026 09:00:00 GMT</pubDate><source url="https://livemint.com">Mint</source></item>
  </channel></rss>`;
  const items = parseGoogleNews(xml);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Reliance shares rise 2% after results');
  assert.equal(items[0].source, 'The Economic Times');
  assert.equal(items[1].title, 'Reliance Jio adds users');
  assert.equal(items[1].source, 'Mint');
  assert.ok(items[0].time > items[1].time);
});

test('RSS items decode entities and CDATA', () => {
  const [n] = parseRss('<item><title><![CDATA[Sensex &amp; Nifty end lower]]></title><link>https://x/y</link></item>', 'Mint');
  assert.equal(n.title, 'Sensex & Nifty end lower');
  assert.equal(n.source, 'Mint');
});

test('the Indian news feeds are the four business papers', () => {
  assert.deepEqual(INDIA_FEEDS.map((f) => f[1]), ['Economic Times', 'Mint', 'Business Standard', 'Moneycontrol']);
});
