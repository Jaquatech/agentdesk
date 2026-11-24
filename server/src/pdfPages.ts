import { deflateSync } from "node:zlib";
import { PDFiumLibrary } from "@hyzyla/pdfium";

/**
 * Pages of a PDF as PNG images, for a vision model that reads scanned pages.
 * Rendering uses @hyzyla/pdfium (MIT, no dependencies). Nothing calls this yet.
 */

export type RenderedPage = { page: number; width: number; height: number; png: Buffer };
export type RenderedPages = { pages: RenderedPage[]; total: number };

/** Scale of the first render: about 108 dpi for a 72 dpi page. */
const BASE_SCALE = 1.5;
/** A page larger than this on its longest side is rendered again smaller, to bound image tokens. */
const MAX_SIDE = 2000;
const DEFAULT_MAX_PAGES = 10;
const MIN_MAX_PAGES = 1;
const MAX_MAX_PAGES = 50;

function clampMaxPages(maxPages: number): number {
  if (!Number.isFinite(maxPages)) return DEFAULT_MAX_PAGES;
  return Math.min(MAX_MAX_PAGES, Math.max(MIN_MAX_PAGES, Math.round(maxPages)));
}

/**
 * Render the first `maxPages` pages (1..50) of a PDF to PNG. `page` in the result is 1-based.
 * A document that cannot be opened rejects with the library's error.
 */
export async function renderPdfPages(bytes: Buffer, maxPages: number): Promise<RenderedPages> {
  const limit = clampMaxPages(maxPages);
  const lib = await PDFiumLibrary.init();
  try {
    const doc = await lib.loadDocument(bytes);
    try {
      const total = doc.getPageCount();
      const count = Math.min(total, limit);
      const pages: RenderedPage[] = [];
      for (let index = 0; index < count; index++) {
        const page = doc.getPage(index);
        const first = await page.render({ scale: BASE_SCALE, render: "bitmap" });
        const longest = Math.max(first.width, first.height);
        const shot = longest > MAX_SIDE
          ? await page.render({ scale: (BASE_SCALE * MAX_SIDE) / longest, render: "bitmap" })
          : first;
        pages.push({
          page: index + 1,
          width: shot.width,
          height: shot.height,
          png: encodePng(shot.width, shot.height, shot.data),
        });
      }
      return { pages, total };
    } finally {
      doc.destroy();
    }
  } finally {
    lib.destroy();
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * Encode 4-byte pixels as an 8-bit RGB PNG. The input is RGBA, which is the byte order
 * `@hyzyla/pdfium` returns (checked: a red fill comes out red); the alpha byte is dropped.
 * Every row uses filter type 0 (none).
 */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("PNG size must be whole numbers above zero");
  }
  if (rgba.length < width * height * 4) throw new Error("PNG pixel data is shorter than the size");

  const rowBytes = width * 3 + 1;
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    let out = y * rowBytes;
    raw[out++] = 0;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      raw[out++] = rgba[src];
      raw[out++] = rgba[src + 1];
      raw[out++] = rgba[src + 2];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  header[10] = 0; // compression
  header[11] = 0; // filter method
  header[12] = 0; // interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
