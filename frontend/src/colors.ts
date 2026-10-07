// Color tables and helpers modelled after PyMOL's named colors and palettes.

export const PYMOL_COLORS: Record<string, number> = {
  white: 0xffffff, black: 0x000000, grey: 0x808080, gray: 0x808080,
  red: 0xff0000, green: 0x00ff00, blue: 0x0000ff, yellow: 0xffff00,
  magenta: 0xff00ff, cyan: 0x00ffff, orange: 0xff8000, purple: 0xbf00bf,
  salmon: 0xffb299, deepsalmon: 0xff8066, raspberry: 0xb24c66, hotpink: 0xff0080,
  pink: 0xffa6a6, lightpink: 0xffbfd8, warmpink: 0xd84c72, ruby: 0x991a1a,
  firebrick: 0xb22222, chocolate: 0x7f4c19, brown: 0xa6804c, wheat: 0xd8d8a6,
  violet: 0xff80ff, deeppurple: 0x991a99, lightmagenta: 0xff33ff, violetpurple: 0x7f3fbf,
  skyblue: 0x3399e5, slate: 0x7f7fff, lightblue: 0xbfbfff, marine: 0x007fff,
  deepblue: 0x264c99, density: 0x1a1a99, purpleblue: 0x4c19e5, bluewhite: 0x8484ff,
  lightteal: 0xbfe5e5, aquamarine: 0x7fffbf, palecyan: 0xccffff, teal: 0x00bfbf,
  deepteal: 0x198c7f, forest: 0x33a619, limegreen: 0x00ff7f, lime: 0x7fff00,
  splitpea: 0x99bf7f, smudge: 0x99b24c, palegreen: 0xa6ffa6, tv_green: 0x33cc33,
  lightorange: 0xffcc7f, brightorange: 0xffb200, yelloworange: 0xffe519, olive: 0xbfb200,
  deepolive: 0x999919, sand: 0xbf8c66, tv_red: 0xff3333, tv_blue: 0x4d4dff,
  tv_yellow: 0xffff33, tv_orange: 0xff8c26,
  carbon: 0x33ff33, nitrogen: 0x3333ff, oxygen: 0xff4d4d, sulfur: 0xe6c640,
  hydrogen: 0xe6e6e6, phosphorus: 0xff8000,
  // theme-friendly extras
  azure: 0x3b82f6, sky: 0x38bdf8, indigo: 0x6366f1, navy: 0x0b1b3f, amber: 0xf59e0b, rose: 0xf43f5e,
};

// Element colors (PyMOL / Jmol-like). Carbon is overridden by the object/chain color.
export const ELEMENT_COLORS: Record<string, number> = {
  H: 0xe6e6e6, C: 0x33ff33, N: 0x3a5bff, O: 0xff4d4d, S: 0xe6c640, P: 0xff8000,
  F: 0xb3ffff, CL: 0x1ff01f, BR: 0xa62929, I: 0x940094, FE: 0xe06633, ZN: 0x7d80b0,
  MG: 0x8aff00, CA: 0x3dff00, NA: 0xab5cf2, K: 0x8f40d4, MN: 0x9c7ac7, CU: 0xc88033,
  CO: 0xf090a0, NI: 0x50d050, SE: 0xffa100, CD: 0xffd98f, HG: 0xb8b8d0, B: 0xffb5b5,
  LI: 0xcc80ff, AU: 0xffd123, PT: 0xd0d0e0, SI: 0xf0c8a0, AS: 0xbd80e3,
};
export const elementColor = (elem: string, carbon: number): number => {
  const e = (elem || "").toUpperCase();
  if (e === "C") return carbon;
  return ELEMENT_COLORS[e] ?? 0xff69b4;
};

// Blue-forward chain palette that matches the UI theme.
export const CHAIN_PALETTE = [
  0x3b82f6, 0x22d3ee, 0x8b5cf6, 0x2dd4bf, 0x6366f1, 0x7dd3fc,
  0xa78bfa, 0x0ea5e9, 0x5eead4, 0x818cf8, 0x93c5fd, 0x38bdf8,
];
export const LIGAND_CARBON = 0xf59e0b;

export const SS_COLORS = { h: 0x2563eb, s: 0xf59e0b, c: 0xcbd5e1 } as const;

const HYDRO: Record<string, number> = { // Eisenberg consensus scale
  ALA: 0.62, ARG: -2.53, ASN: -0.78, ASP: -0.9, CYS: 0.29, GLN: -0.85, GLU: -0.74,
  GLY: 0.48, HIS: -0.4, ILE: 1.38, LEU: 1.06, LYS: -1.5, MET: 0.64, PHE: 1.19,
  PRO: 0.12, SER: -0.18, THR: -0.05, TRP: 0.81, TYR: 0.26, VAL: 1.08,
};
export const hydrophobicity = (resn: string): number | undefined => HYDRO[resn.toUpperCase()];

export function residueTypeColor(resn: string): number {
  const r = resn.toUpperCase();
  if (["LYS", "ARG", "HIS"].includes(r)) return 0x3b82f6;
  if (["ASP", "GLU"].includes(r)) return 0xf43f5e;
  if (["SER", "THR", "ASN", "GLN", "CYS", "TYR"].includes(r)) return 0x34d399;
  if (["DA", "DC", "DG", "DT", "A", "C", "G", "U"].includes(r)) return 0xa78bfa;
  return 0xe2e8f0;
}

// Gradients: arrays of stops evenly spaced from 0 to 1.
export const GRADIENTS: Record<string, number[]> = {
  rainbow: [0x0000ff, 0x00ffff, 0x00ff00, 0xffff00, 0xff0000],
  rainbow_rev: [0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff],
  blue_red: [0x0000ff, 0xff0000],
  red_blue: [0xff0000, 0x0000ff],
  blue_white_red: [0x2563eb, 0xf8fafc, 0xe11d48],
  red_white_blue: [0xe11d48, 0xf8fafc, 0x2563eb],
  blue_green: [0x0000ff, 0x00ff00],
  green_red: [0x00ff00, 0xff0000],
  blue_white: [0x2563eb, 0xffffff],
  ocean: [0x0b1b3f, 0x1d4ed8, 0x38bdf8, 0xe0f2fe],
  hydro: [0x3b82f6, 0xf1f5f9, 0xf97316],
};

export function gradientColor(name: string, t: number): number {
  const stops = GRADIENTS[name] ?? GRADIENTS.rainbow;
  const x = Math.min(1, Math.max(0, isFinite(t) ? t : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mix(stops[i], stops[i + 1], x - i);
}

export function mix(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 255;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

export const toHex = (c: number) => "#" + c.toString(16).padStart(6, "0");

/** Parse PyMOL-ish color strings: names, #rrggbb, 0xrrggbb, grayNN, [r,g,b]. */
export function parseColor(input: string, custom: Record<string, number> = {}): number | null {
  const s = input.trim().toLowerCase().replace(/^['"]|['"]$/g, "");
  if (s in custom) return custom[s];
  if (s in PYMOL_COLORS) return PYMOL_COLORS[s];
  let m = s.match(/^(?:#|0x)([0-9a-f]{6})$/);
  if (m) return parseInt(m[1], 16);
  m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return parseInt(m[1].split("").map((c) => c + c).join(""), 16);
  m = s.match(/^gr[ae]y(\d{1,2})$/);
  if (m) { const v = Math.round((+m[1] / 99) * 255); return (v << 16) | (v << 8) | v; }
  m = s.match(/^\[\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\]$/);
  if (m) {
    const vals = [m[1], m[2], m[3]].map(Number);
    const scale = vals.some((v) => v > 1) ? 1 : 255;
    const [r, g, b] = vals.map((v) => Math.round(Math.min(255, v * scale)));
    return (r << 16) | (g << 8) | b;
  }
  return null;
}

// UI swatches (PyMOL names), in palette order
export const SWATCHES = [
  "azure", "skyblue", "marine", "slate", "lightblue", "deepblue", "teal", "aquamarine",
  "palegreen", "forest", "wheat", "lightorange", "salmon", "raspberry", "violet", "white", "grey50", "black",
];
