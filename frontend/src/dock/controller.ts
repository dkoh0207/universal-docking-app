// Docking page logic: receptor / ligand / search-box state, backend job handling and the dock-view scene.
// Framework-free; the React page renders from `store` and calls the methods below.

import { ApiError, api, subscribe } from "../api";
import { toHex, PYMOL_COLORS } from "../colors";
import { t, translateError, type Key } from "../i18n";
import { createStore } from "../lib/store";
import type { PAtom, PObject } from "../types";
import { toast } from "../ui/toast";
import type { Scene } from "../viewer";
import { CNN_SCORING, ENGINES, ENGINE_IDS, POSE_SORT, type EngineId, type Mode } from "./engines";
import { bounds, heavyAtoms, pdbqtToPdb, rmsdNearest, splitModels, toPdb } from "./pdb";

export type Src = "structure" | "upload" | "smiles";
export interface Results { text: string; modes: Mode[]; models: string[]; refRmsd: (number | null)[]; shown: number; engine: EngineId; rescoring?: boolean }
export interface Ligand { key: string; label: string; n: number }
export interface LegendItem { color: string; key: Key; n?: number }

export interface DockState {
  backend: "checking" | "offline" | "ready"; // "ready": the backend answered; see backendStatus()
  versions: Record<EngineId, string | null>;
  obabel: string | null;
  engine: EngineId;
  scoring: string;
  cnnScoring: (typeof CNN_SCORING)[number];
  poseSort: (typeof POSE_SORT)[number];
  noGpu: boolean;
  exh: string; modes: string; erange: string; seed: string; cpu: string;
  receptors: string[]; receptor: string; noWater: boolean; keepHet: boolean;
  recInfo: { n: string; chains: string } | null;
  src: Src; ligands: Ligand[]; ligKey: string | null; uploadName: string; smiles: string;
  center: string[]; size: string[]; padding: number; boxOn: boolean;
  running: boolean; stage: string; progress: number; log: string[];
  results: Results | null; showAll: boolean; contactsOn: boolean;
  legend: LegendItem[];
  why: Key | null; // why Run is disabled
}

interface Deps {
  viewer: Scene;
  dock: Scene;
  run: (cmd: string) => Promise<boolean>; // PyMOL commands on the dock scene
  toViewer: (obj: PObject) => void;
  select: (obj: PObject) => void; // make this the shared active structure (the Viewer's current object)
  openViewer: () => void;
}

const POSE_COLORS = ["tv_green", "cyan", "magenta", "tv_yellow", "salmon", "tv_orange", "violet", "lime", "pink"];
const RECEPTOR_COLOR = "slate";
const REF_COLOR = "grey60";
const LOG_LINES = 400;
const MIN_LIGAND_ATOMS = 6;
/** Crystallisation / buffer organics that are rarely the ligand of interest. */
export const ADDITIVES = new Set(["GOL", "EDO", "PEG", "PGE", "PG4", "1PE", "P6G", "DMS", "ACT", "MPD", "TRS", "BME", "FMT", "EPE", "MES", "ACY", "IPA", "CIT", "TAR", "MLI", "DTT"]);
const ENGINE_KEY = "pymol-web-engine";

export const css = (name: string) => (name === REF_COLOR ? "#999999" : toHex(PYMOL_COLORS[name]));
export const poseColor = (i: number) => css(POSE_COLORS[i % POSE_COLORS.length]);
const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const ver = (x: string | null) => x?.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? "";
const parse = (s: string) => (s.trim() === "" ? NaN : +s);

/** What the status card and Run button should say about the backend and the selected engine. */
export function backendStatus(s: DockState): { kind: "checking" | "offline" | "missing" | "ok"; missing: string[] } {
  if (s.backend !== "ready") return { kind: s.backend, missing: [] };
  const missing = [s.versions[s.engine] ? "" : ENGINES[s.engine].label, s.obabel ? "" : "Open Babel"].filter(Boolean);
  return { kind: missing.length ? "missing" : "ok", missing };
}
export { ver as shortVersion };

function savedEngine(): EngineId {
  try {
    const v = localStorage.getItem(ENGINE_KEY);
    if (v && v in ENGINES) return v as EngineId;
  } catch { /* storage unavailable */ }
  return "vina";
}

export class DockController {
  readonly store = createStore<DockState>({
    backend: "checking", versions: { vina: null, smina: null, gnina: null }, obabel: null,
    engine: savedEngine(), scoring: "", cnnScoring: "rescore", poseSort: "CNNscore", noGpu: false,
    exh: "8", modes: "9", erange: "10", seed: "", cpu: "",
    receptors: [], receptor: "", noWater: true, keepHet: false, recInfo: null,
    src: "structure", ligands: [], ligKey: null, uploadName: "", smiles: "",
    center: ["", "", ""], size: ["20", "20", "20"], padding: 8, boxOn: true,
    running: false, stage: "", progress: 0, log: [],
    results: null, showAll: true, contactsOn: false, legend: [], why: null,
  });
  private viewer: Scene;
  private dock: Scene;
  private recObj: PObject | null = null;
  private recSig = "";
  private upload: { name: string; text: string; format: string } | null = null;
  private boxFit: (() => PAtom[]) | null = null; // set while the box follows a ligand / selection
  private poll = 0;
  private job: { id: string; stop: () => void } | null = null;
  private visible = false;
  private autoPicked = false;
  private pocketOf: PObject | null = null; // object whose ligand was auto-picked
  private protObjs: PObject[] = []; // protein objects seen at the last sync, to spot a newly loaded structure
  private staleView = false; // the dock view changed while hidden (0x0 canvas): re-frame on show

  constructor(private deps: Deps) {
    this.viewer = deps.viewer;
    this.dock = deps.dock;
    this.dock.set("cartoon_transparency", 0.45);
    this.store.set({ scoring: ENGINES[this.s.engine].scoring[0] });
    this.viewer.addEventListener("objects", () => this.syncReceptorList());
    window.addEventListener("langchange", () => this.renderLegend());
    this.syncReceptorList();
  }

  private get s() { return this.store.get(); }
  private set(patch: Partial<DockState>) { this.store.set(patch); }

  // ------------------------------------------------------------- page lifecycle
  show() {
    this.visible = true;
    this.syncReceptorList();
    this.checkBackend();
    clearInterval(this.poll);
    this.poll = window.setInterval(() => this.checkBackend(), 5000);
    this.dock.resize();
    if (this.staleView) { this.staleView = false; this.zoomFocus(); }
  }
  hide() { this.visible = false; clearInterval(this.poll); }

  // ------------------------------------------------------------- backend status
  async checkBackend() {
    const before = this.s.backend;
    try {
      const st = await api<{ engines: Record<EngineId, string | null>; obabel: string | null }>("/dock/status");
      this.set({ backend: "ready", versions: { ...st.engines }, obabel: st.obabel });
      if (!this.autoPicked) { // first answer: if the chosen engine is not installed, start on one that is
        this.autoPicked = true;
        const first = ENGINE_IDS.find((id) => st.engines[id]);
        if (!st.engines[this.s.engine] && first) this.setEngine(first, false);
      }
    } catch {
      this.set({ backend: "offline" });
    }
    if (this.s.backend !== before || backendStatus(this.s).kind !== "ok") this.updateRun();
  }

  // ------------------------------------------------------------- engine & parameters
  setEngine(engine: EngineId, remember = true) {
    this.set({ engine, scoring: ENGINES[engine].scoring[0] });
    if (remember) { try { localStorage.setItem(ENGINE_KEY, engine); } catch { /* storage unavailable */ } }
    this.updateRun();
  }
  setParams(patch: Partial<Pick<DockState, "scoring" | "cnnScoring" | "poseSort" | "noGpu" | "exh" | "modes" | "erange" | "seed" | "cpu">>) {
    this.set(patch);
    this.updateRun();
  }

  // ------------------------------------------------------------- receptor
  private objs() { return this.viewer.objects; }

  private syncReceptorList() {
    const prot = this.objs().filter((o) => o.atoms.some((a) => a.cls === "protein" || a.cls === "nucleic"));
    const names = prot.map((o) => o.name);
    const fresh = prot.filter((o) => !this.protObjs.includes(o)).at(-1); // a fetched / loaded structure wins over the current one
    this.protObjs = prot;
    const keep = fresh ? fresh.name : this.recObj && names.includes(this.recObj.name) ? this.recObj.name : (names.at(-1) ?? "");
    this.set({ receptors: names });
    this.setReceptor(keep);
  }

  setReceptor(name: string) {
    const obj = this.objs().find((o) => o.name === name) ?? null;
    this.set({ receptor: name });
    if (obj) this.deps.select(obj);
    if (obj !== this.recObj) {
      this.recObj = obj;
      this.set({ ligKey: null });
      this.boxFit = null;
      this.clearResults();
      this.syncLigand();
    }
    this.syncReceptor();
    this.renderLigand();
    if (obj && obj !== this.pocketOf) { this.pocketOf = obj; this.autoPickLigand(); }
  }

  /** Select the ligand of interest (largest non-additive organic residue) and fit the search box around it. */
  private autoPickLigand() {
    if (this.s.src !== "structure" || this.s.ligKey) return;
    let best: string | null = null, n = 0;
    for (const [key, l] of this.ligands()) {
      if (l.atoms.length >= MIN_LIGAND_ATOMS && !ADDITIVES.has(key.split("|")[3]) && l.atoms.length > n) { best = key; n = l.atoms.length; }
    }
    if (!best) { toast(t("dock.noPocket")); return; }
    this.pickLigand(best);
    if (this.visible) this.zoomFocus();
  }

  /** The complex for an MD run: receptor PDB plus the ligand choices (crystal ligand, each docked pose) as PDB text. */
  mdInputs() {
    if (!this.recObj) return null;
    const crystal = this.s.src === "structure" ? this.ligandAtoms() : [];
    const options: { id: string; label: string; pdb: string }[] = [];
    if (crystal.length) options.push({ id: "crystal", label: t("md.crystal"), pdb: toPdb(crystal) });
    const r = this.s.results;
    r?.models.forEach((m, i) => options.push({ id: `pose_${i + 1}`, label: t("md.pose", { n: i + 1, aff: r.modes[i]?.affinity.toFixed(1) ?? "?" }), pdb: pdbqtToPdb(m) }));
    return {
      receptor: this.recObj.name, receptorPdb: toPdb(this.receptorAtoms()), options,
      resname: this.s.src === "structure" ? this.s.ligKey?.split("|")[3] ?? "" : "", smiles: this.s.src === "smiles" ? this.s.smiles.trim() : "",
    };
  }

  setReceptorOptions(patch: { noWater?: boolean; keepHet?: boolean }) {
    this.set(patch);
    this.syncReceptor();
  }

  /** Atoms sent as the receptor: polymer, plus optional water / metals / cofactors (never the chosen ligand). */
  private receptorAtoms(): PAtom[] {
    const o = this.recObj;
    if (!o) return [];
    const { noWater, keepHet: keep } = this.s;
    const lig = new Set(this.s.src === "structure" ? this.ligandAtoms() : []);
    return o.atoms.filter((a) => a.cls === "protein" || a.cls === "nucleic"
      || (a.cls === "solvent" && !noWater) || (keep && (a.cls === "inorganic" || (a.cls === "organic" && !lig.has(a)))));
  }

  private syncReceptor() {
    const atoms = this.receptorAtoms();
    const { noWater, keepHet } = this.s;
    const sig = `${this.recObj?.name}|${atoms.length}|${noWater}|${keepHet}`;
    this.set({
      recInfo: atoms.length
        ? { n: atoms.length.toLocaleString(), chains: [...new Set(atoms.filter((a) => a.cls === "protein" || a.cls === "nucleic").map((a) => a.chain))].join(", ") || "–" }
        : null,
    });
    if (sig !== this.recSig || (this.recObj && !this.dock.objects.some((o) => o.name === "receptor"))) {
      this.recSig = sig;
      this.staleView ||= !this.visible;
      this.dock.deleteObject("receptor");
      if (atoms.length) {
        this.dock.addObject("receptor", toPdb(atoms), "pdb");
        this.deps.run(`color ${RECEPTOR_COLOR}, receptor and polymer`);
      }
      this.clearResults();
    }
    this.renderLegend();
    this.updateRun();
  }

  // ------------------------------------------------------------- ligand
  private ligands() {
    const groups = new Map<string, { label: string; atoms: PAtom[] }>();
    for (const a of this.recObj?.atoms ?? []) {
      if (a.cls !== "organic") continue;
      const key = `${a.chain}|${a.resi}|${a.icode ?? ""}|${a.resn}`;
      (groups.get(key) ?? groups.set(key, { label: `${a.resn} ${a.chain}${a.resi}`, atoms: [] }).get(key)!).atoms.push(a);
    }
    return groups;
  }
  private ligandAtoms(): PAtom[] { return (this.s.ligKey && this.ligands().get(this.s.ligKey)?.atoms) || []; }

  setSrc(src: Src) {
    this.set({ src });
    this.boxFit = null;
    this.syncLigand();
    this.syncReceptor();
    this.renderLigand();
  }

  pickLigand(key: string | null) {
    this.set({ ligKey: key === this.s.ligKey ? null : key });
    this.syncLigand();
    this.syncReceptor();
    this.renderLigand();
    const atoms = this.ligandAtoms();
    if (atoms.length) { this.boxFit = () => this.ligandAtoms(); this.fit(atoms); }
  }

  async setUpload(f: File) {
    const ext = f.name.split(".").pop()!.toLowerCase();
    const format = ({ sdf: "sdf", mol: "sdf", mol2: "mol2", pdb: "pdb" } as Record<string, string>)[ext];
    if (!format) { toast(t("unsupported", { ext }), "err"); return; }
    this.upload = { name: f.name, text: await f.text(), format };
    this.renderLigand();
  }

  setSmiles(smiles: string) { this.set({ smiles }); this.updateRun(); }

  /** Crystal ligand shown in the dock view (only while it is the docking input). */
  private syncLigand() {
    this.staleView ||= !this.visible;
    this.dock.deleteObject("ref_ligand");
    const atoms = this.s.src === "structure" ? this.ligandAtoms() : [];
    if (atoms.length) {
      this.dock.addObject("ref_ligand", toPdb(atoms), "pdb");
      this.deps.run(`hide everything, ref_ligand; show sticks, ref_ligand; color ${REF_COLOR}, ref_ligand and elem C; color atomic, ref_ligand and not elem C`);
    }
    this.clearResults();
    this.renderLegend();
  }

  private renderLigand() {
    this.set({
      ligands: [...this.ligands()].map(([key, l]) => ({ key, label: l.label, n: l.atoms.length })),
      uploadName: this.upload?.name ?? "",
    });
    this.updateRun();
  }

  private ligandPayload(): { text: string; format: string } | null {
    const { src, smiles } = this.s;
    if (src === "structure") { const a = this.ligandAtoms(); return a.length ? { text: toPdb(a), format: "pdb" } : null; }
    if (src === "upload") return this.upload ? { text: this.upload.text, format: this.upload.format } : null;
    const s = smiles.trim();
    return s ? { text: s, format: "smiles" } : null;
  }

  // ------------------------------------------------------------- search box
  centerOnLigand() {
    const atoms = this.ligandAtoms();
    if (!atoms.length) { toast(t("dock.needLigand"), "err"); return; }
    this.boxFit = () => this.ligandAtoms();
    this.fit(atoms);
  }
  centerOnSelection() {
    const atoms = [...(this.viewer.selections.get("sele") ?? [])].filter((a) => a.obj.enabled);
    if (!atoms.length) { toast(t("dock.needSele"), "err"); return; }
    this.boxFit = () => [...atoms];
    this.fit(atoms);
  }
  setVec(which: "center" | "size", i: number, value: string) {
    const v = [...this.s[which]];
    v[i] = value;
    this.boxFit = null;
    this.set({ [which]: v });
    this.updateBox();
  }
  setPadding(padding: number) {
    this.set({ padding });
    if (this.boxFit) { const a = this.boxFit(); if (a.length) this.fit(a); }
  }
  toggleBox() { this.set({ boxOn: !this.s.boxOn }); this.updateBox(); }

  private fit(atoms: PAtom[]) {
    const { center, extent } = bounds(atoms);
    const pad = this.s.padding;
    this.set({
      center: center.map((v) => String(round(v))),
      size: extent.map((e) => String(round(Math.min(126, Math.max(1, e + pad))))),
    });
    this.updateBox();
  }

  private boxValue() {
    const c = this.s.center.map(parse), z = this.s.size.map(parse);
    return c.every(Number.isFinite) && z.every((v) => Number.isFinite(v) && v >= 1 && v <= 126) ? { center: c, size: z } : null;
  }
  private updateBox() {
    const b = this.boxValue();
    this.dock.setBox(b && this.s.boxOn ? b.center : null, b?.size);
    this.updateRun();
  }

  // ------------------------------------------------------------- running
  private updateRun() {
    const { running } = this.s;
    const why: Key | null = running ? null
      : backendStatus(this.s).kind !== "ok" ? "dock.why.backend"
      : !this.recObj ? "dock.why.receptor"
      : !this.ligandPayload() ? "dock.why.ligand"
      : !this.boxValue() ? "dock.why.box"
      : null;
    this.set({ why });
  }

  toggleRun() { return this.job ? this.cancel() : this.start(); }

  private async start() {
    const box = this.boxValue(), lig = this.ligandPayload();
    if (!this.recObj || !box || !lig) return;
    const s = this.s;
    const opt = (v: string) => { const n = parse(v); return Number.isFinite(n) ? n : undefined; };
    const body = {
      receptor_pdb: toPdb(this.receptorAtoms()), ligand: lig, center: box.center, size: box.size,
      exhaustiveness: opt(s.exh) ?? 8, num_modes: opt(s.modes) ?? 9, energy_range: opt(s.erange) ?? 3,
      seed: opt(s.seed), cpu: opt(s.cpu), engine: s.engine, scoring: s.scoring,
      ...(ENGINES[s.engine].cnn ? { cnn_scoring: s.cnnScoring, pose_sort: s.poseSort, no_gpu: s.noGpu } : {}),
    };
    this.clearResults();
    this.set({ log: [], stage: "", progress: 0, running: true });
    this.job = { id: "", stop: () => undefined };
    this.updateRun();
    try {
      const { id } = await api<{ id: string }>("/dock/jobs", { json: body });
      if (!this.job) { api(`/dock/jobs/${id}`, { method: "DELETE" }).catch(() => undefined); return; } // cancelled while submitting
      const finish = () => { this.job?.stop(); this.job = null; this.set({ running: false }); this.updateRun(); };
      const fail = (message: string) => { this.set({ stage: `err:${message}` }); finish(); toast(translateError(message), "err"); };
      this.job.id = id;
      this.job.stop = subscribe(`/dock/jobs/${id}/events`, {
        stage: (d) => this.set({ stage: d.stage }),
        progress: (d) => this.set({ progress: d.value }),
        log: (d) => this.set({ log: [...this.s.log, d.text].slice(-LOG_LINES) }),
        done: (d) => { this.set({ stage: "done" }); finish(); this.onDone(d.poses, d.modes, body.engine); },
        error: (d) => { if (d.cancelled) { this.set({ stage: "cancelled" }); finish(); } else fail(d.message); },
      }, () => fail(t("dock.lost")));
    } catch (e) {
      this.job = null;
      const offline = e instanceof ApiError && e.status === 0;
      const message = offline ? t("dock.status.offline") : (e as Error).message;
      this.set({ running: false, stage: `err:${message}`, ...(offline ? { backend: "offline" as const } : {}) });
      this.updateRun();
      toast(message, "err");
    }
  }

  private async cancel() {
    const job = this.job;
    if (!job) return;
    job.stop();
    this.job = null;
    this.set({ stage: "cancelled", running: false });
    this.updateRun();
    if (job.id) api(`/dock/jobs/${job.id}`, { method: "DELETE" }).catch(() => undefined);
  }

  // ------------------------------------------------------------- results
  private clearResults() {
    for (const o of [...this.dock.objects]) if (o.name.startsWith("pose_")) this.dock.deleteObject(o.name);
    this.dock.deleteMeasurement("dock_contacts");
    this.set({ results: null });
    this.renderLegend();
  }

  private onDone(text: string, modes: Mode[], engine: EngineId) {
    const models = splitModels(text);
    const ref = this.s.src === "structure" && this.s.ligKey ? heavyAtoms(toPdb(this.ligandAtoms())) : null;
    const refRmsd = models.map((m) => (ref ? rmsdNearest(heavyAtoms(m), ref) : null));
    this.set({ results: { text, modes, models, refRmsd, shown: 0, engine } });
    models.forEach((m, i) => {
      const name = `pose_${i + 1}`;
      this.dock.addObject(name, pdbqtToPdb(m), "pdb");
      this.deps.run(`hide everything, ${name}; show sticks, ${name} and not elem H; color ${POSE_COLORS[i % POSE_COLORS.length]}, ${name} and elem C; color atomic, ${name} and not elem C`);
    });
    this.showPose(0);
    this.deps.run(`zoom pose_1${this.dock.objects.some((o) => o.name === "ref_ligand") ? " or ref_ligand" : ""}`); // crystal ligand stays as the overlay
    if (modes.length) toast(t("dock.done", { aff: modes[0].affinity.toFixed(1) }));
  }

  /** Rescore the docked poses with AEV-PLIG (a GNN predicting pKd); adds a column to the results table. */
  async rescore() {
    const r = this.s.results;
    if (!r || r.rescoring) return;
    this.set({ results: { ...r, rescoring: true } });
    const stop = (modes?: Mode[]) => { const c = this.s.results; if (c) this.set({ results: { ...c, rescoring: false, ...(modes ? { modes } : {}) } }); };
    try {
      const { id } = await api<{ id: string }>("/rescore/jobs", { json: { receptor_pdb: toPdb(this.receptorAtoms()), poses: r.text, scorer: "aev_plig" } });
      const close = subscribe(`/rescore/jobs/${id}/events`, {
        done: (d) => {
          close();
          const cur = this.s.results;
          stop(cur?.modes.map((m, i) => ({ ...m, aev_plig: d.scores[i] ?? undefined })));
        },
        error: (d) => { close(); stop(); toast(translateError(d.message), "err"); },
      }, () => { close(); stop(); toast(t("dock.lost"), "err"); });
    } catch (e) {
      stop();
      toast((e as Error).message, "err");
    }
  }

  showPose(i: number) {
    const r = this.s.results;
    if (!r) return;
    this.set({ results: { ...r, shown: i } });
    r.models.forEach((_, j) => this.dock.setEnabled(`pose_${j + 1}`, j === i || this.s.showAll));
    this.applyContacts();
    this.renderLegend();
  }

  setShowAll(showAll: boolean) { this.set({ showAll }); this.showPose(this.s.results?.shown ?? 0); }

  toggleContacts() { this.set({ contactsOn: !this.s.contactsOn }); this.applyContacts(); }

  private async applyContacts() {
    const r = this.s.results;
    this.dock.deleteMeasurement("dock_contacts");
    if (r && this.s.contactsOn) await this.deps.run(`polar_contacts pose_${r.shown + 1}, receptor and polymer, dock_contacts`);
  }

  /** Whether the polar-contact lines are currently drawn (drives the button label). */
  contactsShown() { return this.dock.measurements.some((m) => m.name === "dock_contacts"); }

  download() {
    const r = this.s.results;
    if (!r) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([r.text], { type: "chemical/x-pdbqt" }));
    a.download = `${r.engine}_out.pdbqt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  resetView() { this.dock.reset(); }
  png() {
    const a = document.createElement("a");
    a.href = this.dock.png();
    a.download = "docking.png";
    a.click();
  }

  zoomFocus() {
    const r = this.s.results;
    if (r) this.deps.run(`zoom pose_${r.shown + 1}`);
    else if (this.dock.objects.some((o) => o.name === "ref_ligand")) this.deps.run("zoom ref_ligand");
    else this.dock.reset();
  }

  sendToViewer() {
    const r = this.s.results;
    if (!r || !this.recObj) return;
    const base = this.recObj.name;
    this.deps.toViewer(this.viewer.addObject(`${base}_dock`, toPdb(this.receptorAtoms()), "pdb"));
    const picks = this.s.showAll ? r.models.map((_, i) => i) : [r.shown];
    for (const i of picks) {
      const obj = this.viewer.addObject(`${base}_pose${i + 1}`, pdbqtToPdb(r.models[i]), "pdb");
      this.deps.toViewer(obj);
    }
    toast(t("dock.sent"));
    this.deps.openViewer();
  }

  // ------------------------------------------------------------- legend
  private renderLegend() {
    const legend: LegendItem[] = [];
    if (this.dock.objects.some((o) => o.name === "receptor")) legend.push({ color: css(RECEPTOR_COLOR), key: "dock.leg.receptor" });
    if (this.dock.objects.some((o) => o.name === "ref_ligand")) legend.push({ color: css(REF_COLOR), key: "dock.leg.ref" });
    const r = this.s.results;
    if (r) r.models.forEach((_, i) => { if (i === r.shown || this.s.showAll) legend.push({ color: poseColor(i), key: "dock.leg.pose", n: i + 1 }); });
    this.set({ legend });
  }
}
