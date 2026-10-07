import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { copySiteCrests } from '../scripts/lib/site-crests.mjs';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'site-crests-'));

test('copies crests from a data directory', async () => {
  const data = await tmp();
  const out = await tmp();
  await fs.mkdir(path.join(data, 'crests'));
  await fs.writeFile(path.join(data, 'crests', 'aaaaaaaaaaaa.webp'), 'A');
  const res = await copySiteCrests(['crests/aaaaaaaaaaaa.webp', 'crests/bbbbbbbbbbbb.webp'], { dir: data }, out);
  assert.deepEqual(res, { copied: 1, failed: ['crests/bbbbbbbbbbbb.webp'] });
  assert.equal(await fs.readFile(path.join(out, 'crests', 'aaaaaaaaaaaa.webp'), 'utf8'), 'A');
});

test('downloads crests from a URL prefix, retrying a failure; a crest that keeps failing is reported, not fatal', async () => {
  const out = await tmp();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('bbbbbbbbbbbb.webp') && calls.filter((u) => u === url).length === 1) throw new Error('reset');
    if (url.endsWith('cccccccccccc.webp')) return { ok: false, status: 404 };
    return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(url.slice(-17, -5)).buffer };
  };
  const crests = ['crests/aaaaaaaaaaaa.webp', 'crests/bbbbbbbbbbbb.webp', 'crests/cccccccccccc.webp'];
  const res = await copySiteCrests(crests, { base: 'https://raw.example/me/repo/abc/' }, out, { fetchImpl });
  assert.deepEqual(res, { copied: 2, failed: ['crests/cccccccccccc.webp'] });
  assert.equal(await fs.readFile(path.join(out, 'crests', 'bbbbbbbbbbbb.webp'), 'utf8'), 'bbbbbbbbbbbb');
  assert.ok(calls.includes('https://raw.example/me/repo/abc/crests/aaaaaaaaaaaa.webp'));
  assert.equal(calls.filter((u) => u.endsWith('cccccccccccc.webp')).length, 3);
});
