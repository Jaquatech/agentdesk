/** Office looks, chosen in Settings. Every colour of the scene comes from here. */
export type OfficeStyle = {
  label: string;
  wall: string; wallTrim: string; wallShadow: string;
  floorA: string; floorB: string; floorLine: string;
  rug: string; rugEdge: string;
  desk: string; deskTop: string; deskEdge: string;
  sofa: string; sofaDark: string;
  plant: string; plantDark: string; pot: string;
  window: string; windowFrame: string; sky: [string, string];
  sign: string; signText: string;
  lamp: string;
  backdrop: string;
  dark?: boolean;
};

export const OFFICE_STYLES: Record<string, OfficeStyle> = {
  nordic: {
    label: "Nordic studio",
    wall: "#e9e4d8", wallTrim: "#cfc6b3", wallShadow: "#d8d0bf",
    floorA: "#c9a77c", floorB: "#c19f73", floorLine: "#ae8b61",
    rug: "#9fb7b1", rugEdge: "#86a09a",
    desk: "#e6dcc9", deskTop: "#f3ecdf", deskEdge: "#bfb29b",
    sofa: "#5f7f8f", sofaDark: "#4b6774",
    plant: "#4f8a54", plantDark: "#3a6a3f", pot: "#d9d2c3",
    window: "#bfe0f2", windowFrame: "#ffffff", sky: ["#bfe0f2", "#e8f4fa"],
    sign: "#2f6f6a", signText: "#ffffff",
    lamp: "#e8b04b",
    backdrop: "#1b201d",
  },
  startup: {
    label: "Startup loft",
    wall: "#9a5b45", wallTrim: "#7d4635", wallShadow: "#86503c",
    floorA: "#8d9093", floorB: "#868a8d", floorLine: "#777b7e",
    rug: "#2f3b4a", rugEdge: "#24303d",
    desk: "#3b3f45", deskTop: "#4b5058", deskEdge: "#2a2d31",
    sofa: "#d9a441", sofaDark: "#b98a33",
    plant: "#5a9a4c", plantDark: "#42783a", pot: "#2b2b2b",
    window: "#9ec9e6", windowFrame: "#2a2a2a", sky: ["#9ec9e6", "#d6ebf7"],
    sign: "#ff4f8b", signText: "#ffffff",
    lamp: "#ff4f8b",
    backdrop: "#151515",
  },
  cozy: {
    label: "Cozy library",
    wall: "#2f4a3c", wallTrim: "#243a2f", wallShadow: "#28402f",
    floorA: "#7a4e33", floorB: "#734930", floorLine: "#5f3c27",
    rug: "#8a3b37", rugEdge: "#70302d",
    desk: "#5b3a26", deskTop: "#6e4830", deskEdge: "#45291a",
    sofa: "#7a2f2c", sofaDark: "#5f2422",
    plant: "#5a8b4f", plantDark: "#3f6a37", pot: "#a0603a",
    window: "#f3c97a", windowFrame: "#3b2a1c", sky: ["#f0b765", "#f7dca3"],
    sign: "#c9a24b", signText: "#2a1d12",
    lamp: "#f3c97a",
    backdrop: "#140f0b",
  },
  night: {
    label: "Night shift",
    wall: "#232a45", wallTrim: "#1a2036", wallShadow: "#1e2540",
    floorA: "#2d3350", floorB: "#2a304b", floorLine: "#22283f",
    rug: "#3a2f5c", rugEdge: "#2e254a",
    desk: "#3a4163", deskTop: "#454d73", deskEdge: "#2b3150",
    sofa: "#5b3f8c", sofaDark: "#47316d",
    plant: "#3f7a6a", plantDark: "#2d5c4f", pot: "#1c2033",
    window: "#0e1430", windowFrame: "#3a4163", sky: ["#0b1029", "#1d2552"],
    sign: "#4fd1c5", signText: "#0d1225",
    lamp: "#4fd1c5",
    backdrop: "#080a14",
    dark: true,
  },
};

export const SHIRTS = ["#d0573f", "#3f7fd0", "#4f9a5a", "#c98b2e", "#8a5bc8", "#2f8f8a", "#c84f8a", "#5b6b7a", "#e0c34a", "#3a3f4b"];
export const HAIRS = ["#2b1d14", "#5a3a22", "#a8743c", "#d9b45a", "#1c1c1c", "#8c8c8c", "#b5462f", "#e8e0d0"];
export const SKINS = ["#f2d3b8", "#e3b48f", "#c98d63", "#9a6440", "#6b4329", "#f6dfcd"];

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export type Look = { shirt: string; hair: string; skin: string; hairStyle: number };

/** Look from the agent's saved appearance; anything unset is derived from the name, so it stays stable. */
export function lookFor(name: string, appearance: Partial<Look>): Look {
  const h = hashString(name);
  return {
    shirt: appearance.shirt || SHIRTS[h % SHIRTS.length],
    hair: appearance.hair || HAIRS[(h >>> 4) % HAIRS.length],
    skin: appearance.skin || SKINS[(h >>> 8) % SKINS.length],
    hairStyle: appearance.hairStyle ?? (h >>> 12) % 4,
  };
}
