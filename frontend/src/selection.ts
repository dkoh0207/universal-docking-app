// A compact implementation of the PyMOL selection language.
// Evaluates an expression to a mask (Uint8Array) over the scene's global atom list.

import type { PAtom, PObject } from "./types";

export interface SelectionContext {
  atoms: PAtom[];
  objects: PObject[];
  namedSelection(name: string): Set<PAtom> | undefined;
}

export type Mask = Uint8Array;

const METALS = new Set(["LI", "NA", "K", "RB", "CS", "MG", "CA", "SR", "BA", "MN", "FE", "CO", "NI", "CU", "ZN", "CD", "HG", "PT", "AU", "AG", "AL", "GA", "MO", "W", "V", "CR"]);
const BACKBONE = new Set(["N", "CA", "C", "O", "OXT", "P", "OP1", "OP2", "OP3", "O5'", "C5'", "C4'", "C3'", "O3'", "H", "HA"]);

export class SelectionError extends Error {}

type Tok = string;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s*(\(|\)|<=|>=|<|>|=|!|&|\||[^\s()<>=!&|]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

export function evaluate(expr: string, ctx: SelectionContext): Mask {
  const p = new Parser(tokenize(expr), ctx);
  const mask = p.parseOr();
  if (p.peek() !== undefined) throw new SelectionError(`Unexpected token "${p.peek()}"`);
  return mask;
}

export const countMask = (m: Mask) => m.reduce((n, v) => n + v, 0);
export const maskAtoms = (m: Mask, ctx: SelectionContext) => ctx.atoms.filter((_, i) => m[i]);

/** Mask of atoms within `dist` Å of any atom in `target` (includes target atoms). */
export function withinMask(target: Mask, dist: number, ctx: SelectionContext): Mask {
  const atoms = ctx.atoms;
  const out = new Uint8Array(atoms.length);
  const cell = Math.max(dist, 1);
  const grid = new Map<string, PAtom[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < atoms.length; i++) {
    if (!target[i]) continue;
    const a = atoms[i];
    const k = key(a.x, a.y, a.z);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(a);
  }
  const d2 = dist * dist;
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    if (target[i]) { out[i] = 1; continue; }
    const cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell), cz = Math.floor(a.z / cell);
    search: for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!list) continue;
          for (const b of list) {
            const ex = a.x - b.x, ey = a.y - b.y, ez = a.z - b.z;
            if (ex * ex + ey * ey + ez * ez <= d2) { out[i] = 1; break search; }
          }
        }
  }
  return out;
}

function wildcardMatcher(values: string[], caseSensitive = false): (v: string) => boolean {
  const norm = (s: string) => (caseSensitive ? s : s.toUpperCase());
  const exact = new Set<string>();
  const patterns: RegExp[] = [];
  for (const raw of values) {
    const v = norm(raw);
    if (v.includes("*") || v.includes("?")) {
      patterns.push(new RegExp("^" + v.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$"));
    } else exact.add(v);
  }
  return (s) => {
    const v = norm(s ?? "");
    return exact.has(v) || patterns.some((p) => p.test(v));
  };
}

function resiMatcher(spec: string): (a: PAtom) => boolean {
  const parts = spec.split("+").filter(Boolean).map((p) => {
    const m = p.match(/^(-?\d+)[A-Za-z]?(?:[-:](-?\d+)[A-Za-z]?)?$/);
    if (!m) throw new SelectionError(`Bad residue spec "${p}"`);
    const lo = +m[1], hi = m[2] !== undefined ? +m[2] : lo;
    return [Math.min(lo, hi), Math.max(lo, hi)] as const;
  });
  return (a) => parts.some(([lo, hi]) => a.resi >= lo && a.resi <= hi);
}

class Parser {
  private i = 0;
  constructor(private toks: Tok[], private ctx: SelectionContext) {}

  peek(o = 0) { return this.toks[this.i + o]; }
  private next() {
    const t = this.toks[this.i++];
    if (t === undefined) throw new SelectionError("Unexpected end of selection");
    return t;
  }
  private kw(...names: string[]) {
    const t = this.peek()?.toLowerCase();
    if (t !== undefined && names.includes(t)) { this.i++; return true; }
    return false;
  }
  private num() {
    const t = this.next();
    const v = parseFloat(t);
    if (isNaN(v)) throw new SelectionError(`Expected number, got "${t}"`);
    return v;
  }
  private mask(pred: (a: PAtom) => boolean): Mask {
    const atoms = this.ctx.atoms;
    const m = new Uint8Array(atoms.length);
    for (let i = 0; i < atoms.length; i++) if (pred(atoms[i])) m[i] = 1;
    return m;
  }

  parseOr(): Mask {
    let left = this.parseAnd();
    while (this.kw("or", "|")) {
      const right = this.parseAnd();
      left = left.map((v, i) => v | right[i]);
    }
    return left;
  }

  private parseAnd(): Mask {
    let left = this.parsePrefix();
    while (this.kw("and", "&")) {
      const right = this.parsePrefix();
      left = left.map((v, i) => v & right[i]);
    }
    return left;
  }

  private parsePrefix(): Mask {
    if (this.kw("not", "!")) return this.parsePrefix().map((v) => 1 - v);
    if (this.kw("byres", "br.")) return this.expandBy(this.parsePrefix(), (a) => a.rid);
    if (this.kw("bychain", "bc.")) return this.expandBy(this.parsePrefix(), (a) => `${a.obj.name}|${a.chain}`);
    if (this.kw("byobject", "byobj", "bo.")) return this.expandBy(this.parsePrefix(), (a) => a.obj.name);
    if (this.kw("first")) { const m = this.parsePrefix(); const i = m.indexOf(1); const o = new Uint8Array(m.length); if (i >= 0) o[i] = 1; return o; }
    if (this.kw("last")) { const m = this.parsePrefix(); const i = m.lastIndexOf(1); const o = new Uint8Array(m.length); if (i >= 0) o[i] = 1; return o; }
    if (this.kw("neighbor", "nbr.")) {
      const m = this.parsePrefix();
      const out = new Uint8Array(m.length);
      this.ctx.atoms.forEach((a, i) => {
        if (!m[i]) return;
        const modelAtoms = (a.obj.model as unknown as { atoms: PAtom[] }).atoms;
        for (const b of a.bonds) { const n = modelAtoms[b]; if (n && !m[n.gid]) out[n.gid] = 1; }
      });
      return out;
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Mask {
    let m = this.parsePrimary();
    for (;;) {
      if (this.kw("around", "a.")) {
        const d = this.num();
        const w = withinMask(m, d, this.ctx);
        m = w.map((v, i) => (v && !m[i] ? 1 : 0));
      } else if (this.kw("expand", "x.")) {
        m = withinMask(m, this.num(), this.ctx);
      } else if (this.kw("within", "w.")) {
        const d = this.num();
        if (!this.kw("of")) throw new SelectionError('Expected "of" after within');
        const w = withinMask(this.parsePrefix(), d, this.ctx);
        m = m.map((v, i) => v & w[i]);
      } else if (this.kw("beyond", "be.")) {
        const d = this.num();
        if (!this.kw("of")) throw new SelectionError('Expected "of" after beyond');
        const w = withinMask(this.parsePrefix(), d, this.ctx);
        m = m.map((v, i) => (v && !w[i] ? 1 : 0));
      } else return m;
    }
  }

  private expandBy(m: Mask, key: (a: PAtom) => unknown): Mask {
    const keys = new Set<unknown>();
    this.ctx.atoms.forEach((a, i) => m[i] && keys.add(key(a)));
    return this.mask((a) => keys.has(key(a)));
  }

  private listArg(): string[] {
    return this.next().split("+").filter((s) => s.length);
  }

  private parsePrimary(): Mask {
    const raw = this.next();
    const t = raw.toLowerCase();
    if (t === "(") {
      const m = this.parseOr();
      if (this.next() !== ")") throw new SelectionError('Expected ")"');
      return m;
    }
    switch (t) {
      case "all": case "*": return this.mask(() => true);
      case "none": return this.mask(() => false);
      case "enabled": return this.mask((a) => a.obj.enabled);
      case "visible": case "v.": return this.mask((a) => a.obj.enabled && a.reps !== 0);
      case "hetatm": return this.mask((a) => a.hetflag);
      case "polymer": case "pol.": return this.mask((a) => a.cls === "protein" || a.cls === "nucleic");
      case "protein": case "polymer.protein": return this.mask((a) => a.cls === "protein");
      case "nucleic": case "polymer.nucleic": return this.mask((a) => a.cls === "nucleic");
      case "organic": case "org.": case "ligand": case "ligands": return this.mask((a) => a.cls === "organic");
      case "inorganic": case "ino.": return this.mask((a) => a.cls === "inorganic");
      case "solvent": case "sol.": case "water": case "waters": return this.mask((a) => a.cls === "solvent");
      case "hydrogens": case "h.": return this.mask((a) => a.elem.toUpperCase() === "H" || a.elem.toUpperCase() === "D");
      case "metals": return this.mask((a) => METALS.has(a.elem.toUpperCase()));
      case "backbone": case "bb.": return this.mask((a) => (a.cls === "protein" || a.cls === "nucleic") && BACKBONE.has(a.atom.toUpperCase()));
      case "sidechain": case "sc.": return this.mask((a) => a.cls === "protein" && !BACKBONE.has(a.atom.toUpperCase()));
      case "guide": return this.mask((a) => (a.cls === "protein" && a.atom === "CA") || (a.cls === "nucleic" && a.atom === "P"));
      case "donors": case "don.": return this.mask((a) => ["N", "O"].includes(a.elem.toUpperCase()) && !(a.cls === "protein" && a.atom === "O"));
      case "acceptors": case "acc.": return this.mask((a) => a.elem.toUpperCase() === "O" || (a.elem.toUpperCase() === "N" && a.cls !== "protein"));
      case "chain": case "c.": { const f = wildcardMatcher(this.listArg(), true); return this.mask((a) => f(a.chain)); }
      case "resn": case "r.": { const f = wildcardMatcher(this.listArg()); return this.mask((a) => f(a.resn)); }
      case "name": case "n.": { const f = wildcardMatcher(this.listArg()); return this.mask((a) => f(a.atom)); }
      case "elem": case "e.": { const f = wildcardMatcher(this.listArg()); return this.mask((a) => f(a.elem)); }
      case "resi": case "i.": { const f = resiMatcher(this.next()); return this.mask(f); }
      case "model": case "m.": case "object": case "o.": { const f = wildcardMatcher(this.listArg()); return this.mask((a) => f(a.obj.name)); }
      case "id": { const ids = new Set(this.listArg().map(Number)); return this.mask((a) => ids.has(a.serial)); }
      case "index": case "idx.": { const ids = new Set(this.listArg().map(Number)); return this.mask((a) => ids.has(a.index + 1)); }
      case "ss": {
        const v = new Set(this.next().toUpperCase().split("+"));
        const code = (a: PAtom) => (a.ss === "h" ? "H" : a.ss === "s" ? "S" : "L");
        return this.mask((a) => v.has(code(a)) || (v.has("") && code(a) === "L"));
      }
      case "b": case "q": {
        const op = this.next();
        const val = this.num();
        const get = (a: PAtom) => (t === "b" ? a.b : ((a as unknown as { q?: number }).q ?? 1));
        const cmp: Record<string, (x: number) => boolean> = {
          "<": (x) => x < val, ">": (x) => x > val, "=": (x) => Math.abs(x - val) < 1e-6,
          "<=": (x) => x <= val, ">=": (x) => x >= val,
        };
        if (!cmp[op]) throw new SelectionError(`Bad comparison "${op}"`);
        return this.mask((a) => cmp[op](get(a)));
      }
    }
    if (raw.includes("/")) return this.macro(raw);
    const named = this.ctx.namedSelection(raw);
    if (named) return this.mask((a) => named.has(a));
    const obj = this.ctx.objects.find((o) => o.name.toLowerCase() === t);
    if (obj) return this.mask((a) => a.obj === obj);
    throw new SelectionError(`Unknown selection keyword or name "${raw}"`);
  }

  /** PyMOL macro syntax: /object/segi/chain/resn`resi/name, or right-aligned without leading slash. */
  private macro(tok: string): Mask {
    let fields: (string | undefined)[];
    if (tok.startsWith("/")) {
      const p = tok.slice(1).split("/");
      fields = [p[0], p[1], p[2], p[3], p[4]];
    } else {
      const p = tok.split("/").reverse();
      fields = [p[4], p[3], p[2], p[1], p[0]];
    }
    const [objF, , chainF, resF, nameF] = fields.map((f) => (f && f.length ? f : undefined));
    const objM = objF ? wildcardMatcher(objF.split("+")) : null;
    const chainM = chainF ? wildcardMatcher(chainF.split("+"), true) : null;
    const nameM = nameF ? wildcardMatcher(nameF.split("+")) : null;
    let resnM: ((s: string) => boolean) | null = null;
    let resiM: ((a: PAtom) => boolean) | null = null;
    if (resF) {
      const [rn, ri] = resF.includes("`") ? resF.split("`") : /^-?\d/.test(resF) ? [undefined, resF] : [resF, undefined];
      if (rn) resnM = wildcardMatcher(rn.split("+"));
      if (ri) resiM = resiMatcher(ri);
    }
    return this.mask((a) =>
      (!objM || objM(a.obj.name)) && (!chainM || chainM(a.chain)) && (!resnM || resnM(a.resn)) &&
      (!resiM || resiM(a)) && (!nameM || nameM(a.atom)));
  }
}
