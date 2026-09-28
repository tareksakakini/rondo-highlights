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
  assert.deepEqual(result, [['PL', 'md-5', 10], ['BL1', 'md-4', 9], ['CL', 'md-1', 18], ['EL', 'md-1', 18], ['UNL', 'w-2026-09-24', 4]]);
  const indexPath = path.join(dir, 'public/data/index.json');
  const before = fs.readFileSync(indexPath, 'utf8');
  const pl = JSON.parse(fs.readFileSync(path.join(dir, 'public/data/PL/md-5.json'), 'utf8'));
  const nbc = pl.matches.flatMap((m) => m.highlights).find((h) => h.channel === 'NBC Sports');
  assert.deepEqual(nbc.allow, ['GU', 'MP', 'PR', 'US', 'VI']);
  run({ KEEP: '1' });
  assert.equal(fs.readFileSync(indexPath, 'utf8'), before);
  fs.rmSync(dir, { recursive: true, force: true });
});
