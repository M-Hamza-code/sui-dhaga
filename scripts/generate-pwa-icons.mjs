// Phase 8 (Part A) — generates the two static PWA manifest icons
// (public/icon-192.png, public/icon-512.png) as plain PNG files.
//
// Originally these were rendered on-demand via next/og's ImageResponse
// (bundled with Next.js — no new dependency). That approach was
// abandoned: Next 14.2.15's bundled @vercel/og throws a reproducible
// "Invalid URL" error while resolving its own default font file's path
// on Windows (`.\file:\D:\...\noto-sans-v27-latin-regular.ttf` — a
// malformed file:// URL), independent of what JSX is rendered or
// whether the route is static or dynamic. That's a bug in a vendored
// third-party dependency, not fixable from application code.
//
// This script instead writes the PNG bytes directly using only Node's
// built-in `zlib` (for the DEFLATE-compressed image data) and a small
// hand-rolled CRC32 (the standard, public-domain table-based
// algorithm every PNG encoder uses) — no image-processing library
// (sharp/canvas/pngjs/etc.) needed, since none is present in this
// project and adding one solely for two static icons would be
// unnecessary weight.
//
// The design is the exact same simple, text-free stitching motif
// originally in pwa-icon.tsx (now removed): a solid fill in the app's
// existing "indigo" design-system color (tailwind.config.ts) with
// three horizontal bars in the existing "paper" color — not a new
// brand, not a redesign.
//
// Run with: node scripts/generate-pwa-icons.mjs
// Re-run any time the design needs to change; the output files are
// committed as plain static assets under public/, not generated at
// build or request time.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const INDIGO = [0x1f, 0x3a, 0x63];
const PAPER = [0xfb, 0xf7, 0xf0];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** Draws the icon's raw RGB pixel grid (no filter bytes yet). */
function drawPixels(size) {
  const pixels = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      pixels.set(INDIGO, (y * size + x) * 3);
    }
  }

  // Three simple horizontal "stitch" bars across the middle, in the
  // paper color — a plain, text-free, on-brand geometric mark (see
  // this file's own header for why not a rotated/text glyph design).
  const barHeight = Math.max(2, Math.round(size * 0.07));
  const barWidth = Math.round(size * 0.56);
  const shortBarWidth = Math.round(barWidth * 0.68);
  const gap = Math.round(size * 0.1);
  const totalHeight = barHeight * 3 + gap * 2;
  const startY = Math.round((size - totalHeight) / 2);
  const centerX = Math.round(size / 2);

  function fillBar(topY, width) {
    const left = centerX - Math.round(width / 2);
    for (let y = topY; y < topY + barHeight && y < size; y++) {
      if (y < 0) continue;
      for (let x = left; x < left + width && x < size; x++) {
        if (x < 0) continue;
        pixels.set(PAPER, (y * size + x) * 3);
      }
    }
  }

  fillBar(startY, barWidth);
  fillBar(startY + barHeight + gap, shortBarWidth);
  fillBar(startY + (barHeight + gap) * 2, barWidth);

  return pixels;
}

function encodePng(size) {
  const pixels = drawPixels(size);

  // Raw scanlines: each row prefixed with a filter-type byte (0 = None).
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 3);
    raw[rowStart] = 0; // filter type: None
    raw.set(pixels.subarray(y * size * 3, (y + 1) * size * 3), rowStart + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor (RGB, no alpha)
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  const idat = deflateSync(raw);

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

for (const size of [192, 512]) {
  const png = encodePng(size);
  const outPath = path.join(PUBLIC_DIR, `icon-${size}.png`);
  writeFileSync(outPath, png);
  console.log(`Wrote ${outPath} (${png.length} bytes)`);
}
