// Scene: wraps a 3Dmol GLViewer and keeps PyMOL-like per-atom state
// (visible representations, colors, labels, named selections, measurements).

import * as $3Dmol from "3dmol";
import { CHAIN_PALETTE, LIGAND_CARBON, elementColor, mix, toHex } from "./colors";
import type { Mask, SelectionContext } from "./selection";
import {
  ALL_REPS, DEFAULT_SETTINGS, INDICATE_BIT, REP, SURFACE_BITS,
  type AtomClass, type Measurement, type MeasureKind, type PAtom, type PObject, type Settings,
} from "./types";

const AMINO = new Set("ALA ARG ASN ASP CYS GLN GLU GLY HIS ILE LEU LYS MET PHE PRO SER THR TRP TYR VAL SEC PYL MSE HSD HSE HSP HID HIE HIP CYX ASH GLH LYN UNK".split(" "));
const NUCLEIC = new Set("A C G U T I DA DC DG DT DU DI PSU".split(" "));
const SOLVENT = new Set("HOH WAT H2O DOD TIP TIP3 SOL".split(" "));

type Viewer = $3Dmol.GLViewer;
type AnyRec = Record<string, unknown>;

export const THEME_BG = { dark: 0x0a1222, light: 0xf3f7ff };
const SELECTION_PINK = 0xff4fd8;
export type SceneEvent = "objects" | "selections" | "measurements" | "settings" | "view" | "style";

export class Scene extends EventTarget implements SelectionContext {
  readonly v: Viewer;
  objects: PObject[] = [];
  atoms: PAtom[] = [];
  selections = new Map<string, Set<PAtom>>();
  indicated: string | null = null;
  settings: Settings = { ...DEFAULT_SETTINGS };
  customColors: Record<string, number> = {};
  measurements: Measurement[] = [];
  private labels = new Map<PAtom, { text: string; handle: unknown }>();
  private surfaceIds: number[] = [];
  private surfaceDirty = false;
  private surfaceTimer = 0;
  private themeBg = THEME_BG.dark;
  private rockHandle = 0;
  spinning = false;
  rocking = false;
  private baseSlab: { near: number; far: number } | null = null;
  private boxShapes: unknown[] = [];

  constructor(el: HTMLElement) {
    super();
    this.v = $3Dmol.createViewer(el, { backgroundColor: toHex(this.themeBg), antialias: true } as AnyRec);
    this.v.enableFog(true);
  }

  emit(type: SceneEvent) { this.dispatchEvent(new Event(type)); }

  // ---------- SelectionContext ----------
  namedSelection(name: string) {
    for (const [k, s] of this.selections) if (k.toLowerCase() === name.toLowerCase()) return s;
    return undefined;
  }
  mask(pred: (a: PAtom) => boolean): Mask {
    const m = new Uint8Array(this.atoms.length);
    this.atoms.forEach((a, i) => { if (pred(a)) m[i] = 1; });
    return m;
  }
  atomsOf(m: Mask) { return this.atoms.filter((_, i) => m[i]); }

  // ---------- objects ----------
  addObject(name: string, data: string, format: string, pdbId?: string): PObject {
    if (this.objects.some((o) => o.name === name)) this.deleteObject(name);
    const model = this.v.addModel(data, format);
    const atoms = model.selectedAtoms({}) as unknown as PAtom[];
    if (!atoms.length) {
      this.v.removeModel(model);
      throw new Error("No atoms could be parsed from this file");
    }
    const obj: PObject = { name, model, atoms, enabled: true, pdbId, paletteOffset: (this.objects.length * 5) % CHAIN_PALETTE.length };
    classify(atoms);
    this.objects.push(obj);
    for (const a of atoms) a.obj = obj;
    this.applyDefaults(obj);
    this.rebuildIndex();

    this.v.setClickable({ model } as AnyRec, true, (atom: PAtom, _v: unknown, ev: MouseEvent) =>
      this.dispatchEvent(new CustomEvent("pick", { detail: { atom, event: ev } })));
    this.v.setHoverable({ model } as AnyRec, true,
      (atom: PAtom, _v: unknown, ev: MouseEvent) => this.dispatchEvent(new CustomEvent("hover", { detail: { atom, event: ev } })),
      () => this.dispatchEvent(new CustomEvent("hover", { detail: { atom: null } })));
    this.v.setHoverDuration(60);

    this.surfaceDirty = true;
    this.update();
    const solid = this.mask((a) => a.obj === obj && a.cls !== "solvent");
    this.zoom(solid.includes(1) ? solid : this.mask((a) => a.obj === obj), 0);
    this.emit("objects");
    return obj;
  }

  applyDefaults(obj: PObject, atoms: PAtom[] = obj.atoms) {
    const hasPolymer = obj.atoms.some((a) => a.cls === "protein" || a.cls === "nucleic");
    for (const a of atoms) {
      // water starts hidden (the Water switch shows it as ball & stick)
      if (!hasPolymer) a.reps = a.cls === "solvent" ? 0 : REP.sticks;
      else a.reps = { protein: REP.cartoon, nucleic: REP.cartoon, organic: REP.sticks, inorganic: REP.spheres, solvent: 0 }[a.cls];
    }
    this.colorByChain(atoms, true);
    this.surfaceDirty = true;
  }

  chainColor(obj: PObject, chain: string) {
    const chains = [...new Set(obj.atoms.map((a) => a.chain))];
    return CHAIN_PALETTE[(chains.indexOf(chain) + obj.paletteOffset) % CHAIN_PALETTE.length];
  }

  colorByChain(atoms: PAtom[], keepHetero: boolean) {
    const cache = new Map<string, number>();
    for (const a of atoms) {
      const k = a.obj.name + "|" + a.chain;
      if (!cache.has(k)) cache.set(k, this.chainColor(a.obj, a.chain));
      const carbon = a.cls === "organic" ? LIGAND_CARBON : cache.get(k)!;
      a.color = keepHetero ? elementColor(a.elem, carbon) : carbon;
    }
    this.touchSurfaces(atoms);
  }

  deleteObject(name: string) {
    const obj = this.objects.find((o) => o.name === name);
    if (!obj) return false;
    this.forgetAtoms(new Set(obj.atoms));
    this.v.removeModel(obj.model);
    this.objects = this.objects.filter((o) => o !== obj);
    this.rebuildIndex();
    this.surfaceDirty = true;
    this.update();
    this.emit("objects");
    return true;
  }

  deleteAll() {
    for (const o of [...this.objects]) this.deleteObject(o.name);
    this.selections.clear();
    this.indicated = null;
    this.emit("selections");
  }

  removeAtoms(m: Mask) {
    const doomed = new Set(this.atomsOf(m));
    if (!doomed.size) return 0;
    this.forgetAtoms(doomed);
    for (const obj of this.objects) {
      const gone = obj.atoms.filter((a) => doomed.has(a));
      if (!gone.length) continue;
      obj.model.removeAtoms(gone as unknown as $3Dmol.AtomSpec[]);
      obj.atoms = obj.model.selectedAtoms({}) as unknown as PAtom[];
    }
    this.objects = this.objects.filter((o) => {
      if (o.atoms.length) return true;
      this.v.removeModel(o.model);
      return false;
    });
    this.rebuildIndex();
    this.surfaceDirty = true;
    this.update();
    this.emit("objects");
    return doomed.size;
  }

  private forgetAtoms(doomed: Set<PAtom>) {
    for (const [a, l] of this.labels) if (doomed.has(a)) { this.v.removeLabel(l.handle as $3Dmol.Label); this.labels.delete(a); }
    for (const s of this.selections.values()) for (const a of doomed) s.delete(a);
    for (const m of [...this.measurements]) if (m.groups.some((g) => g.some((a) => doomed.has(a)))) this.deleteMeasurement(m.name);
    this.emit("selections");
  }

  setEnabled(name: string, on: boolean) {
    const obj = this.objects.find((o) => o.name === name);
    if (!obj) return false;
    obj.enabled = on;
    this.surfaceDirty = true;
    this.refreshLabels();
    this.update();
    this.emit("objects");
    return true;
  }

  private rebuildIndex() {
    this.atoms = [];
    let rid = -1;
    let prev = "";
    for (const obj of this.objects) {
      for (const a of obj.atoms) {
        const key = `${obj.name}|${a.chain}|${a.resi}|${a.icode ?? ""}|${a.resn}`;
        if (key !== prev) { rid++; prev = key; }
        a.rid = rid;
        a.gid = this.atoms.length;
        this.atoms.push(a);
      }
    }
  }

  // ---------- representations & colors ----------
  show(bits: number, m: Mask) {
    this.atomsOf(m).forEach((a) => { if (bits & SURFACE_BITS) this.surfaceDirty = true; a.reps |= bits; });
    this.update();
  }
  hide(bits: number, m: Mask) {
    this.atomsOf(m).forEach((a) => { if (a.reps & bits & SURFACE_BITS) this.surfaceDirty = true; a.reps &= ~bits; });
    this.update();
  }
  as(bits: number, m: Mask) {
    this.atomsOf(m).forEach((a) => { if ((a.reps | bits) & SURFACE_BITS) this.surfaceDirty = true; a.reps = bits; });
    this.update();
  }
  /** fraction of atoms in mask that show a representation */
  repCoverage(bit: number, m: Mask) {
    let n = 0, on = 0;
    this.atoms.forEach((a, i) => { if (m[i]) { n++; if (a.reps & bit) on++; } });
    return n ? on / n : 0;
  }

  colorAtoms(m: Mask, fn: (a: PAtom) => number | undefined) {
    const atoms = this.atomsOf(m);
    for (const a of atoms) { const c = fn(a); if (c !== undefined) a.color = c; }
    this.touchSurfaces(atoms);
    this.update();
  }

  private touchSurfaces(atoms: PAtom[]) {
    if (this.settings.surface_color === null && atoms.some((a) => a.reps & SURFACE_BITS)) this.surfaceDirty = true;
  }

  /** Re-apply styles to all models (cheap) and schedule surface rebuild if needed. */
  update(forceSurfaces = false) {
    const ind = this.indicated ? this.selections.get(this.indicated) : undefined;
    const showInd = !!ind && ind.size > 0 && ind.size <= 20000;
    for (const obj of this.objects) {
      const model = obj.model;
      model.setStyle({}, {});
      if (!obj.enabled) continue;
      const keys = new Set<number>();
      const visible = (a: PAtom) => {
        const bits = a.reps & ALL_REPS & ~SURFACE_BITS;
        return (bits & REP.nonbonded) && a.bonds.length ? bits & ~REP.nonbonded : bits;
      };
      // selected residues are tinted pink in whatever they are drawn as; only residues
      // with nothing drawn fall back to a small pink marker sphere
      const drawnRes = new Set<number>();
      if (showInd) for (const a of obj.atoms) if (visible(a)) drawnRes.add(a.rid);
      for (const a of obj.atoms) {
        let bits = visible(a);
        if (showInd && ind!.has(a) && (bits || !drawnRes.has(a.rid))) bits |= INDICATE_BIT;
        a.styleKey = bits;
        if (bits) keys.add(bits);
      }
      for (const key of keys) {
        model.setStyle({ predicate: (a: PAtom) => a.styleKey === key } as AnyRec, this.styleFor(key) as AnyRec);
      }
    }
    if (forceSurfaces) this.surfaceDirty = true;
    if (this.surfaceDirty) this.scheduleSurfaces();
    this.v.render();
    this.emit("style");
  }

  private styleFor(key: number) {
    const s = this.settings;
    const st: AnyRec = {};
    if (key & REP.cartoon) st.cartoon = this.cartoonSpec();
    else if (key & REP.ribbon) st.cartoon = { style: "trace", thickness: 0.35, opacity: 1 - s.cartoon_transparency };
    if (key & REP.sticks) st.stick = { radius: s.stick_radius, opacity: 1 - s.stick_transparency };
    else if (key & REP.ballstick) st.stick = { radius: 0.13, opacity: 1 - s.stick_transparency };
    if (key & REP.spheres) st.sphere = { scale: s.sphere_scale, opacity: 1 - s.sphere_transparency };
    else if (key & REP.ballstick) st.sphere = { scale: 0.26, opacity: 1 - s.sphere_transparency };
    else if (key === INDICATE_BIT) st.sphere = { radius: 0.2, color: SELECTION_PINK, opacity: 1 - s.sphere_transparency };
    if (key & REP.lines) st.line = { linewidth: 1 };
    if (key & REP.nonbonded) st.cross = { radius: 0.25, linewidth: 1 };
    if (key & INDICATE_BIT && key !== INDICATE_BIT) {
      const tint = (a: PAtom) => mix(a.color ?? 0xffffff, SELECTION_PINK, 0.7);
      for (const sub of Object.values(st) as AnyRec[]) sub.colorfunc = tint;
    }
    return st;
  }

  private cartoonSpec(): AnyRec {
    const s = this.settings;
    const base: AnyRec = { opacity: 1 - s.cartoon_transparency, arrows: true };
    switch (s.cartoon_style) {
      case "oval": return { ...base, style: "oval" };
      case "rectangle": return { ...base, style: "rectangle" };
      case "parabola": return { ...base, style: "parabola" };
      case "edged": return { ...base, style: "edged" };
      case "trace": return { ...base, style: "trace", thickness: 0.35 };
      case "tube": return { ...base, tubes: true };
      default: return base;
    }
  }

  // ---------- surfaces ----------
  private scheduleSurfaces() {
    clearTimeout(this.surfaceTimer);
    this.surfaceTimer = window.setTimeout(() => this.rebuildSurfaces(), 120);
  }

  private async rebuildSurfaces() {
    this.surfaceDirty = false;
    for (const id of this.surfaceIds) this.v.removeSurface(id);
    this.surfaceIds = [];
    const s = this.settings;
    const type = { VDW: $3Dmol.SurfaceType.VDW, SAS: $3Dmol.SurfaceType.SAS, SES: $3Dmol.SurfaceType.SES }[s.surface_type];
    const jobs: Promise<unknown>[] = [];
    for (const obj of this.objects) {
      if (!obj.enabled) continue;
      const near = this.residuesNearLigands(obj, s.surface_ligand_cutoff);
      for (const [bit, wire] of [[REP.surface, false], [REP.mesh, true]] as const) {
        if (!obj.atoms.some((a) => a.reps & bit && (!near || near.has(a.rid)))) continue;
        const style: AnyRec = { opacity: 1 - s.transparency, wireframe: wire };
        if (s.surface_color !== null) style.color = s.surface_color;
        else {
          // color each residue's patch by its CA (or first carbon) so element colors don't speckle the surface
          const resColor = new Map<number, number>();
          for (const a of obj.atoms) {
            if (a.atom === "CA" && a.elem.toUpperCase() === "C") resColor.set(a.rid, a.color);
            else if (!resColor.has(a.rid) && a.elem.toUpperCase() === "C") resColor.set(a.rid, a.color);
          }
          style.colorfunc = (a: PAtom) => resColor.get(a.rid) ?? a.color;
        }
        const p = this.v.addSurface(type, style,
          { model: obj.model, predicate: (a: PAtom) => (a.reps & bit) !== 0 && (!near || near.has(a.rid)) } as AnyRec,
          // the envelope is computed from the polymer plus whatever is itself surfaced; counting an
          // unsurfaced ligand would carve its imprint out of the pocket and leave holes there
          { model: obj.model, predicate: (a: PAtom) => a.cls === "protein" || a.cls === "nucleic" || ((a.reps & bit) !== 0 && a.cls !== "solvent" && (!near || near.has(a.rid))) } as AnyRec) as Promise<number> & { surfid?: number };
        this.surfaceIds.push(p.surfid ?? (p as unknown as number));
        jobs.push(Promise.resolve(p));
      }
    }
    if (jobs.length) this.dispatchEvent(new CustomEvent("busy", { detail: true }));
    await Promise.all(jobs).catch(() => undefined);
    this.dispatchEvent(new CustomEvent("busy", { detail: false }));
    this.v.render();
  }

  /**
   * Protein / nucleic residues with any atom within `cutoff` Å of a ligand's center (one
   * center per ligand residue), so the ligand itself stays uncovered. Null when the cutoff
   * is off or the object has no ligand: surface everything.
   */
  private residuesNearLigands(obj: PObject, cutoff: number) {
    if (!cutoff) return null;
    const ligands = new Map<number, PAtom[]>();
    for (const a of obj.atoms) if (a.cls === "organic") (ligands.get(a.rid) ?? ligands.set(a.rid, []).get(a.rid)!).push(a);
    if (!ligands.size) return null;
    const centers = [...ligands.values()].map((g) => ({ x: avg(g, "x"), y: avg(g, "y"), z: avg(g, "z") }));
    const c2 = cutoff * cutoff;
    const near = new Set<number>();
    for (const a of obj.atoms) {
      if (near.has(a.rid) || (a.cls !== "protein" && a.cls !== "nucleic")) continue;
      if (centers.some((c) => (a.x - c.x) ** 2 + (a.y - c.y) ** 2 + (a.z - c.z) ** 2 <= c2)) near.add(a.rid);
    }
    return near;
  }

  // ---------- settings ----------
  set<K extends keyof Settings>(key: K, value: Settings[K]) {
    this.settings[key] = value;
    switch (key) {
      case "transparency": case "surface_type": case "surface_color": case "surface_ligand_cutoff": this.update(true); break;
      case "label_size": case "label_color": this.refreshLabels(); this.v.render(); break;
      case "bg_color": this.applyBackground(); break;
      case "fog": this.v.enableFog(value as boolean); this.v.render(); break;
      case "outline":
        this.v.setViewStyle((value ? { style: "outline", color: "black", width: 0.08 } : { style: "none" }) as AnyRec);
        this.v.render();
        break;
      case "orthoscopic": this.v.setProjection(value ? "orthographic" : "perspective"); this.v.render(); break;
      case "mouse_selection_mode": break;
      default: this.update();
    }
    this.emit("settings");
  }

  setThemeBackground(c: number) { this.themeBg = c; this.applyBackground(); }
  get background() { return this.settings.bg_color ?? this.themeBg; }
  private applyBackground() {
    this.v.setBackgroundColor(toHex(this.background), 1);
    this.v.render();
  }

  // ---------- selections ----------
  defineSelection(name: string, m: Mask, indicate = true) {
    this.selections.set(name, new Set(this.atomsOf(m)));
    if (indicate) this.indicated = name;
    this.update();
    this.emit("selections");
  }
  deleteSelection(name: string) {
    const key = [...this.selections.keys()].find((k) => k.toLowerCase() === name.toLowerCase());
    if (!key) return false;
    this.selections.delete(key);
    if (this.indicated === key) this.indicated = null;
    this.update();
    this.emit("selections");
    return true;
  }
  indicate(name: string | null) {
    this.indicated = name;
    this.update();
    this.emit("selections");
  }

  /** Toggle the clicked atom/residue/chain in "sele" like PyMOL's mouse selection. */
  pickSelect(atom: PAtom, extend = false) {
    const mode = this.settings.mouse_selection_mode;
    const group = this.atoms.filter((a) =>
      mode === "atoms" ? a === atom : mode === "residues" ? a.rid === atom.rid : a.obj === atom.obj && a.chain === atom.chain);
    this.toggleInSele(group, extend);
    return group;
  }
  toggleInSele(group: PAtom[], forceAdd = false) {
    const sele = this.selections.get("sele") ?? new Set<PAtom>();
    const all = group.every((a) => sele.has(a));
    for (const a of group) { if (all && !forceAdd) sele.delete(a); else sele.add(a); }
    if (sele.size) this.selections.set("sele", sele); else this.selections.delete("sele");
    this.indicated = sele.size ? "sele" : null;
    this.update();
    this.emit("selections");
    return sele.size;
  }

  // ---------- labels ----------
  setLabel(a: PAtom, text: string | null) {
    const old = this.labels.get(a);
    if (old) { this.v.removeLabel(old.handle as $3Dmol.Label); this.labels.delete(a); }
    if (text) this.labels.set(a, { text, handle: a.obj.enabled ? this.v.addLabel(text, this.labelStyle(a)) : null });
  }
  hasLabel(a: PAtom) { return this.labels.has(a); }
  private labelStyle(a: PAtom): AnyRec {
    return {
      position: { x: a.x, y: a.y, z: a.z },
      font: "Pretendard Variable, Pretendard, sans-serif",
      fontSize: this.settings.label_size,
      fontColor: toHex(this.settings.label_color),
      backgroundColor: "#0b1b3f",
      backgroundOpacity: 0.72,
      borderThickness: 0,
      inFront: true,
      alignment: "center",
    };
  }
  refreshLabels() {
    for (const [a, l] of this.labels) {
      if (l.handle) this.v.removeLabel(l.handle as $3Dmol.Label);
      l.handle = a.obj.enabled ? this.v.addLabel(l.text, this.labelStyle(a)) : null;
    }
  }

  // ---------- measurements ----------
  addMeasurement(name: string, kind: MeasureKind, groups: PAtom[][]) {
    this.deleteMeasurement(name);
    const m: Measurement = { name, kind, groups, visible: true, shapes: [], labels: [], summary: "" };
    m.summary = summarize(m);
    this.drawMeasurement(m);
    this.measurements.push(m);
    this.v.render();
    this.emit("measurements");
    return m;
  }
  private drawMeasurement(m: Measurement) {
    const color = m.kind === "contacts" ? "#38bdf8" : "#fbbf24";
    const dash = (a: PAtom, b: PAtom, r = 0.055) =>
      m.shapes.push(this.v.addCylinder({
        start: { x: a.x, y: a.y, z: a.z }, end: { x: b.x, y: b.y, z: b.z },
        radius: r, color, dashed: true, dashLength: 0.22, gapLength: 0.16, fromCap: 1, toCap: 1,
      } as AnyRec));
    const label = (text: string, p: { x: number; y: number; z: number }) =>
      m.labels.push(this.v.addLabel(text, {
        position: p, font: "Pretendard Variable, Pretendard, sans-serif", fontSize: 11,
        fontColor: color, backgroundColor: "#0b1b3f", backgroundOpacity: 0.78, inFront: true, alignment: "center",
      } as AnyRec));
    const mid = (...as: PAtom[]) => ({ x: avg(as, "x"), y: avg(as, "y"), z: avg(as, "z") });
    for (const g of m.groups) {
      if (g.length === 2) { dash(g[0], g[1]); label(dist(g[0], g[1]).toFixed(2) + " Å", mid(g[0], g[1])); }
      if (g.length === 3) { dash(g[0], g[1]); dash(g[1], g[2]); label(angle(g[0], g[1], g[2]).toFixed(1) + "°", mid(g[0], g[1], g[2])); }
      if (g.length === 4) { dash(g[0], g[1], 0.04); dash(g[1], g[2], 0.04); dash(g[2], g[3], 0.04); label(dihedral(g[0], g[1], g[2], g[3]).toFixed(1) + "°", mid(g[1], g[2])); }
    }
  }
  private eraseMeasurement(m: Measurement) {
    m.shapes.forEach((s) => this.v.removeShape(s as $3Dmol.GLShape));
    m.labels.forEach((l) => this.v.removeLabel(l as $3Dmol.Label));
    m.shapes = []; m.labels = [];
  }
  setMeasurementVisible(name: string, on: boolean) {
    const m = this.measurements.find((x) => x.name === name);
    if (!m) return false;
    this.eraseMeasurement(m);
    m.visible = on;
    if (on) this.drawMeasurement(m);
    this.v.render();
    this.emit("measurements");
    return true;
  }
  deleteMeasurement(name: string) {
    const m = this.measurements.find((x) => x.name === name);
    if (!m) return false;
    this.eraseMeasurement(m);
    this.measurements = this.measurements.filter((x) => x !== m);
    this.v.render();
    this.emit("measurements");
    return true;
  }
  nextMeasureName(prefix: string) {
    let i = 1;
    while (this.measurements.some((m) => m.name === `${prefix}${String(i).padStart(2, "0")}`)) i++;
    return `${prefix}${String(i).padStart(2, "0")}`;
  }

  // ---------- view ----------
  private sel(m: Mask): AnyRec { return { predicate: (a: PAtom) => m[a.gid] === 1 && a.obj.enabled }; }
  zoom(m: Mask, ms = 600) {
    this.v.zoomTo((m.includes(1) ? this.sel(m) : {}) as AnyRec, ms);
    this.baseSlab = null;
    this.v.render();
  }
  center(m: Mask, ms = 600) { this.v.center(this.sel(m) as AnyRec, ms); this.v.render(); }
  reset() {
    const view = this.v.getView();
    view[4] = 0; view[5] = 0; view[6] = 0; view[7] = 1;
    this.v.setView(view);
    this.zoom(this.mask(() => true), 400);
  }
  /** Align principal axes of the selection with the screen (largest along x), like PyMOL's orient. */
  orient(m: Mask) {
    const atoms = this.atomsOf(m).filter((a) => a.obj.enabled);
    if (atoms.length < 3) { this.zoom(m); return; }
    const c = { x: avg(atoms, "x"), y: avg(atoms, "y"), z: avg(atoms, "z") };
    const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const a of atoms) {
      const d = [a.x - c.x, a.y - c.y, a.z - c.z];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j];
    }
    const { vectors } = jacobiEigen(cov);
    const e1 = vectors[0], e2 = vectors[1];
    const e3 = cross(e1, e2);
    const q = quatFromRows([e1, e2, e3]);
    const view = this.v.getView();
    view[4] = q[0]; view[5] = q[1]; view[6] = q[2]; view[7] = q[3];
    this.v.setView(view);
    this.zoom(m, 500);
  }
  turn(axis: "x" | "y" | "z", deg: number) { this.v.rotate(deg, axis, 300); }
  move(axis: "x" | "y" | "z", amount: number) {
    const view = this.v.getView();
    if (axis === "z") { view[3] += amount; }
    else { this.v.translate(axis === "x" ? amount * 10 : 0, axis === "y" ? -amount * 10 : 0, 200); return; }
    this.v.setView(view);
  }
  setSpin(on: boolean) {
    this.setRock(false, true);
    this.spinning = on;
    this.v.spin(on ? "y" : false, 0.6);
    this.emit("view");
  }
  setRock(on: boolean, silent = false) {
    cancelAnimationFrame(this.rockHandle);
    this.rocking = on;
    if (on) {
      if (this.spinning) { this.v.spin(false); this.spinning = false; }
      let last = performance.now();
      let t = 0;
      const step = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        t += dt;
        this.v.rotate(Math.cos(t * 1.4) * 30 * dt, "y");
        this.rockHandle = requestAnimationFrame(step);
      };
      this.rockHandle = requestAnimationFrame(step);
    }
    if (!silent) this.emit("view");
  }
  /** clip near|far|slab|reset, value (Å) — mirrors PyMOL's clip command. */
  clip(mode: string, value = 0) {
    if (!this.baseSlab) this.baseSlab = this.v.getSlab();
    const s = this.v.getSlab();
    if (mode === "reset") { this.v.setSlab(this.baseSlab.near, this.baseSlab.far); }
    else if (mode === "near") this.v.setSlab(s.near + value, s.far);
    else if (mode === "far") this.v.setSlab(s.near, s.far + value);
    else if (mode === "slab") this.v.setSlab(-value / 2, value / 2);
    else if (mode === "fraction") {
      // used by UI slider: 0 = no clipping, 1 = everything in front of center clipped
      const { near, far } = this.baseSlab;
      this.v.setSlab(near + (0 - near) * value, far);
    } else throw new Error(`Unknown clip mode "${mode}"`);
    this.v.render();
  }
  png(): string { return this.v.pngURI(); }
  resize() { this.v.resize(); this.v.render(); }

  /** Wireframe box (docking search space); null clears it. */
  setBox(center: number[] | null, size?: number[]) {
    this.boxShapes.forEach((sh) => this.v.removeShape(sh as $3Dmol.GLShape));
    this.boxShapes = [];
    if (center && size) {
      const at = (i: number, j: number, k: number) => ({
        x: center[0] + (i - 0.5) * size[0], y: center[1] + (j - 0.5) * size[1], z: center[2] + (k - 0.5) * size[2],
      });
      for (const a of [0, 1]) for (const b of [0, 1]) {
        for (const [p, q] of [[at(0, a, b), at(1, a, b)], [at(a, 0, b), at(a, 1, b)], [at(a, b, 0), at(a, b, 1)]]) {
          this.boxShapes.push(this.v.addCylinder({ start: p, end: q, radius: 0.07, color: "#0ea5e9", fromCap: 1, toCap: 1 } as AnyRec));
        }
      }
    }
    this.v.render();
  }
}

// ---------- helpers ----------
function classify(atoms: PAtom[]) {
  const groups = new Map<string, PAtom[]>();
  for (const a of atoms) {
    const k = `${a.chain}|${a.resi}|${a.icode ?? ""}|${a.resn}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(a);
  }
  for (const g of groups.values()) {
    const r = (g[0].resn || "").trim().toUpperCase();
    let cls: AtomClass;
    if (AMINO.has(r)) cls = "protein";
    else if (NUCLEIC.has(r)) cls = "nucleic";
    else if (SOLVENT.has(r)) cls = "solvent";
    else cls = g.some((a) => a.elem.toUpperCase() === "C") ? "organic" : "inorganic";
    for (const a of g) { a.cls = cls; a.reps = 0; a.icode = (a.icode ?? "").trim(); }
  }
}

const avg = (as: PAtom[], k: "x" | "y" | "z") => as.reduce((s, a) => s + a[k], 0) / as.length;
export const dist = (a: PAtom, b: PAtom) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const sub = (a: PAtom, b: PAtom) => [a.x - b.x, a.y - b.y, a.z - b.z];
const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const cross = (u: number[], v: number[]) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
export function angle(a: PAtom, b: PAtom, c: PAtom) {
  const u = sub(a, b), v = sub(c, b);
  return (Math.acos(Math.max(-1, Math.min(1, dot(u, v) / Math.hypot(...u) / Math.hypot(...v)))) * 180) / Math.PI;
}
export function dihedral(a: PAtom, b: PAtom, c: PAtom, d: PAtom) {
  const b0 = sub(a, b), b1 = sub(c, b), b2 = sub(d, c);
  const n1 = Math.hypot(...b1);
  const b1n = b1.map((x) => x / n1);
  const v = b0.map((x, i) => x - dot(b0, b1n) * b1n[i]);
  const w = b2.map((x, i) => x - dot(b2, b1n) * b1n[i]);
  const x = dot(v, w), y = dot(cross(b1n, v), w);
  return (Math.atan2(y, x) * 180) / Math.PI;
}
function summarize(m: Measurement) {
  const g = m.groups;
  if (!g.length) return "no pairs";
  if (g.length > 1) return `${g.length} ${m.kind === "contacts" ? "contacts" : "pairs"}`;
  const [a, b, c, d] = g[0];
  if (g[0].length === 2) return dist(a, b).toFixed(2) + " Å";
  if (g[0].length === 3) return angle(a, b, c).toFixed(1) + "°";
  return dihedral(a, b, c, d).toFixed(1) + "°";
}

/** Symmetric 3x3 eigen-decomposition; returns eigenvectors sorted by descending eigenvalue. */
function jacobiEigen(A: number[][]) {
  const a = A.map((r) => [...r]);
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] ** 2;
    if (off < 1e-12) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-15) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = cs * akp - sn * akq; a[k][q] = sn * akp + cs * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = cs * apk - sn * aqk; a[q][k] = sn * apk + cs * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = cs * vkp - sn * vkq; V[k][q] = sn * vkp + cs * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return { values: order.map((i) => a[i][i]), vectors: order.map((i) => [V[0][i], V[1][i], V[2][i]]) };
}

/** Quaternion [x,y,z,w] for the rotation matrix whose rows are given. */
function quatFromRows(R: number[][]): [number, number, number, number] {
  const [m00, m01, m02] = R[0], [m10, m11, m12] = R[1], [m20, m21, m22] = R[2];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  return [x, y, z, w];
}
