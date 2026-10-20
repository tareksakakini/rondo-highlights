// Dark crests on the site's dark background. A crest that is dark both around its edge
// and overall (Juventus's black "J", Spurs' navy cockerel) melts into the page, so it gets
// a solid light outline around its shape, made into the image itself. A crest with just a
// dark ring around a bright middle (Man City, Barça) reads fine and is left alone.

import sharp from 'sharp';

/** The site's darkest backgrounds (--bg #0b0f14, --surface #121821): their relative luminance. */
const BG_LUM = 0.009;
/** A pixel this close in contrast to the background doesn't read against it (WCAG contrast ratio). */
const MIN_CONTRAST = 2.2;
/** How deep the edge band is, at the stored 80 px size. */
const RIM_PX = 8;
/** Outlined when at least this share of the edge band, and of the whole crest, is dark. */
export const DARK_SHARE = 0.5;
/**
 * Room for the outline at the stored 80 px size: the crest is shrunk by this much on each
 * side. The outline itself is solid for about 3.5 px there, with a soft outer edge.
 */
export const OUTLINE_PX = 5;
const OUTLINE_RGB = { r: 0xdf, g: 0xe6, b: 0xee };

const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/**
 * How dark a crest is against the dark background: the share of dark pixels within RIM_PX
 * of its edge (`rim`), and over all of it (`all`), each from 0 to 1.
 */
export async function crestDarkness(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  // Distance of each visible pixel from the nearest transparent one (or the image's border).
  const dist = new Int32Array(w * h).fill(1 << 30);
  const queue = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i * 4 + 3] < 128) { dist[i] = 0; queue.push(i); }
      else if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { dist[i] = 1; queue.push(i); }
    }
  }
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k];
    const x = i % w;
    const y = (i - x) / w;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (dist[j] > dist[i] + 1) { dist[j] = dist[i] + 1; queue.push(j); }
    }
  }
  let rim = 0, rimDark = 0, all = 0, allDark = 0;
  for (let i = 0; i < w * h; i++) {
    if (dist[i] < 1) continue;
    const dark = (luminance(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) + 0.05) / (BG_LUM + 0.05) < MIN_CONTRAST;
    all++;
    if (dark) allDark++;
    if (dist[i] <= RIM_PX) { rim++; if (dark) rimDark++; }
  }
  return { rim: rim ? rimDark / rim : 0, all: all ? allDark / all : 0 };
}

/** Whether a crest needs the light outline to read on the site's dark background. */
export const needsOutline = ({ rim, all }) => rim >= DARK_SHARE && all >= DARK_SHARE;

/**
 * The crest with a thin light outline around its shape, at the same size: the crest is
 * shrunk by `px` on each side so the outline fits inside the square.
 */
export async function outlineCrest(buf, px = OUTLINE_PX) {
  const { width: size } = await sharp(buf).metadata();
  const inner = await sharp(buf).resize(size - 2 * px, size - 2 * px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: px, bottom: px, left: px, right: px, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  // The shape grown by the outline: its alpha blurred, then strengthened so the blur's reach
  // is solid and its outer edge stays soft. Two passes: within one, sharp applies linear()
  // before blur() whatever the call order, which left only a faint glow.
  const blurred = await sharp(inner).extractChannel('alpha').blur(px * 0.4).png().toBuffer();
  const grown = await sharp(blurred).linear(4, 0).toBuffer();
  const outline = await sharp({ create: { width: size, height: size, channels: 3, background: OUTLINE_RGB } })
    .joinChannel(grown).png().toBuffer();
  return sharp(outline).composite([{ input: inner }])
    .webp({ quality: 82, alphaQuality: 90, effort: 6 })
    .toBuffer();
}
