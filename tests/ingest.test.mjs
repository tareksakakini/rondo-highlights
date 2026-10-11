import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const harness = fileURLToPath(new URL('./ingest.mock.mjs', import.meta.url));

test('ingest end-to-end against mocked APIs; a second run changes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rondo-ingest-'));
  const run = (env = {}) => execFileSync(process.execPath, [harness, dir], { env: { ...process.env, ...env }, encoding: 'utf8' });
  const out = run();
  const result = JSON.parse(out.match(/RESULT (\[.*\]) \{/)[1]);
  assert.deepEqual(result, [['PL', 'md-5', 10], ['BL1', 'md-4', 9], ['CL', 'md-1', 18], ['EL', 'md-1', 17], ['UNL', 'md-1', 4]]);
  // EL MD1 has 18 fixtures in the mock; Hapoel Beer Sheva v Dinamo Zagreb is left out (scripts/lib/excluded-teams.json).
  assert.equal(Number(out.match(/hl: (\d+)/)[1]), 2, 'one Highlightly page per competition');
  const el = JSON.parse(fs.readFileSync(path.join(dir, 'public/data/EL/md-2.json'), 'utf8'));
  assert.equal(el.matches[0].status, 'TIMED', 'upcoming fixtures are listed before any highlight exists');
  const indexPath = path.join(dir, 'public/data/index.json');
  const before = fs.readFileSync(indexPath, 'utf8');
  const pl = JSON.parse(fs.readFileSync(path.join(dir, 'public/data/PL/md-5.json'), 'utf8'));
  const nbc = pl.matches.flatMap((m) => m.highlights).find((h) => h.channel === 'NBC Sports');
  assert.deepEqual(nbc.allow, ['GU', 'MP', 'PR', 'US', 'VI']);
  // Second run: Highlightly is down, but the day-old cache is fresh enough, so nothing changes.
  const again = run({ KEEP: '1', HL_DOWN: '1' });
  assert.equal(Number(again.match(/hl: (\d+)/)[1]), 0, 'cached fixtures are reused');
  assert.equal(fs.readFileSync(indexPath, 'utf8'), before);
  const calls = (o) => Object.fromEntries([...o.matchAll(/(\w+): (\d+)/g)].map(([, k, v]) => [k, Number(v)]));
  const first = calls(out);
  const channels = JSON.parse(fs.readFileSync(path.join(dir, 'public/data/cache/channels.json'), 'utf8'));
  assert.ok(Object.values(channels).every((c) => c.id && c.uploads && c.read), 'every channel stored with its last read');
  // Stored channels aren't looked up again (the mock only knows the seed's channels; the rest stay "not found").
  assert.equal(calls(again).ytChannels, first.ytChannels - Object.keys(channels).length);

  // Quick run right after: club channels were just read, the rest carry on from their last
  // read, so it costs a fraction of a full run and keeps everything already found.
  const quick = run({ KEEP: '1', INGEST_ARGS: '--quick' });
  assert.match(quick, /Rondo ingest \(quick\)/);
  assert.match(quick, /club\/federation channel\(s\) read in the last 30 min/);
  const reads = (c) => c.yt - c.ytChannels; // uploads pages + video details
  assert.ok(reads(calls(quick)) < reads(first) / 3, `quick run made ${reads(calls(quick))} YouTube reads vs ${reads(first)}`);
  assert.deepEqual(JSON.parse(quick.match(/RESULT (\[.*\]) \{/)[1]), result);
  assert.equal(fs.readFileSync(indexPath, 'utf8'), before);
  fs.rmSync(dir, { recursive: true, force: true });
});
