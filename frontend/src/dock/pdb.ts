// PDB / PDBQT text helpers for the docking page.

import type { PAtom } from "../types";

/** Serialize atoms as PDB text (ATOM for polymers, HETATM otherwise); duplicate atom names in a residue are dropped. */
export function toPdb(atoms: PAtom[]): string {
  const out: string[] = [];
  const seen = new Set<string>();
  let serial = 0;
  let prev = "";
  for (const a of atoms) {
    const res = `${a.obj.name}|${a.chain}|${a.resi}|${a.icode ?? ""}`;
    const key = `${res}|${a.atom}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (prev && a.chain !== prev && out.length) out.push("TER");
    prev = a.chain;
    const elem = (a.elem || a.atom[0]).toUpperCase();
    const name = elem.length === 1 && a.atom.length < 4 ? ` ${a.atom}`.padEnd(4) : a.atom.padEnd(4).slice(0, 4);
    const kind = a.cls === "protein" || a.cls === "nucleic" ? "ATOM  " : "HETATM";
    const f = (v: number) => v.toFixed(3).padStart(8);
    out.push(
      `${kind}${String((++serial) % 100000).padStart(5)} ${name} ${a.resn.padEnd(3).slice(0, 3)} ${(a.chain || " ").slice(0, 1)}` +
      `${String(a.resi).padStart(4)}${a.icode || " "}   ${f(a.x)}${f(a.y)}${f(a.z)}  1.00${(a.b ?? 0).toFixed(2).padStart(6)}          ${elem.padStart(2)}`,
    );
  }
  out.push("END");
  return out.join("\n") + "\n";
}

/** Bounding box of atoms: center and extent per axis. */
export function bounds(atoms: { x: number; y: number; z: number }[]) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const a of atoms) [a.x, a.y, a.z].forEach((v, i) => { lo[i] = Math.min(lo[i], v); hi[i] = Math.max(hi[i], v); });
  return { center: lo.map((v, i) => (v + hi[i]) / 2), extent: lo.map((v, i) => hi[i] - v) };
}

/** Split Vina's multi-model output into one PDBQT text per mode. */
export function splitModels(pdbqt: string): string[] {
  const models: string[] = [];
  let cur: string[] = [];
  for (const line of pdbqt.split(/\r?\n/)) {
    cur.push(line);
    if (line.startsWith("ENDMDL")) { models.push(cur.join("\n") + "\n"); cur = []; }
  }
  return models;
}

/** Heavy-atom coordinates of a PDB/PDBQT text, by atom name. */
export function heavyByName(text: string) {
  const m = new Map<string, [number, number, number]>();
  for (const l of text.split("\n")) {
    if (!/^(ATOM  |HETATM)/.test(l)) continue;
    const name = l.slice(12, 16).trim();
    const type = l.slice(77, 79).trim().toUpperCase() || l.slice(76, 78).trim().toUpperCase();
    if (type === "H" || type === "HD" || (!type && name.startsWith("H"))) continue;
    if (!m.has(name)) m.set(name, [+l.slice(30, 38), +l.slice(38, 46), +l.slice(46, 54)]);
  }
  return m;
}

/** RMSD between two atom sets matched by name (no superposition); null unless most atoms match. */
export function rmsdByName(pose: ReturnType<typeof heavyByName>, ref: ReturnType<typeof heavyByName>) {
  let n = 0, sum = 0;
  for (const [k, r] of ref) {
    const p = pose.get(k);
    if (!p) continue;
    n++;
    sum += (p[0] - r[0]) ** 2 + (p[1] - r[1]) ** 2 + (p[2] - r[2]) ** 2;
  }
  return n && n >= 0.8 * ref.size ? Math.sqrt(sum / n) : null;
}

const AD_ELEMENT: Record<string, string> = { A: "C", NA: "N", OA: "O", SA: "S", HD: "H", HS: "H", Cl: "CL", Br: "BR", Zn: "ZN", Mg: "MG", Mn: "MN", Fe: "FE", Ca: "CA" };

/** One Vina pose as plain PDB: AutoDock atom types (OA, HD, A…) become element symbols, which 3Dmol's pdbqt parser does not do. */
export function pdbqtToPdb(text: string): string {
  const out: string[] = [];
  for (const l of text.split("\n")) {
    if (!/^(ATOM  |HETATM)/.test(l)) continue;
    const type = l.slice(77, 79).trim();
    const elem = (AD_ELEMENT[type] ?? type).toUpperCase();
    out.push(l.slice(0, 66).padEnd(76) + elem.padStart(2));
  }
  out.push("END");
  return out.join("\n") + "\n";
}
