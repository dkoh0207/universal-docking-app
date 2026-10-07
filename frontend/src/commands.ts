// PyMOL command interpreter. Both the console and every UI control go through here,
// so each button click is logged as the equivalent PyMOL command.

import {
  GRADIENTS, PYMOL_COLORS, SS_COLORS, elementColor, gradientColor, hydrophobicity, parseColor, residueTypeColor, toHex,
} from "./colors";
import { fetchStructure, isPdbId } from "./rcsb";
import { SelectionError, countMask, evaluate, type Mask } from "./selection";
import { ALL_REPS, REP, REP_ALIASES, type PAtom, type PObject, type Settings } from "./types";
import { dist, type Scene } from "./viewer";

export type LogKind = "cmd" | "out" | "err" | "ok";
export interface Hooks {
  log(text: string, kind?: LogKind): void;
  loaded?(obj: PObject): void;
  download?(filename: string, dataUrl: string): void;
  clearLog?(): void;
}

type Fn = (args: string[], kw: Record<string, string>) => void | string | Promise<void | string>;
interface Cmd { usage: string; help: string; fn: Fn; group: string }

const CARBON_UTILS: Record<string, string> = {
  cbag: "green", cbac: "cyan", cbam: "lightmagenta", cbay: "yellow", cbas: "salmon", cbaw: "grey90",
  cbab: "slate", cbao: "brightorange", cbap: "purple", cbak: "pink", cbaz: "azure",
};

export class Interpreter {
  readonly commands = new Map<string, Cmd>();
  readonly aliases = new Map<string, string>();

  constructor(private scene: Scene, private hooks: Hooks) {
    this.register();
  }

  /** Run one line (may contain several commands separated by ';'). Returns false on error. */
  async run(line: string, echo = true): Promise<boolean> {
    const parts = splitTop(line, ";").map((s) => s.trim()).filter(Boolean);
    let ok = true;
    for (const part of parts) {
      if (part.startsWith("#")) continue;
      if (echo) this.hooks.log(part, "cmd");
      try {
        const out = await this.exec(part);
        if (out) this.hooks.log(out, "out");
      } catch (e) {
        ok = false;
        const msg = e instanceof SelectionError ? `Selector-Error: ${e.message}` : e instanceof Error ? e.message : String(e);
        this.hooks.log(msg, "err");
      }
    }
    return ok;
  }

  private async exec(text: string) {
    let name: string, rest: string;
    const call = text.match(/^(?:cmd\.)?([\w.]+)\s*\((.*)\)\s*$/s);
    if (call) { name = call[1]; rest = call[2]; }
    else {
      const m = text.match(/^([\w.]+)\s*(.*)$/s);
      if (!m) throw new Error(`Invalid command: ${text}`);
      name = m[1]; rest = m[2];
    }
    name = name.toLowerCase();
    name = this.aliases.get(name) ?? name;
    const cmd = this.commands.get(name);
    if (!cmd) throw new Error(`Unknown command "${name}". Type "help" for a list.`);
    const args: string[] = [];
    const kw: Record<string, string> = {};
    for (const raw of rest.trim() ? splitTop(rest, ",") : []) {
      const a = raw.trim();
      const m = a.match(/^([a-z_]\w*)\s*=\s*(.+)$/i);
      if (m && !/[<>]/.test(a)) kw[m[1].toLowerCase()] = unquote(m[2]);
      else args.push(unquote(a));
    }
    return cmd.fn(args, kw);
  }

  completions(prefix: string) {
    const p = prefix.toLowerCase();
    return [...this.commands.keys(), ...this.aliases.keys()].filter((c) => c.startsWith(p)).sort();
  }

  // ---------------------------------------------------------------- helpers
  private sel(expr: string | undefined, fallback = "all"): Mask {
    const e = expr && expr.trim() ? expr : fallback;
    return evaluate(e, this.scene);
  }
  private needAtoms(m: Mask, expr: string) {
    const n = countMask(m);
    if (!n) throw new Error(`Selection "${expr}" matches no atoms`);
    return n;
  }
  private repBits(name: string | undefined) {
    const r = REP_ALIASES[(name ?? "").toLowerCase()];
    if (!r) return null;
    if (r === "everything") return ALL_REPS;
    if (r === "labels") return -1;
    return REP[r];
  }
  private color(name: string) {
    const c = parseColor(name, this.scene.customColors);
    if (c === null) throw new Error(`Unknown color "${name}"`);
    return c;
  }
  private def(name: string, group: string, usage: string, help: string, fn: Fn, ...aliases: string[]) {
    this.commands.set(name, { usage, help, fn, group });
    for (const a of aliases) this.aliases.set(a, name);
  }

  private colorAtomic(m: Mask) {
    this.scene.colorAtoms(m, (a) => (a.elem.toUpperCase() === "C" ? undefined : elementColor(a.elem, a.color)));
  }

  private chainbow(m: Mask, palette = "rainbow") {
    const groups = new Map<string, PAtom[]>();
    for (const a of this.scene.atomsOf(m)) {
      const k = a.obj.name + "|" + a.chain;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(a);
    }
    const color = new Map<PAtom, number>();
    for (const atoms of groups.values()) {
      const rids = [...new Set(atoms.map((a) => a.rid))];
      const idx = new Map(rids.map((r, i) => [r, i]));
      for (const a of atoms) color.set(a, gradientColor(palette, rids.length > 1 ? idx.get(a.rid)! / (rids.length - 1) : 0));
    }
    this.scene.colorAtoms(m, (a) => color.get(a));
  }

  private measureArgs(args: string[], n: number, prefix: string) {
    if (args.length >= n + 1) return { name: args[0], sels: args.slice(1, n + 1) };
    if (args.length === n) return { name: this.scene.nextMeasureName(prefix), sels: args };
    throw new Error(`Expected ${n} selections`);
  }
  private single(expr: string) {
    const atoms = this.scene.atomsOf(this.sel(expr));
    if (!atoms.length) throw new Error(`Selection "${expr}" matches no atoms`);
    return atoms[0];
  }

  /** Find atom pairs between two sets (mode 2 = polar contacts N/O only). */
  private pairs(A: PAtom[], B: PAtom[], cutoff: number, polar: boolean) {
    const isPolar = (a: PAtom) => ["N", "O"].includes(a.elem.toUpperCase());
    if (polar) { A = A.filter(isPolar); B = B.filter(isPolar); }
    const out: PAtom[][] = [];
    const seen = new Set<string>();
    const bb = new Set(["N", "O", "C", "CA", "OXT"]);
    for (const a of A) for (const b of B) {
      if (a === b) continue;
      const d = dist(a, b);
      if (d > cutoff || d < (polar ? 2.2 : 0.01)) continue;
      if (polar) {
        if (a.rid === b.rid) continue;
        if (a.obj === b.obj && a.chain === b.chain && Math.abs(a.resi - b.resi) === 1 && bb.has(a.atom) && bb.has(b.atom)) continue;
        if (a.cls === "solvent" && b.cls === "solvent") continue;
      }
      const k = a.gid < b.gid ? `${a.gid}-${b.gid}` : `${b.gid}-${a.gid}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push([a, b]);
      if (out.length >= 3000) return out;
    }
    return out;
  }

  // ---------------------------------------------------------------- commands
  private register() {
    const s = this.scene;

    // ---- loading
    this.def("fetch", "Loading", "fetch code [, name]", "Download a structure from the RCSB PDB.", async (a) => {
      const code = a[0];
      if (!code || !isPdbId(code)) throw new Error("Usage: fetch <4-character PDB ID>");
      const name = (a[1] || code).toLowerCase();
      const { data, format, source } = await fetchStructure(code);
      const obj = s.addObject(name, data, format, code.toUpperCase());
      this.hooks.loaded?.(obj);
      return `Fetched ${code.toUpperCase()} from ${source} as "${name}" (${obj.atoms.length} atoms)`;
    });
    this.def("load", "Loading", "load (use the Upload button)", "Load a local file (.pdb, .cif, .sdf, .mol2, .xyz) via upload or drag & drop.", () => {
      throw new Error("Browsers can't read local paths — use the Upload button or drag a file onto the viewer.");
    });
    this.def("delete", "Loading", "delete name", "Delete an object, selection or measurement (or 'all').", (a) => {
      const n = a[0];
      if (!n) throw new Error("Usage: delete name");
      if (n === "all" || n === "*") { s.deleteAll(); [...s.measurements].forEach((m) => s.deleteMeasurement(m.name)); return; }
      if (s.deleteObject(n) || s.deleteSelection(n) || s.deleteMeasurement(n)) return;
      throw new Error(`No object or selection named "${n}"`);
    });
    this.def("remove", "Loading", "remove selection", "Permanently remove atoms.", (a) => {
      const m = this.sel(a[0], "none");
      return `Remove: eliminated ${s.removeAtoms(m)} atoms.`;
    });
    this.def("reinitialize", "Loading", "reinitialize", "Delete everything and restore default settings.", () => {
      s.deleteAll();
      [...s.measurements].forEach((m) => s.deleteMeasurement(m.name));
      for (const [k, v] of Object.entries({ outline: false, fog: true, orthoscopic: false, bg_color: null })) s.set(k as keyof Settings, v as never);
    });

    // ---- display
    this.def("show", "Display", "show [representation [, selection]]", "Turn on a representation (cartoon, sticks, lines, spheres, surface, mesh, ribbon, nonbonded, ballstick).", (a) => {
      const bits = this.repBits(a[0] ?? "lines");
      if (bits === null) throw new Error(`Unknown representation "${a[0]}"`);
      if (bits === -1) return "Use the label command to create labels.";
      s.show(bits, this.sel(a[1]));
    });
    this.def("hide", "Display", "hide [representation [, selection]]", "Turn off a representation (default: everything).", (a) => {
      let bits = this.repBits(a[0] ?? "everything");
      let expr = a[1];
      if (bits === null) { bits = ALL_REPS; expr = a[0]; }
      const m = this.sel(expr);
      if (bits === -1 || bits === ALL_REPS) s.atomsOf(m).forEach((at) => s.hasLabel(at) && s.setLabel(at, null));
      if (bits !== -1) s.hide(bits, m);
    });
    this.def("as", "Display", "as representation [, selection]", "Show only this representation.", (a) => {
      const bits = this.repBits(a[0]);
      if (bits === null || bits === -1) throw new Error(`Unknown representation "${a[0]}"`);
      s.as(bits, this.sel(a[1]));
    });
    this.def("enable", "Display", "enable name", "Show an object (or indicate a selection, or show a measurement).", (a) => {
      const n = a[0] ?? "all";
      if (n === "all") { s.objects.forEach((o) => s.setEnabled(o.name, true)); return; }
      if (s.setEnabled(n, true) || s.setMeasurementVisible(n, true)) return;
      if (s.namedSelection(n)) { s.indicate([...s.selections.keys()].find((k) => k.toLowerCase() === n.toLowerCase())!); return; }
      throw new Error(`No object named "${n}"`);
    });
    this.def("disable", "Display", "disable name", "Hide an object (or a selection indicator / measurement).", (a) => {
      const n = a[0] ?? "all";
      if (n === "all") { s.objects.forEach((o) => s.setEnabled(o.name, false)); return; }
      if (s.setEnabled(n, false) || s.setMeasurementVisible(n, false)) return;
      if (s.namedSelection(n)) { s.indicate(null); return; }
      throw new Error(`No object named "${n}"`);
    });
    this.def("cartoon", "Display", "cartoon type", "Cartoon style: automatic, oval, rectangle, tube, trace, parabola, edged.", (a) => {
      const map: Record<string, Settings["cartoon_style"]> = {
        automatic: "automatic", auto: "automatic", oval: "oval", rectangle: "rectangle", rect: "rectangle",
        tube: "tube", trace: "trace", loop: "trace", parabola: "parabola", edged: "edged", skip: "automatic",
      };
      const t = map[(a[0] ?? "").toLowerCase()];
      if (!t) throw new Error("Usage: cartoon automatic|oval|rectangle|tube|trace|parabola|edged");
      s.set("cartoon_style", t);
    });
    this.def("label", "Display", "label [selection [, expression]]", "Label atoms, e.g. label name CA, resn+resi  ·  label organic, \"ligand\"", (a) => {
      const m = this.sel(a[0]);
      const expr = a.slice(1).join(",");
      let n = 0;
      for (const at of s.atomsOf(m)) {
        const text = expr.trim() ? labelText(expr, at) : "";
        s.setLabel(at, text || null);
        if (text) n++;
      }
      s.v.render();
      if (n > 300) return `Labeled ${n} atoms (that's a lot — try "name CA" to label residues)`;
    });

    // ---- colors
    this.def("color", "Color", "color color [, selection]", "Color atoms. Names (red, skyblue, slate…), #hex, [r,g,b] or 'atomic'.", (a) => {
      const name = (a[0] ?? "").toLowerCase();
      const m = this.sel(a[1]);
      if (name === "atomic" || name === "elem") return this.colorAtomic(m);
      const c = this.color(name);
      s.colorAtoms(m, () => c);
    });
    this.def("set_color", "Color", "set_color name, [r, g, b]", "Define a custom color.", (a) => {
      if (a.length < 2) throw new Error("Usage: set_color name, [r, g, b]");
      s.customColors[a[0].toLowerCase()] = this.color(a.slice(1).join(","));
    });
    this.def("bg_color", "Color", "bg_color color", "Set the background color ('default' follows the UI theme).", (a) => {
      const n = (a[0] ?? "black").toLowerCase();
      s.set("bg_color", n === "default" || n === "theme" ? null : this.color(n));
    }, "bg");
    this.def("spectrum", "Color", "spectrum [expression [, palette [, selection]]]", `Color by gradient. Expressions: count, resi, b, q. Palettes: ${Object.keys(GRADIENTS).join(", ")}.`, (a, kw) => {
      const expr = (a[0] || kw.expression || "count").toLowerCase();
      const palette = (a[1] || kw.palette || "rainbow").toLowerCase();
      if (!GRADIENTS[palette]) throw new Error(`Unknown palette "${palette}"`);
      const m = this.sel(a[2] || kw.selection);
      const atoms = s.atomsOf(m);
      const val = (at: PAtom, i: number) =>
        expr === "b" ? at.b : expr === "q" ? ((at as unknown as { q?: number }).q ?? 1) : expr === "resi" ? at.resi : i;
      if (expr === "count" && !kw.minimum) return this.chainbow(m, palette);
      const vals = atoms.map(val);
      const lo = kw.minimum !== undefined ? +kw.minimum : Math.min(...vals);
      const hi = kw.maximum !== undefined ? +kw.maximum : Math.max(...vals);
      const map = new Map(atoms.map((at, i) => [at, gradientColor(palette, hi > lo ? (vals[i] - lo) / (hi - lo) : 0)]));
      s.colorAtoms(m, (at) => map.get(at));
      return `Spectrum: range (${lo.toFixed(2)} to ${hi.toFixed(2)}).`;
    });
    this.def("util.cbc", "Color", "util.cbc [selection]", "Color by chain (blue-forward palette).", (a) => {
      s.colorByChain(s.atomsOf(this.sel(a[0])), false);
      s.update();
    });
    this.def("util.chainbow", "Color", "util.chainbow [selection]", "Rainbow N→C within each chain.", (a) => this.chainbow(this.sel(a[0])));
    this.def("util.rainbow", "Color", "util.rainbow [selection]", "Rainbow over residues of each chain.", (a) => this.chainbow(this.sel(a[0])));
    for (const [u, c] of Object.entries(CARBON_UTILS)) {
      this.def(`util.${u}`, "Color", `util.${u} [selection]`, `Color carbons ${c}, other elements by type.`, (a) => {
        const m = this.sel(a[0]);
        const col = this.color(c);
        s.colorAtoms(m, (at) => elementColor(at.elem, col));
      });
    }
    this.def("color_by_ss", "Color", "color_by_ss [selection]", "Helix / sheet / loop coloring.", (a) => {
      s.colorAtoms(this.sel(a[0]), (at) => (at.ss === "h" ? SS_COLORS.h : at.ss === "s" ? SS_COLORS.s : SS_COLORS.c));
    }, "util.ss", "util.cbss");
    this.def("color_by_hydrophobicity", "Color", "color_by_hydrophobicity [selection]", "Eisenberg scale: blue (polar) → orange (hydrophobic).", (a) => {
      s.colorAtoms(this.sel(a[0]), (at) => {
        const h = hydrophobicity(at.resn);
        return h === undefined ? 0xcbd5e1 : gradientColor("hydro", (h + 2.53) / (1.38 + 2.53));
      });
    }, "color_h");
    this.def("color_by_restype", "Color", "color_by_restype [selection]", "Positive blue, negative red, polar green, hydrophobic white.", (a) => {
      s.colorAtoms(this.sel(a[0]), (at) => residueTypeColor(at.resn));
    });

    // ---- selections
    this.def("select", "Selection", "select [name,] selection", "Create a named selection (default name: sele).", (a) => {
      const [name, expr] = a.length >= 2 ? [a[0], a.slice(1).join(",")] : ["sele", a[0]];
      if (!/^[A-Za-z_][\w.-]*$/.test(name)) throw new Error(`Invalid selection name "${name}"`);
      const m = this.sel(expr);
      s.defineSelection(name, m);
      return `Selector: selection "${name}" defined with ${countMask(m)} atoms.`;
    });
    this.def("deselect", "Selection", "deselect", "Hide the selection indicator.", () => s.indicate(null));
    this.def("count_atoms", "Selection", "count_atoms [selection]", "Count atoms in a selection.", (a) => `count_atoms: ${countMask(this.sel(a[0]))} atoms`);
    this.def("get_chains", "Selection", "get_chains [selection]", "List chain identifiers.", (a) => {
      const chains = [...new Set(s.atomsOf(this.sel(a[0])).map((at) => at.chain))];
      return `chains: ${chains.map((c) => c || "''").join(" ")}`;
    });
    this.def("get_names", "Selection", "get_names", "List objects, selections and measurements.", () => {
      const lines = [
        `objects: ${s.objects.map((o) => o.name).join(", ") || "(none)"}`,
        `selections: ${[...s.selections.keys()].join(", ") || "(none)"}`,
        `measurements: ${s.measurements.map((m) => m.name).join(", ") || "(none)"}`,
      ];
      return lines.join("\n");
    }, "ls");
    this.def("iterate", "Selection", "iterate selection, expression", "Print an expression for each atom, e.g. iterate name CA and resi 1-5, resn+resi", (a) => {
      const atoms = s.atomsOf(this.sel(a[0]));
      const expr = a.slice(1).join(",") || "model+'/'+chain+'/'+resn+resi+'/'+name";
      const lines = atoms.slice(0, 200).map((at) => labelText(expr, at));
      if (atoms.length > 200) lines.push(`… ${atoms.length - 200} more`);
      return lines.join("\n") || "(no atoms)";
    });

    // ---- measurement & analysis
    this.def("distance", "Measure", "distance [name,] sel1, sel2 [, cutoff [, mode]]", "Measure distances. mode=2 finds polar contacts (N/O ≤ cutoff).", (a, kw) => {
      const extra = a.length >= 4 ? a.slice(3) : [];
      const { name, sels } = this.measureArgs(a.slice(0, Math.min(a.length, 3)), 2, "dist");
      const mode = +(kw.mode ?? extra[1] ?? 0);
      const A = s.atomsOf(this.sel(sels[0])), B = s.atomsOf(this.sel(sels[1]));
      if (!A.length || !B.length) throw new Error("Both selections must contain atoms");
      let groups: PAtom[][];
      if (A.length === 1 && B.length === 1 && mode !== 2) groups = [[A[0], B[0]]];
      else groups = this.pairs(A, B, +(kw.cutoff ?? extra[0] ?? (mode === 2 ? 3.6 : 4.0)), mode === 2);
      const m = s.addMeasurement(name, mode === 2 ? "contacts" : "distance", groups);
      return `${name}: ${m.summary}`;
    }, "dist");
    this.def("angle", "Measure", "angle [name,] sel1, sel2, sel3", "Measure an angle between three atoms.", (a) => {
      const { name, sels } = this.measureArgs(a, 3, "angle");
      const m = s.addMeasurement(name, "angle", [sels.map((x) => this.single(x))]);
      return `${name}: ${m.summary}`;
    });
    this.def("dihedral", "Measure", "dihedral [name,] sel1, sel2, sel3, sel4", "Measure a dihedral angle.", (a) => {
      const { name, sels } = this.measureArgs(a, 4, "dihe");
      const m = s.addMeasurement(name, "dihedral", [sels.map((x) => this.single(x))]);
      return `${name}: ${m.summary}`;
    });
    this.def("polar_contacts", "Measure", "polar_contacts [off | ligand_sel [, protein_sel [, name]]]", "Ligand–protein polar contacts (approximate H-bonds, N/O ≤ 3.6 Å). 'polar_contacts off' removes them all.", (a) => {
      if (/^(off|clear|hide|none)$/i.test(a[0] ?? "")) {
        const names = s.measurements.filter((m) => m.kind === "contacts").map((m) => m.name);
        names.forEach((n) => s.deleteMeasurement(n));
        return names.length ? `Removed ${names.join(", ")}` : "No polar contacts shown";
      }
      const e1 = a[0] || "organic";
      const e2 = a[1] || "polymer";
      const A = s.atomsOf(this.sel(`(${e1}) and organic`)), B = s.atomsOf(this.sel(`(${e2}) and polymer`));
      if (!A.length) throw new Error(`No ligand (organic) atoms in "${e1}"`);
      if (!B.length) throw new Error(`No protein / nucleic atoms in "${e2}"`);
      const groups = this.pairs(A, B, 3.6, true);
      const name = a[2] || "polar";
      s.addMeasurement(name, "contacts", groups);
      return `${name}: ${groups.length} ligand–protein polar contacts`;
    }, "hbonds", "contacts");

    // ---- view
    this.def("zoom", "View", "zoom [selection]", "Zoom to a selection.", (a) => { const m = this.sel(a[0]); this.needAtoms(m, a[0] ?? "all"); s.zoom(m); });
    this.def("orient", "View", "orient [selection]", "Align principal axes with the screen and zoom.", (a) => { const m = this.sel(a[0]); this.needAtoms(m, a[0] ?? "all"); s.orient(m); });
    this.def("center", "View", "center [selection]", "Center on a selection.", (a) => { const m = this.sel(a[0]); this.needAtoms(m, a[0] ?? "all"); s.center(m); });
    this.def("reset", "View", "reset", "Reset rotation and zoom.", () => s.reset());
    this.def("turn", "View", "turn axis, angle", "Rotate the view about x, y or z.", (a) => {
      const ax = (a[0] ?? "").toLowerCase();
      if (!["x", "y", "z"].includes(ax)) throw new Error("Usage: turn x|y|z, angle");
      s.turn(ax as "x", +(a[1] ?? 90));
    });
    this.def("move", "View", "move axis, distance", "Translate the camera along x, y or z.", (a) => {
      const ax = (a[0] ?? "").toLowerCase();
      if (!["x", "y", "z"].includes(ax)) throw new Error("Usage: move x|y|z, distance");
      s.move(ax as "x", +(a[1] ?? 1));
    });
    this.def("spin", "View", "spin [on|off]", "Continuously rotate the view.", (a) => s.setSpin(a[0] ? onOff(a[0]) : !s.spinning), "mplay");
    this.def("mstop", "View", "mstop", "Stop spinning / rocking.", () => { s.setSpin(false); s.setRock(false); });
    this.def("rock", "View", "rock [on|off]", "Rock the view back and forth.", (a) => s.setRock(a[0] ? onOff(a[0]) : !s.rocking));
    this.def("clip", "View", "clip near|far|slab|reset, value", "Move clipping planes (Å).", (a) => s.clip((a[0] ?? "reset").toLowerCase(), +(a[1] ?? 0)));
    this.def("get_view", "View", "get_view", "Print the current view matrix.", () => `set_view [${s.v.getView().map((x) => +(+x).toFixed(4)).join(", ")}]`);
    this.def("set_view", "View", "set_view [values]", "Restore a view printed by get_view.", (a) => {
      const nums = a.join(",").replace(/[[\]()]/g, "").split(",").map(Number).filter((x) => !isNaN(x));
      if (nums.length !== 8) throw new Error("set_view expects the 8 numbers printed by get_view");
      s.v.setView(nums);
      s.v.render();
    });

    // ---- settings
    this.def("set", "Settings", "set name, value", "Change a setting. Try: set transparency, 0.4 · set stick_radius, 0.3 · set cartoon_transparency, 0.5", (a) => {
      const key = (a[0] ?? "").toLowerCase();
      const raw = (a[1] ?? "").trim();
      const num = (min: number, max: number) => {
        const v = parseFloat(raw);
        if (isNaN(v)) throw new Error(`"${key}" expects a number`);
        return Math.min(max, Math.max(min, v));
      };
      const bool = () => (raw === "" ? true : onOff(raw));
      switch (key) {
        case "transparency": case "surface_transparency": s.set("transparency", num(0, 1)); break;
        case "surface_ligand_cutoff": s.set("surface_ligand_cutoff", num(0, 100)); break;
        case "cartoon_transparency": s.set("cartoon_transparency", num(0, 1)); break;
        case "stick_transparency": s.set("stick_transparency", num(0, 1)); break;
        case "sphere_transparency": s.set("sphere_transparency", num(0, 1)); break;
        case "stick_radius": s.set("stick_radius", num(0.05, 1)); break;
        case "sphere_scale": s.set("sphere_scale", num(0.05, 3)); break;
        case "label_size": s.set("label_size", num(6, 48)); break;
        case "label_color": s.set("label_color", this.color(raw)); break;
        case "surface_color": s.set("surface_color", raw === "" || raw === "default" || raw === "-1" ? null : this.color(raw)); break;
        case "surface_type": case "surface_mode": {
          const t = raw.toUpperCase();
          const map: Record<string, Settings["surface_type"]> = { VDW: "VDW", SAS: "SAS", SES: "SES", MS: "SES", MOLECULAR: "SES" };
          if (!map[t]) throw new Error("surface_type: VDW, SAS or SES");
          s.set("surface_type", map[t]);
          break;
        }
        case "cartoon_style": return this.exec(`cartoon ${raw}`);
        case "bg_rgb": case "bg_color": return this.exec(`bg_color ${raw}`);
        case "depth_cue": case "fog": s.set("fog", bool()); break;
        case "ray_trace_mode": case "outline": s.set("outline", raw === "" ? true : raw !== "0" && onOff(raw)); break;
        case "orthoscopic": s.set("orthoscopic", bool()); break;
        case "mouse_selection_mode": {
          const modes: Settings["mouse_selection_mode"][] = ["atoms", "residues", "chains"];
          const v = isNaN(+raw) ? raw.toLowerCase() : modes[+raw];
          if (!modes.includes(v as never)) throw new Error("mouse_selection_mode: 0 atoms, 1 residues, 2 chains");
          s.set("mouse_selection_mode", v as Settings["mouse_selection_mode"]);
          break;
        }
        default: throw new Error(`Setting "${key}" is not supported in the web viewer`);
      }
    });
    this.def("get", "Settings", "get name", "Print a setting.", (a) => {
      const key = (a[0] ?? "").toLowerCase().replace(/^surface_transparency$/, "transparency") as keyof Settings;
      if (!(key in s.settings)) throw new Error(`Unknown setting "${a[0]}"`);
      const v = s.settings[key];
      return `${key} = ${typeof v === "number" && key.includes("color") ? toHex(v) : v === null ? "default" : v}`;
    });

    // ---- presets
    const preset = (name: string, help: string, steps: (sel: string) => string[]) =>
      this.def(`preset.${name}`, "Presets", `preset.${name} [selection]`, help, async (a) => {
        const sel = a[0] || "all";
        for (const step of steps(sel)) await this.exec(step);
      });
    preset("simple", "Cartoon + ligand sticks, colored by chain. Also undoes what the other presets change.", (x) => [
      `hide everything, (${x}) and not solvent`, `show cartoon, (${x}) and polymer`, `show sticks, (${x}) and organic`,
      `show spheres, (${x}) and inorganic`,
      `util.cbc ${x}`, `util.cbao (${x}) and organic`, `color atomic, (${x}) and not elem C`,
      ...(s.selections.has("pocket") ? ["delete pocket"] : []), "polar_contacts off",
      "set cartoon_transparency, 0", "set transparency, 0", "set surface_ligand_cutoff, 0", "bg_color default", "set outline, 0", "set fog, 1",
    ]);
    preset("ball_and_stick", "Ball-and-stick model, element colors.", (x) => [
      `hide everything, (${x}) and not solvent`, `show ballstick, (${x}) and not solvent`, `util.cbaw (${x}) and polymer`, `util.cbao (${x}) and organic`,
    ]);
    preset("ligand_sites", "Ligand sticks, pocket residues within 5 Å, polar contacts.", (x) => {
      const hasLig = s.atoms.some((at) => at.cls === "organic");
      if (!hasLig) throw new Error("No organic ligands in this structure");
      return [
        `hide everything, (${x}) and not solvent`, `show cartoon, (${x}) and polymer`, `set cartoon_transparency, 0.25`,
        `show sticks, (${x}) and organic`, `select pocket, byres ((${x}) and polymer) within 5 of ((${x}) and organic)`,
        `show sticks, pocket and not name N+C+O`, `util.cbaw pocket`, `util.cbao (${x}) and organic`,
        `polar_contacts (${x}) and organic, pocket`, `deselect`, `orient (${x}) and organic`,
      ];
    });
    preset("publication", "Outline, no fog, cartoon + sticks.", (x) => [
      `hide everything, (${x}) and not solvent`, `show cartoon, (${x}) and polymer`, `show sticks, (${x}) and organic`, `show spheres, (${x}) and inorganic`,
      `util.cbc ${x}`, `util.cbao (${x}) and organic`, `color atomic, (${x}) and not elem C`,
      `set outline, 1`, `set fog, 0`,
    ]);
    preset("pretty_surface", "Cartoon under a translucent molecular surface.", (x) => [
      `hide everything, (${x}) and not solvent`, `show cartoon, (${x}) and polymer`, `show sticks, (${x}) and organic`,
      `show surface, (${x}) and polymer`, `set surface_type, SES`, `set transparency, 0.45`,
    ]);
    preset("b_factor", "Cartoon colored by B-factor (blue → red).", (x) => [
      `hide everything, (${x}) and not solvent`, `show cartoon, (${x}) and polymer`, `show sticks, (${x}) and organic`, `spectrum b, blue_white_red, ${x}`,
    ]);

    // ---- output & misc
    this.def("png", "Output", "png [filename]", "Save the current view as a PNG image.", (a) => {
      const file = (a[0] || `${s.objects.at(-1)?.name ?? "pymol"}.png`).replace(/(\.png)?$/i, ".png");
      this.hooks.download?.(file, s.png());
      return `Saved ${file}`;
    }, "ray", "save_image");
    this.def("cls", "Output", "cls", "Clear the console.", () => this.hooks.clearLog?.(), "clear");
    this.def("help", "Output", "help [command]", "Show help.", (a) => {
      if (a[0]) {
        const n = this.aliases.get(a[0].toLowerCase()) ?? a[0].toLowerCase();
        const c = this.commands.get(n);
        if (!c) throw new Error(`No help for "${a[0]}"`);
        return `${c.usage}\n  ${c.help}`;
      }
      const groups = new Map<string, string[]>();
      for (const [n, c] of this.commands) (groups.get(c.group) ?? groups.set(c.group, []).get(c.group)!).push(n);
      return [...groups].map(([g, ns]) => `${g.padEnd(10)} ${ns.join("  ")}`).join("\n") +
        "\n\nSelections: chain A, resi 10-20+35, resn HEM, name CA, elem Fe, organic, polymer, solvent, hetatm, backbone, sidechain,\n" +
        "  ss h, b > 50, /1hsg//A/25/CA, and/or/not, byres, bychain, around 5, expand 3, within 4 of …\n" +
        `Colors: ${Object.keys(PYMOL_COLORS).slice(0, 24).join(", ")}, … #hex, [r,g,b]`;
    });
  }

}

// ---------------------------------------------------------------- parsing helpers
export function splitTop(src: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = "", cur = "";
  for (const ch of src) {
    if (quote) { cur += ch; if (ch === quote) quote = ""; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

const unquote = (s: string) => {
  const t = s.trim();
  return /^(['"]).*\1$/.test(t) && !/^(['"]).*\1\s*%/.test(t) ? t.slice(1, -1) : t;
};

const onOff = (v: string) => {
  const t = v.trim().toLowerCase();
  if (["1", "on", "true", "yes"].includes(t)) return true;
  if (["0", "off", "false", "no"].includes(t)) return false;
  throw new Error(`Expected on/off, got "${v}"`);
};

function atomProp(a: PAtom, id: string): string {
  switch (id) {
    case "resn": return a.resn;
    case "resi": return String(a.resi) + (a.icode ?? "");
    case "name": return a.atom;
    case "chain": return a.chain;
    case "elem": return a.elem;
    case "b": return a.b.toFixed(2);
    case "q": return String((a as unknown as { q?: number }).q ?? 1);
    case "id": return String(a.serial);
    case "index": return String(a.index + 1);
    case "model": return a.obj.name;
    case "ss": return a.ss === "h" ? "H" : a.ss === "s" ? "S" : "L";
    case "segi": case "alt": return "";
    case "oneletter": return ONE[a.resn.toUpperCase()] ?? "X";
  }
  throw new Error(`Unknown atom property "${id}" (try resn, resi, name, chain, elem, b, q, ID, model, ss)`);
}

/** Evaluate PyMOL label expressions: resn+resi, "%s-%s"%(resn,resi), "text", name … */
export function labelText(expr: string, a: PAtom): string {
  const e = expr.trim();
  const fmt = e.match(/^(['"])(.*)\1\s*%\s*\(?(.*?)\)?$/);
  if (fmt) {
    const vals = fmt[3].split(",").map((x) => labelText(x, a));
    let i = 0;
    return fmt[2].replace(/%(\.\d+)?[sdif]/g, (m, prec) => {
      const v = vals[i++] ?? "";
      if (prec && !isNaN(+v)) return (+v).toFixed(+prec.slice(1));
      return m.endsWith("d") || m.endsWith("i") ? String(Math.round(+v)) : v;
    });
  }
  return splitTop(e, "+").map((part) => {
    const p = part.trim();
    if (/^(['"]).*\1$/.test(p)) return p.slice(1, -1);
    if (/^-?\d+(\.\d+)?$/.test(p)) return p;
    return atomProp(a, p.toLowerCase());
  }).join("");
}

export const ONE: Record<string, string> = {
  ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C", GLN: "Q", GLU: "E", GLY: "G", HIS: "H", ILE: "I",
  LEU: "L", LYS: "K", MET: "M", PHE: "F", PRO: "P", SER: "S", THR: "T", TRP: "W", TYR: "Y", VAL: "V",
  MSE: "M", SEC: "U", PYL: "O", DA: "A", DC: "C", DG: "G", DT: "T", DU: "U", A: "A", C: "C", G: "G", U: "U",
};
