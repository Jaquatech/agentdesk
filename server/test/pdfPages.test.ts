import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodePng, renderPdfPages } from "../src/pdfPages.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, "fixtures", "attachments", name));

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("renderPdfPages", () => {
  it("renders the first page only when maxPages is 1, and reports the total", async () => {
    const result = await renderPdfPages(fixture("sample.pdf"), 1);
    expect(result.total).toBe(2);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].page).toBe(1);
  });

  it("renders every page when maxPages is above the page count", async () => {
    const result = await renderPdfPages(fixture("sample.pdf"), 5);
    expect(result.total).toBe(2);
    expect(result.pages).toHaveLength(2);
  });

  it("clamps a zero or NaN maxPages instead of throwing", async () => {
    const zero = await renderPdfPages(fixture("scan.pdf"), 0);
    expect(zero.pages).toHaveLength(1);
    const nan = await renderPdfPages(fixture("scan.pdf"), Number.NaN);
    expect(nan.pages).toHaveLength(1);
  });

  it("returns PNG images whose header matches the reported size, within 2000 px", async () => {
    const result = await renderPdfPages(fixture("sample.pdf"), 2);
    for (const page of result.pages) {
      expect(page.png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
      expect(page.png.readUInt32BE(16)).toBe(page.width);
      expect(page.png.readUInt32BE(20)).toBe(page.height);
      expect(page.width).toBeGreaterThan(0);
      expect(page.height).toBeGreaterThan(0);
      expect(page.width).toBeLessThanOrEqual(2000);
      expect(page.height).toBeLessThanOrEqual(2000);
    }
  });

  it("keeps colours: a red fill comes out red", async () => {
    const content = "1 0 0 rg 10 10 100 100 re f";
    const pdf = [
      "%PDF-1.4",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 120 120] /Contents 4 0 R >> endobj",
      `4 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`,
      "trailer << /Root 1 0 R >>",
      "%%EOF",
    ].join("\n");
    const result = await renderPdfPages(Buffer.from(pdf, "latin1"), 1);
    const png = result.pages[0].png;
    // IDAT length is at byte 33 (8-byte signature + 25-byte IHDR chunk); its data starts at 41.
    const raw = inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)));
    const centre = 1 + Math.floor(result.pages[0].height / 2) * (result.pages[0].width * 3 + 1)
      + Math.floor(result.pages[0].width / 2) * 3;
    expect([...raw.subarray(centre, centre + 3)]).toEqual([255, 0, 0]);
  });

  it("rejects a file that is not a PDF", async () => {
    await expect(renderPdfPages(Buffer.from("not a pdf"), 1)).rejects.toThrow();
  });
});

describe("encodePng", () => {
  it("writes a 2x2 RGB PNG whose inflated rows are filter byte plus 6 bytes each", () => {
    const pixels = Buffer.from([
      1, 2, 3, 255, 4, 5, 6, 255,
      7, 8, 9, 255, 10, 11, 12, 255,
    ]);
    const png = encodePng(2, 2, pixels);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(2);
    const idatLength = png.readUInt32BE(33);
    expect(png.subarray(37, 41).toString("ascii")).toBe("IDAT");
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    expect(raw.length).toBe(2 * (1 + 6));
    expect(raw[0]).toBe(0);
    expect([...raw.subarray(1, 7)]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(raw[7]).toBe(0);
    expect([...raw.subarray(8, 14)]).toEqual([7, 8, 9, 10, 11, 12]);
  });
});
