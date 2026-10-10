import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addHit, dayKey, device, emptyDay, isBot, lastDays, parseHit, summarize } from '../netlify/lib/analytics.mjs';

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_TAB = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

test('bots and scripts are recognised, browsers are not', () => {
  for (const ua of ['', 'Googlebot/2.1 (+http://www.google.com/bot.html)', 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/129.0', 'curl/8.4.0', 'python-requests/2.31']) {
    assert.equal(isBot(ua), true, ua);
  }
  for (const ua of [CHROME, IPHONE, ANDROID_TAB]) assert.equal(isBot(ua), false, ua);
});

test('devices', () => {
  assert.equal(device(CHROME), 'desktop');
  assert.equal(device(IPHONE), 'mobile');
  assert.equal(device(ANDROID_TAB), 'tablet');
});

test('parseHit keeps what the site sends and drops the rest', () => {
  assert.deepEqual(parseHit({ t: 'view', p: '/premier-league/matchweek-6/', l: 1, r: 'www.Google.com' }),
    { type: 'view', path: '/premier-league/matchweek-6/', landing: true, ref: 'google.com' });
  // Referrers only count on landing.
  assert.deepEqual(parseHit({ t: 'view', p: '/', r: 'google.com' }), { type: 'view', path: '/', landing: false });
  assert.equal(parseHit({ t: 'view', p: '/<script>' }).path, '(other)');
  assert.equal(parseHit({ t: 'view', p: '/', l: 1, r: 'evil.com/<x>' }).ref, undefined);
  assert.deepEqual(parseHit({ t: 'event', n: 'play', p: '/', d: { from: 'all', comp: 'PL', Bad: 'x', huge: 'x'.repeat(50), num: 3 } }),
    { type: 'event', name: 'play', path: '/', props: { from: 'all', comp: 'PL' } });
  assert.equal(parseHit({ t: 'event', n: 'hack' }), null);
  assert.equal(parseHit({ t: 'other' }), null);
  assert.equal(parseHit(null), null);
  assert.equal(parseHit('view'), null);
});

const who = (id, extra = {}) => ({ id, country: 'US', device: 'desktop', ...extra });

test('addHit counts views, visitors, landings and events', () => {
  const day = emptyDay();
  addHit(day, parseHit({ t: 'view', p: '/', l: 1, r: 'google.com' }), who('a'));
  addHit(day, parseHit({ t: 'view', p: '/la-liga/' }), who('a'));
  addHit(day, parseHit({ t: 'event', n: 'play', p: '/la-liga/', d: { from: 'all', comp: 'PD' } }), who('a'));
  addHit(day, parseHit({ t: 'event', n: 'video', p: '/la-liga/', d: { comp: 'PD', cut: 'short' } }), who('a'));
  addHit(day, parseHit({ t: 'event', n: 'video', p: '/la-liga/', d: { comp: 'PD', cut: 'extended' } }), who('a'));
  addHit(day, parseHit({ t: 'view', p: '/', l: 1 }), who('b', { country: null, device: 'mobile' }));

  assert.equal(day.views, 3);
  assert.deepEqual(day.v, { a: [2, 1, 2], b: [1, 0, 0] });
  assert.deepEqual(day.pages, { '/': 2, '/la-liga/': 1 });
  assert.deepEqual(day.entries, { '/': 2 });
  assert.deepEqual(day.refs, { 'google.com': 1 });
  // Countries and devices count visitors, not hits.
  assert.deepEqual(day.countries, { US: 1, '??': 1 });
  assert.deepEqual(day.devices, { desktop: 1, mobile: 1 });
  assert.deepEqual(day.events.video, { n: 2, by: { comp: { PD: 2 }, cut: { short: 1, extended: 1 } } });
  assert.deepEqual(day.events.play, { n: 1, by: { from: { all: 1 }, comp: { PD: 1 } } });
});

test('a day keeps a bounded number of distinct paths', () => {
  const day = emptyDay();
  for (let i = 0; i < 600; i++) addHit(day, parseHit({ t: 'view', p: `/x-${i}/` }), who(`v${i}`));
  assert.equal(Object.keys(day.pages).length, 501);
  assert.equal(day.pages['(other)'], 100);
  assert.equal(day.views, 600);
});

test('one visitor flooding the collector stops counting', () => {
  const day = emptyDay();
  for (let i = 0; i < 2500; i++) addHit(day, parseHit({ t: 'view', p: '/' }), who('spam'));
  assert.equal(day.views, 2000);
});

test('days are UTC unless a time zone is given, oldest first', () => {
  const to = new Date('2026-10-09T23:30:00-07:00'); // Oct 10 in UTC
  assert.equal(dayKey(to), '2026-10-10');
  assert.deepEqual(lastDays(3, to), ['2026-10-08', '2026-10-09', '2026-10-10']);
  assert.equal(dayKey(to, 'America/Los_Angeles'), '2026-10-09');
  assert.deepEqual(lastDays(2, to, 'America/Los_Angeles'), ['2026-10-08', '2026-10-09']);
  assert.equal(dayKey(to, 'Not/AZone'), '2026-10-10');
  // Across the end of daylight saving time (Nov 1 2026 in the US), every date once.
  assert.deepEqual(lastDays(3, new Date('2026-11-02T12:00:00-08:00'), 'America/Los_Angeles'), ['2026-10-31', '2026-11-01', '2026-11-02']);
});

test('summarize adds up days and ranks the lists', () => {
  const d1 = emptyDay();
  addHit(d1, parseHit({ t: 'view', p: '/', l: 1, r: 'google.com' }), who('a'));
  addHit(d1, parseHit({ t: 'event', n: 'video', p: '/', d: { comp: 'PL', cut: 'short' } }), who('a'));
  addHit(d1, parseHit({ t: 'event', n: 'finish', p: '/', d: { comp: 'PL', cut: 'short' } }), who('a'));
  addHit(d1, parseHit({ t: 'view', p: '/', l: 1 }), who('b'));
  const d2 = emptyDay();
  addHit(d2, parseHit({ t: 'view', p: '/serie-a/', l: 1, r: 'google.com' }), who('a2', { country: 'IT' }));
  addHit(d2, parseHit({ t: 'view', p: '/', l: 0 }), who('a2', { country: 'IT' }));
  addHit(d2, parseHit({ t: 'event', n: 'setting', p: '/', d: { length: 'extended' } }), who('a2'));

  const s = summarize([['2026-10-07', d1], ['2026-10-08', null], ['2026-10-09', d2]]);
  assert.equal(s.from, '2026-10-07');
  assert.equal(s.to, '2026-10-09');
  assert.deepEqual(s.totals, { views: 4, visitors: 3, watchers: 1, plays: 0, videos: 1, oneView: 1 });
  assert.deepEqual(s.daily.map((d) => [d.day, d.visitors, d.watchers]), [['2026-10-07', 2, 1], ['2026-10-08', 0, 0], ['2026-10-09', 1, 0]]);
  assert.deepEqual(s.pages, [['/', 3], ['/serie-a/', 1]]);
  assert.deepEqual(s.refs, [['google.com', 2]]);
  assert.deepEqual(s.countries, [['US', 2], ['IT', 1]]);
  assert.deepEqual(s.events.finish, { n: 1, by: { comp: [['PL', 1]], cut: [['short', 1]] } });
  assert.deepEqual(s.events.setting, { n: 1, by: { length: [['extended', 1]] } });
});
