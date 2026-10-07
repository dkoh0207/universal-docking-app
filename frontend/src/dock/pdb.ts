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

const AD_ELEMENT: Record<string, string> = { A: "C", NA: "N", OA: "O", SA: "S", HD: "H", HS: "H", Cl: "CL", Br: "BR", Zn: "ZN", Mg: "MG", Mn: "MN", Fe: "FE", Ca: "CA" };

/** Heavy atoms (element + coordinates) of a PDB/PDBQT text. Atom names are not used: Open Babel 3.1 writes bare elements. */
export function heavyAtoms(text: string) {
  const atoms: { el: string; xyz: [number, number, number] }[] = [];
  for (const l of text.split("\n")) {
    if (!/^(ATOM {2}|HETATM)/.test(l)) continue;
    const type = (l.slice(77, 79).trim() || l.slice(76, 78).trim());
    const el = (AD_ELEMENT[type] ?? type).toUpperCase() || l.slice(12, 16).trim().replace(/\d/g, "")[0]?.toUpperCase() || "";
    if (el === "H" || !el) continue;
    atoms.push({ el, xyz: [+l.slice(30, 38), +l.slice(38, 46), +l.slice(46, 54)] });
  }
  return atoms;
}

/**
 * Symmetric RMSD between two heavy-atom sets, no superposition: every atom is paired with the nearest atom of the same
 * element in the other set, and both directions are pooled. This ignores atom naming and order, and so symmetric
 * ligands are not penalized; null unless the sets are the same size.
 */
export function rmsdNearest(pose: ReturnType<typeof heavyAtoms>, ref: ReturnType<typeof heavyAtoms>) {
  if (!ref.length || pose.length !== ref.length) return null;
  let sum = 0;
  const nearest = (a: (typeof ref)[number], set: typeof ref) => {
    let best = Infinity;
    for (const b of set) if (b.el === a.el) best = Math.min(best, (a.xyz[0] - b.xyz[0]) ** 2 + (a.xyz[1] - b.xyz[1]) ** 2 + (a.xyz[2] - b.xyz[2]) ** 2);
    return best;
  };
  for (const a of ref) sum += nearest(a, pose);
  for (const a of pose) sum += nearest(a, ref);
  return Number.isFinite(sum) ? Math.sqrt(sum / (ref.length + pose.length)) : null;
}

/** One Vina pose as plain PDB: AutoDock atom types (OA, HD, A…) become element symbols, which 3Dmol's pdbqt parser does not do. */
export function pdbqtToPdb(text: string): string {
  const out: string[] = [];
  for (const l of text.split("\n")) {
    if (!/^(ATOM {2}|HETATM)/.test(l)) continue;
    const type = l.slice(77, 79).trim();
    const elem = (AD_ELEMENT[type] ?? type).toUpperCase();
    out.push(l.slice(0, 66).padEnd(76) + elem.padStart(2));
  }
  out.push("END");
  return out.join("\n") + "\n";
}
