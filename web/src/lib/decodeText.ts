export type TextEncodingName = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "windows-1252";

/** Decode file bytes: BOMs first, then strict UTF-8, otherwise Windows-1252 (ANSI). */
export function decodeText(bytes: ArrayBuffer): { text: string; encoding: TextEncodingName } {
  const b = new Uint8Array(bytes);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(b.subarray(3)), encoding: "utf-8-bom" };
  }
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(b.subarray(2)), encoding: "utf-16le" };
  }
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(b.subarray(2)), encoding: "utf-16be" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(b), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(b), encoding: "windows-1252" };
  }
}
