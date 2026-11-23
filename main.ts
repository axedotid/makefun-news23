// make.fun · news-image-20261123
// "One image summing up the world's news of 23 November 2026."
// Self-contained: fetches BBC RSS, renders a 1024x1024 newspaper front page
// as a PNG with a hand-rolled encoder (node:zlib deflate + CRC32) and a
// built-in 5x7 bitmap font. No npm dependencies.

import { deflateSync } from "node:zlib";
import { writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ----------------------------------------------------------------------------
// Feed configuration — breadth across regions AND fields.
// ----------------------------------------------------------------------------
const FEEDS: { tag: string; color: [number, number, number]; url: string }[] = [
  { tag: "WORLD",       color: [230, 120, 60],  url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { tag: "EUROPE",      color: [90, 160, 220],  url: "https://feeds.bbci.co.uk/news/world/europe/rss.xml" },
  { tag: "MIDDLE EAST", color: [220, 180, 70],  url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml" },
  { tag: "ASIA",        color: [110, 200, 150], url: "https://feeds.bbci.co.uk/news/world/asia/rss.xml" },
  { tag: "US & CANADA", color: [200, 120, 200], url: "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml" },
  { tag: "AFRICA",      color: [230, 150, 90],  url: "https://feeds.bbci.co.uk/news/world/africa/rss.xml" },
  { tag: "TECHNOLOGY",  color: [120, 210, 230], url: "https://feeds.bbci.co.uk/news/technology/rss.xml" },
  { tag: "SCIENCE",     color: [150, 210, 120], url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml" },
  { tag: "BUSINESS",    color: [240, 200, 90],  url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { tag: "HEALTH",      color: [230, 130, 150], url: "https://feeds.bbci.co.uk/news/health/rss.xml" },
];

type Headline = { title: string; date: string };

async function fetchFeed(url: string): Promise<Headline[]> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return [];
    const xml = await r.text();
    const items: Headline[] = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const block = m[1];
      const t = /<title>([\s\S]*?)<\/title>/.exec(block);
      const d = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(block);
      if (!t) continue;
      const title = t[1]
        .replace(/<!\[CDATA\[|\]\]>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      items.push({ title, date: d ? d[1].trim() : "" });
    }
    return items;
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------------------
// 5x7 bitmap font. Each glyph is 5 columns; each column is a 7-bit row mask
// (bit 0 = top row). Encoded as arrays of 5 column-bytes.
// ----------------------------------------------------------------------------
const GLYPHS: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0],
  "A": [0x7e, 0x11, 0x11, 0x11, 0x7e], "B": [0x7f, 0x49, 0x49, 0x49, 0x36],
  "C": [0x3e, 0x41, 0x41, 0x41, 0x22], "D": [0x7f, 0x41, 0x41, 0x22, 0x1c],
  "E": [0x7f, 0x49, 0x49, 0x49, 0x41], "F": [0x7f, 0x09, 0x09, 0x09, 0x01],
  "G": [0x3e, 0x41, 0x49, 0x49, 0x7a], "H": [0x7f, 0x08, 0x08, 0x08, 0x7f],
  "I": [0x00, 0x41, 0x7f, 0x41, 0x00], "J": [0x20, 0x40, 0x41, 0x3f, 0x01],
  "K": [0x7f, 0x08, 0x14, 0x22, 0x41], "L": [0x7f, 0x40, 0x40, 0x40, 0x40],
  "M": [0x7f, 0x02, 0x0c, 0x02, 0x7f], "N": [0x7f, 0x04, 0x08, 0x10, 0x7f],
  "O": [0x3e, 0x41, 0x41, 0x41, 0x3e], "P": [0x7f, 0x09, 0x09, 0x09, 0x06],
  "Q": [0x3e, 0x41, 0x51, 0x21, 0x5e], "R": [0x7f, 0x09, 0x19, 0x29, 0x46],
  "S": [0x46, 0x49, 0x49, 0x49, 0x31], "T": [0x01, 0x01, 0x7f, 0x01, 0x01],
  "U": [0x3f, 0x40, 0x40, 0x40, 0x3f], "V": [0x1f, 0x20, 0x40, 0x20, 0x1f],
  "W": [0x3f, 0x40, 0x38, 0x40, 0x3f], "X": [0x63, 0x14, 0x08, 0x14, 0x63],
  "Y": [0x07, 0x08, 0x70, 0x08, 0x07], "Z": [0x61, 0x51, 0x49, 0x45, 0x43],
  "0": [0x3e, 0x51, 0x49, 0x45, 0x3e], "1": [0x00, 0x42, 0x7f, 0x40, 0x00],
  "2": [0x42, 0x61, 0x51, 0x49, 0x46], "3": [0x21, 0x41, 0x45, 0x4b, 0x31],
  "4": [0x18, 0x14, 0x12, 0x7f, 0x10], "5": [0x27, 0x45, 0x45, 0x45, 0x39],
  "6": [0x3c, 0x4a, 0x49, 0x49, 0x30], "7": [0x01, 0x71, 0x09, 0x05, 0x03],
  "8": [0x36, 0x49, 0x49, 0x49, 0x36], "9": [0x06, 0x49, 0x49, 0x29, 0x1e],
  ".": [0x00, 0x60, 0x60, 0x00, 0x00], ",": [0x00, 0x50, 0x30, 0x00, 0x00],
  "'": [0x00, 0x07, 0x00, 0x00, 0x00], '"': [0x00, 0x07, 0x00, 0x07, 0x00],
  "-": [0x08, 0x08, 0x08, 0x08, 0x08], ":": [0x00, 0x36, 0x36, 0x00, 0x00],
  "!": [0x00, 0x00, 0x5f, 0x00, 0x00], "?": [0x02, 0x01, 0x51, 0x09, 0x06],
  "(": [0x00, 0x1c, 0x22, 0x41, 0x00], ")": [0x00, 0x41, 0x22, 0x1c, 0x00],
  "/": [0x20, 0x10, 0x08, 0x04, 0x02], "&": [0x36, 0x49, 0x79, 0x41, 0x30],
  "%": [0x23, 0x13, 0x08, 0x64, 0x62], "#": [0x14, 0x7f, 0x14, 0x7f, 0x14],
  "+": [0x08, 0x08, 0x3e, 0x08, 0x08], "=": [0x14, 0x14, 0x14, 0x14, 0x14],
  "*": [0x22, 0x14, 0x7f, 0x14, 0x22], ";": [0x00, 0x56, 0x36, 0x00, 0x00],
};

const GLYPH_W = 5, GLYPH_H = 7;

// ----------------------------------------------------------------------------
// Pixel buffer (RGBA) + drawing primitives.
// ----------------------------------------------------------------------------
const W = 1024, H = 1024;
const buf = new Uint8Array(W * H * 4);

function setPx(x: number, y: number, r: number, g: number, b: number): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
}

function fillRect(x: number, y: number, w: number, h: number, r: number, g: number, b: number): void {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) setPx(xx, yy, r, g, b);
}

function drawChar(ch: string, x: number, y: number, scale: number, r: number, g: number, b: number): void {
  const cols = GLYPHS[ch] ?? GLYPHS["?"];
  for (let cx = 0; cx < GLYPH_W; cx++) {
    const col = cols[cx];
    for (let cy = 0; cy < GLYPH_H; cy++) {
      if (col & (1 << cy)) {
        fillRect(x + cx * scale, y + cy * scale, scale, scale, r, g, b);
      }
    }
  }
}

function textWidth(s: string, scale: number): number {
  return s.length * (GLYPH_W + 1) * scale;
}

function drawText(s: string, x: number, y: number, scale: number, r: number, g: number, b: number): void {
  let cx = x;
  for (const ch of s.toUpperCase()) {
    drawChar(ch, cx, y, scale, r, g, b);
    cx += (GLYPH_W + 1) * scale;
  }
}

// Greedy word-wrap to a max pixel width. Returns the wrapped lines.
function wrapText(s: string, scale: number, maxW: number): string[] {
  const words = s.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (textWidth(test, scale) <= maxW) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      if (textWidth(w, scale) > maxW) {
        let piece = "";
        for (const c of w) {
          if (textWidth(piece + c, scale) > maxW) { lines.push(piece); piece = c; }
          else piece += c;
        }
        cur = piece;
      } else cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ----------------------------------------------------------------------------
// PNG encoding.
// ----------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBuf = Buffer.from(type, "ascii");
  const dataBuf = Buffer.from(data);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dataBuf.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, dataBuf])), 0);
  return Buffer.concat([len, typeBuf, dataBuf, crcBuf]);
}

function encodePNG(pixels: Uint8Array, width: number, height: number): Buffer {
  // Raw: each scanline prefixed with filter byte 0.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const compressed = deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

// ----------------------------------------------------------------------------
// Layout.
// ----------------------------------------------------------------------------
async function main(): Promise<void> {
  const results = await Promise.all(FEEDS.map(async (f) => ({ feed: f, items: await fetchFeed(f.url) })));

  // Background: warm newsprint.
  fillRect(0, 0, W, H, 238, 232, 214);

  // Header band.
  const HEADER_H = 250;
  fillRect(0, 0, W, HEADER_H, 22, 24, 30);
  fillRect(0, HEADER_H, W, 6, 200, 60, 50); // accent line

  // Masthead.
  drawText("THE WORLD IN ONE DAY", 40, 30, 4, 235, 235, 235);
  // Big date — the day must be unmistakable.
  drawText("23 NOVEMBER 2026", 40, 92, 9, 240, 200, 70);
  // Subtitle.
  drawText("A FRONT PAGE FROM EVERY CORNER OF THE GLOBE", 40, 200, 2, 170, 175, 185);

  // Grid of cards.
  const COLS = 2;
  const MARGIN = 40;
  const GAP = 30;
  const cardW = Math.floor((W - MARGIN * 2 - GAP * (COLS - 1)) / COLS);
  const top = HEADER_H + 6 + 30;
  const footerH = 60;
  const availH = H - top - footerH - 20;
  const rows = Math.ceil(FEEDS.length / COLS);
  const cardH = Math.floor((availH - GAP * (rows - 1)) / rows);

  // Headline scale 2 (not 3): with 5 rows of cards each card is short, and
  // scale 3 clipped headlines to a single ~22-char line. Scale 2 fits 2 lines
  // of ~34 chars, so a real sentence survives instead of a truncated stub.
  const HEAD_SCALE = 2;
  const TAG_SCALE = 2;
  const inner = 18;

  results.forEach((res, idx) => {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const x = MARGIN + col * (cardW + GAP);
    const y = top + row * (cardH + GAP);
    const [tr, tg, tb] = res.feed.color;

    // Card background + left accent bar + subtle borders.
    fillRect(x, y, cardW, cardH, 252, 250, 244);
    fillRect(x, y, 10, cardH, tr, tg, tb);
    fillRect(x, y, cardW, 2, 200, 195, 180);
    fillRect(x, y + cardH - 2, cardW, 2, 200, 195, 180);

    // Region tag.
    drawText(res.feed.tag, x + inner + 4, y + inner, TAG_SCALE, tr, tg, tb);

    // Headline: first item, wrapped + clipped to the card.
    const headline = res.items[0]?.title ?? "No headlines available";
    const maxTextW = cardW - inner * 2 - 8;
    const lines = wrapText(headline, HEAD_SCALE, maxTextW);
    const lineH = (GLYPH_H + 3) * HEAD_SCALE;
    const tagBlockH = (TAG_SCALE * (GLYPH_H + 2)) + 12;
    const maxLines = Math.max(1, Math.floor((cardH - inner * 2 - tagBlockH) / lineH));
    const shown = lines.slice(0, maxLines);
    let ty = y + inner + tagBlockH;
    for (const ln of shown) {
      drawText(ln, x + inner + 4, ty, HEAD_SCALE, 30, 30, 34);
      ty += lineH;
    }
  });

  // Footer.
  fillRect(0, H - footerH, W, footerH, 22, 24, 30);
  const foot = "MAKE.FUN - PICTURE OF THE DAY";
  const fw = textWidth(foot, 3);
  drawText(foot, Math.floor((W - fw) / 2), H - footerH + 18, 3, 240, 200, 70);

  // Encode + write.
  const png = encodePNG(buf, W, H);
  const outPath = process.argv[2] ?? "entry.png";
  writeFileSync(outPath, png);
  console.log(`wrote ${outPath}  ${png.length} bytes  (${(png.length / 1024).toFixed(1)} KiB)`);

  // make.fun convention: also drop into MAKEFUN_OUTPUT_DIR when set.
  const outDir = process.env.MAKEFUN_OUTPUT_DIR;
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    copyFileSync(outPath, join(outDir, "entry.png"));
    console.log(`copied to ${join(outDir, "entry.png")}`);
  }

  console.log("region tags:", FEEDS.map((f) => f.tag).join(", "));
  console.log("headlines fetched:", results.map((r) => `${r.feed.tag}=${r.items.length}`).join(" "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});