// MD page logic: run settings, the backend OpenMM job, results (metrics, ProLIF history) and trajectory playback.

import { ApiError, api, subscribe } from "../api";
import { t, translateError } from "../i18n";
import { createStore } from "../lib/store";
import { toast } from "../ui/toast";
import type { Scene } from "../viewer";
import type { DockController } from "../dock/controller";

export interface RunInfo {
  id: string; example: boolean; name: string; created: string; production_ns: number; frames: number; platform: string; atoms: number; checks_ok: number; checks: number;
}
export interface Check { id: string; ok: boolean; value: number; target: number; unit: string }
export interface Interaction { res: string; type: string; present: number[]; occupancy: number }
export interface MdResults {
  config: Record<string, unknown>;
  meta: { frames: number; frames_requested: number; report_ps: number; platform: string; atoms: number; ns_per_day: number; truncated: boolean; prod_wall_s: number };
  times: number[];
  rmsd: { protein: number[]; ligand: number[] };
  rmsf: { res: number[]; chain: string[]; value: number[] };
  rg: number[]; com_dist: number[]; min_dist: number[]; contacts: number[];
  state: { time: number[]; potential: number[]; kinetic: number[]; total: number[]; temperature: number[]; density: number[]; volume: number[] };
  interactions: { times: number[]; items: Interaction[] };
  checks: Check[]; view_frames: number; view_dt_ps: number; pocket: string[];
}

/** Editable settings are kept as strings (empty / invalid falls back to the default). */
export const DEFAULTS = {
  productionNs: "0.1", reportPs: "10", timestepFs: "2", hmr: false, temperature: "300", pressure: "1", friction: "1", barostatInterval: "25",
  padding: "1.0", ionic: "0.15", waterModel: "tip3p", proteinFf: "amber14-all", ligandFf: "openff-2.1.0", charges: "gasteiger", cutoff: "1.0",
  minimize: "1000", nvt: "50", npt: "100", restraint: "1000", platform: "auto", maxWall: "300", seed: "42",
};
export type Settings = typeof DEFAULTS;

export interface MdState extends Settings {
  backend: "checking" | "offline" | "missing" | "ready"; info: { openmm?: string; prolif?: string; platforms?: string[]; error?: string };
  receptor: string; ligand: string; options: { id: string; label: string }[]; smiles: string; resname: string;
  running: boolean; stage: string; progress: number; frames: number; log: string[];
  runs: RunInfo[]; run: string; results: MdResults | null; frame: number; playing: boolean; focus: string | null; why: string | null;
}

const LOG_LINES = 400;
const num = (v: string, d: number) => (v.trim() !== "" && Number.isFinite(+v) ? +v : d);

export class MdController {
  readonly store = createStore<MdState>({
    ...DEFAULTS, backend: "checking", info: {}, receptor: "", ligand: "", options: [], smiles: "", resname: "",
    running: false, stage: "", progress: 0, frames: 0, log: [], runs: [], run: "", results: null, frame: 0, playing: false, focus: null, why: null,
  });
  private job: { id: string; stop: () => void } | null = null;
  private poll = 0;
  private visible = false;
  private inputs: ReturnType<DockController["mdInputs"]> = null;
  private frames: string[] = [];
  private timer = 0;
  private drawing = false;

  constructor(private dock: DockController, private scene: Scene, private run: (cmd: string) => Promise<boolean>) {
    scene.set("cartoon_transparency", 0.2);
    dock.store.subscribe(() => { if (this.visible) this.syncInputs(); });
    window.addEventListener("langchange", () => this.syncInputs());
  }

  private get s() { return this.store.get(); }
  private set(patch: Partial<MdState>) { this.store.set(patch); this.updateWhy(); }

  show() {
    this.visible = true;
    this.syncInputs();
    this.checkBackend();
    this.refreshRuns();
    clearInterval(this.poll);
    this.poll = window.setInterval(() => this.checkBackend(), 8000);
    this.scene.resize();
  }
  hide() { this.visible = false; clearInterval(this.poll); this.pause(); }

  async checkBackend() {
    try {
      const st = await api<{ ok: boolean; error?: string; openmm?: string; prolif?: string; platforms?: string[] }>("/md/status");
      this.set({ backend: st.ok ? "ready" : "missing", info: st });
    } catch {
      this.set({ backend: "offline", info: {} });
    }
  }

  // ------------------------------------------------------------- past runs
  async refreshRuns() {
    try { this.set({ runs: await api<RunInfo[]>("/md/runs") }); } catch { /* backend offline: the status card says so */ }
  }

  /** Show a stored run (bundled example or saved run) without simulating again. */
  async loadRun(id: string) {
    if (this.s.running || !id) return;
    this.pause();
    this.clearScene();
    this.set({ run: id, results: null, stage: "", frame: 0, focus: null });
    await this.loadResults(`/md/runs/${id}`);
  }

  async deleteRun(id: string) {
    try {
      await api(`/md/runs/${id}`, { method: "DELETE" });
      if (this.s.run === id) { this.clearScene(); this.set({ run: "", results: null }); }
      await this.refreshRuns();
    } catch (e) { toast((e as Error).message, "err"); }
  }

  /** Take the receptor and ligand choices from the Docking page (the shared active structure). */
  syncInputs() {
    const inp = this.dock.mdInputs();
    this.inputs = inp;
    const options = inp?.options.map(({ id, label }) => ({ id, label })) ?? [];
    const ligand = options.some((o) => o.id === this.s.ligand) ? this.s.ligand : (options[0]?.id ?? "");
    this.set({ receptor: inp?.receptor ?? "", options, ligand, resname: inp?.resname ?? "", smiles: this.s.smiles || inp?.smiles || "" });
  }

  setSettings(patch: Partial<MdState>) { this.set(patch); }
  reset() { this.set({ ...DEFAULTS }); }

  private updateWhy() {
    const s = this.s;
    const why = s.backend !== "ready" ? t("md.why.backend") : !s.receptor ? t("md.why.receptor") : !s.ligand ? t("md.why.ligand")
      : !(s.smiles.trim() || s.resname) ? t("md.why.smiles") : null;
    if (why !== s.why) this.store.set({ why });
  }

  toggleRun() { return this.job ? this.cancel() : this.start(); }

  private body() {
    const s = this.s, inp = this.inputs!, lig = inp.options.find((o) => o.id === s.ligand)!;
    return {
      receptor_pdb: inp.receptorPdb, ligand_pdb: lig.pdb, smiles: s.smiles.trim() || undefined, ligand_resname: s.resname || undefined,
      label: `${inp.receptor} · ${lig.label}`,
      production_ns: num(s.productionNs, 0.1), report_ps: num(s.reportPs, 10), timestep_fs: num(s.timestepFs, 2), hmr: s.hmr,
      temperature_k: num(s.temperature, 300), pressure_bar: num(s.pressure, 1), friction_ps: num(s.friction, 1), barostat_interval: Math.round(num(s.barostatInterval, 25)),
      padding_nm: num(s.padding, 1), ionic_strength_m: num(s.ionic, 0.15), water_model: s.waterModel, protein_ff: s.proteinFf, ligand_ff: s.ligandFf, ligand_charges: s.charges, cutoff_nm: num(s.cutoff, 1),
      minimize_steps: Math.round(num(s.minimize, 1000)), nvt_ps: Math.round(num(s.nvt, 50)), npt_ps: Math.round(num(s.npt, 100)), restraint_k: num(s.restraint, 1000),
      platform: s.platform, max_wall_s: Math.round(num(s.maxWall, 300)), seed: Math.round(num(s.seed, 42)),
    };
  }

  private async start() {
    this.syncInputs();
    if (!this.inputs || this.s.why) { if (this.s.why) toast(this.s.why, "err"); return; }
    const body = this.body();
    this.pause();
    this.clearScene();
    this.set({ log: [], stage: "", progress: 0, frames: 0, running: true, results: null, run: "", frame: 0 });
    this.job = { id: "", stop: () => undefined };
    try {
      const { id } = await api<{ id: string }>("/md/jobs", { json: body });
      if (!this.job) { api(`/md/jobs/${id}`, { method: "DELETE" }).catch(() => undefined); return; }
      const finish = () => { this.job?.stop(); this.job = null; this.set({ running: false }); };
      const fail = (message: string) => { this.set({ stage: `err:${message}` }); finish(); toast(translateError(message), "err"); };
      this.job.id = id;
      this.job.stop = subscribe(`/md/jobs/${id}/events`, {
        stage: (d) => this.set({ stage: d.stage, progress: 0 }),
        progress: (d) => this.set({ progress: d.value, ...(d.frames !== undefined ? { frames: d.frames } : {}) }),
        log: (d) => this.set({ log: [...this.s.log, d.text].slice(-LOG_LINES) }),
        done: async (d) => {
          finish();
          this.set({ stage: "done", run: d.run ?? "" });
          this.loadResults(d.run ? `/md/runs/${d.run}` : `/md/jobs/${id}`);
          this.refreshRuns();
        },
        error: (d) => { if (d.cancelled) { this.set({ stage: "cancelled" }); finish(); } else fail(d.message); },
      }, () => fail(t("dock.lost")));
    } catch (e) {
      this.job = null;
      const offline = e instanceof ApiError && e.status === 0;
      const message = offline ? t("dock.status.offline") : (e as Error).message;
      this.set({ running: false, stage: `err:${message}`, ...(offline ? { backend: "offline" as const } : {}) });
      toast(message, "err");
    }
  }

  private cancel() {
    const job = this.job;
    if (!job) return;
    job.stop();
    this.job = null;
    this.set({ stage: "cancelled", running: false });
    if (job.id) api(`/md/jobs/${job.id}`, { method: "DELETE" }).catch(() => undefined);
  }

  // ------------------------------------------------------------- results & playback
  private async loadResults(base: string) {
    try {
      const results = await api<MdResults>(`${base}/results`);
      const text = await (await fetch(`/api${base}/view.pdb`)).text();
      this.frames = text.split(/^ENDMDL.*$/m).map((f) => f.replace(/^MODEL.*$/m, "").trim()).filter((f) => f.includes("ATOM")).map((f) => f + "\nEND\n");
      this.set({ results, frame: 0, focus: null });
      this.draw(true);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  private clearScene() { for (const o of [...this.scene.objects]) this.scene.deleteObject(o.name); this.frames = []; }

  /** Show frame `i` of the view trajectory (the object is rebuilt: 3Dmol caches cartoon geometry per model). */
  async draw(zoom = false) {
    if (this.drawing || !this.frames.length) return;
    this.drawing = true;
    try {
      const i = Math.min(this.s.frame, this.frames.length - 1);
      this.scene.deleteObject("md");
      this.scene.addObject("md", this.frames[i], "pdb");
      const focus = this.s.focus;
      await this.run("hide everything, md; show cartoon, md and polymer; color slate, md and polymer and elem C; show sticks, md and resn LIG; color tv_green, md and resn LIG and elem C; color atomic, md and resn LIG and not elem C");
      if (focus) await this.run(`show sticks, md and resi ${focus} and polymer; color atomic, md and resi ${focus} and polymer and not elem C; color tv_orange, md and resi ${focus} and polymer and elem C`);
      if (zoom) await this.run("zoom md and resn LIG, 14");
    } finally { this.drawing = false; }
    if (this.pending) { this.pending = false; this.draw(); }
  }
  private pending = false;

  setFrame(i: number) {
    this.store.set({ frame: i });
    if (this.drawing) this.pending = true; else this.draw();
  }
  play() {
    if (!this.frames.length) return;
    this.set({ playing: true });
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.setFrame((this.s.frame + 1) % this.frames.length), 140);
  }
  pause() { clearInterval(this.timer); if (this.s.playing) this.set({ playing: false }); }
  /** Highlight a residue ("ILE50") of the pocket in the 3D view. */
  focusResidue(res: string | null) {
    const num = res?.match(/\d+/)?.[0] ?? null;
    this.set({ focus: num });
    this.draw();
  }
  frameCount() { return this.frames.length; }
  resetView() { this.scene.reset(); }
  zoomLigand() { this.run("zoom md and resn LIG, 14"); }
  png() {
    const a = document.createElement("a");
    a.href = this.scene.png();
    a.download = "md.png";
    a.click();
  }
  resize() { this.scene.resize(); }
}
