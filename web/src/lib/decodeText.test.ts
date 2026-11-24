import { describe, it, expect } from "vitest";
import { decodeText } from "./decodeText.ts";

const buf = (bytes: number[]): ArrayBuffer => new Uint8Array(bytes).buffer;
const utf16 = (s: string, le: boolean): number[] =>
  [...s].flatMap((ch) => { const c = ch.charCodeAt(0); return le ? [c & 255, c >> 8] : [c >> 8, c & 255]; });

describe("decodeText", () => {
  it("reads plain UTF-8", () => {
    const bytes = new TextEncoder().encode("äöå").buffer as ArrayBuffer;
    expect(decodeText(bytes)).toEqual({ text: "äöå", encoding: "utf-8" });
  });

  it("removes a UTF-8 BOM", () => {
    const bytes = [0xef, 0xbb, 0xbf, ...new TextEncoder().encode("äöå")];
    expect(decodeText(buf(bytes))).toEqual({ text: "äöå", encoding: "utf-8-bom" });
  });

  it("reads UTF-16LE with BOM", () => {
    expect(decodeText(buf([0xff, 0xfe, ...utf16("äöå", true)]))).toEqual({ text: "äöå", encoding: "utf-16le" });
  });

  it("reads UTF-16BE with BOM", () => {
    expect(decodeText(buf([0xfe, 0xff, ...utf16("äöå", false)]))).toEqual({ text: "äöå", encoding: "utf-16be" });
  });

  it("falls back to Windows-1252", () => {
    // K ä y t t ä j ä with ä = 0xE4
    const bytes = [0x4b, 0xe4, 0x79, 0x74, 0x74, 0xe4, 0x6a, 0xe4];
    expect(decodeText(buf(bytes))).toEqual({ text: "Käyttäjä", encoding: "windows-1252" });
  });

  it("reads an empty buffer as UTF-8", () => {
    expect(decodeText(new ArrayBuffer(0))).toEqual({ text: "", encoding: "utf-8" });
  });
});
