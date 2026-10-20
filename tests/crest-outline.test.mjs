import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { crestDarkness, needsOutline, outlineCrest, OUTLINE_PX } from '../scripts/lib/crest-outline.mjs';

const badge = (body) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">${body}</svg>`)).png().toBuffer();

test('a black badge is dark at the edge and overall; a white one is not', async () => {
  const black = await crestDarkness(await badge('<circle cx="40" cy="40" r="34" fill="#000"/>'));
  assert.deepEqual(black, { rim: 1, all: 1 });
  assert.ok(needsOutline(black));
  const white = await crestDarkness(await badge('<circle cx="40" cy="40" r="34" fill="#fff"/>'));
  assert.deepEqual(white, { rim: 0, all: 0 });
  assert.ok(!needsOutline(white));
});

test('a thin dark ring around a bright crest reads fine: no outline (Man City, Barça)', async () => {
  const d = await crestDarkness(await badge('<circle cx="40" cy="40" r="34" fill="#6cabdd"/><circle cx="40" cy="40" r="33" fill="none" stroke="#1c2c5b" stroke-width="2"/>'));
  assert.ok(d.rim < 0.5 && d.all < 0.5, JSON.stringify(d));
  assert.ok(!needsOutline(d));
});

test('dark only in the middle, with a light rim: no outline', async () => {
  const d = await crestDarkness(await badge('<circle cx="40" cy="40" r="34" fill="#fff"/><circle cx="40" cy="40" r="22" fill="#000"/>'));
  assert.ok(d.rim < 0.5, JSON.stringify(d));
  assert.ok(!needsOutline(d));
});

test('the outline is light, just around the shape, and the crest keeps its size', async () => {
  const out = await outlineCrest(await badge('<circle cx="40" cy="40" r="30" fill="#000"/>'));
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [80, 80]);
  const px = (x) => [...data.subarray((40 * 80 + x) * 4, (40 * 80 + x) * 4 + 4)];
  // Along the middle row, from the left: transparent, then the solid light outline, then the black crest.
  assert.ok(px(0)[3] < 5, 'transparent beyond the outline');
  const ring = [...Array(40).keys()].find((x) => px(x)[3] > 200);
  const crest = [...Array(40).keys()].find((x) => px(x)[3] > 200 && px(x)[0] < 60);
  const [r, g, b] = px(ring);
  assert.ok(r > 180 && g > 180 && b > 180, `outline pixel ${px(ring)}`);
  assert.ok(crest - ring >= 2, `the outline is solid for ${crest - ring} px, from x=${ring}`);
  assert.ok(crest - ring <= OUTLINE_PX, `and fits in the room left for it (${crest - ring} px)`);
  const [r2, , , a2] = px(40);
  assert.ok(r2 < 30 && a2 > 250, `middle pixel ${[r2, a2]}`);
});
