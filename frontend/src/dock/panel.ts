// Docking page: sidebar cards, backend job handling and the dock-view scene.

import { ApiError, api, subscribe } from "../api";
import { toHex, PYMOL_COLORS } from "../colors";
import { t, translateError, type Key } from "../i18n";
import type { PAtom, PObject } from "../types";
import { esc, icon, refreshIcons } from "../ui/icons";
import { toast } from "../ui/toast";
import type { Scene } from "../viewer";
import { bounds, heavyByName, pdbqtToPdb, rmsdByName, splitModels, toPdb } from "./pdb";

type Src = "structure" | "upload" | "smiles";
type Backend = "checking" | "offline" | "missing" | "ok";
interface Mode { mode: number; affinity: number; rmsd_lb: number; rmsd_ub: number }
interface Results { text: string; modes: Mode[]; models: string[]; refRmsd: (number | null)[]; shown: number }
interface Deps {
  viewer: Scene;
  dock: Scene;
  run: (cmd: string) => Promise<boolean>; // PyMOL commands on the dock scene
  toViewer: (obj: PObject) => void;
  openViewer: () => void;
}

const POSE_COLORS = ["tv_green", "cyan", "magenta", "tv_yellow", "salmon", "tv_orange", "violet", "lime", "pink"];
const RECEPTOR_COLOR = "slate";
const REF_COLOR = "grey60";
const LOG_LINES = 400;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (id: string) => ($<HTMLInputElement>(id).value.trim() === "" ? NaN : +$<HTMLInputElement>(id).value);
const css = (name: string) => toHex(PYMOL_COLORS[name]);
const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

export class DockPanel {
  private viewer: Scene;
  private dock: Scene;
  private recObj: PObject | null = null;
  private recSig = "";
  private src: Src = "structure";
  private ligKey: string | null = null;
  private upload: { name: string; text: string; format: string } | null = null;
  private boxFit: (() => PAtom[]) | null = null; // set while the box follows a ligand / selection
  private boxOn = true;
  private backend: Backend = "checking";
  private versions = { vina: "", obabel: "" };
  private missing: string[] = [];
  private poll = 0;
  private job: { id: string; stop: () => void } | null = null;
  private stage = "";
  private progress = 0;
  private logLines: string[] = [];
  private results: Results | null = null;
  private showAll = false;
  private contactsOn = false;
  private visible = false;
  private staleView = false; // the dock view changed while hidden (0x0 canvas): re-frame on show

  constructor(private deps: Deps) {
    this.viewer = deps.viewer;
    this.dock = deps.dock;
    this.dock.set("cartoon_transparency", 0.45);
    this.bind();
    this.viewer.addEventListener("objects", () => this.syncReceptorList());
    window.addEventListener("langchange", () => this.renderAll());
    this.renderAll();
  }

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

  // ------------------------------------------------------------- wiring
  private bind() {
    $("dk-receptor").addEventListener("change", () => this.setReceptor(($("dk-receptor") as HTMLSelectElement).value));
    for (const id of ["dk-nowater", "dk-keep"]) $(id).addEventListener("change", () => this.syncReceptor());

    $("dk-lig-src").addEventListener("click", (e) => {
      const v = (e.target as HTMLElement).closest<HTMLElement>("button")?.dataset.v as Src | undefined;
      if (v) this.setSrc(v);
    });
    $("dk-lig-chips").addEventListener("click", (e) => {
      const key = (e.target as HTMLElement).closest<HTMLElement>("[data-key]")?.dataset.key;
      if (key) this.pickLigand(key === this.ligKey ? null : key);
    });
    $<HTMLInputElement>("dk-lig-file").addEventListener("change", async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      (e.target as HTMLInputElement).value = "";
      if (!f) return;
      const ext = f.name.split(".").pop()!.toLowerCase();
      const format = { sdf: "sdf", mol: "sdf", mol2: "mol2", pdb: "pdb" }[ext];
      if (!format) { toast(t("unsupported", { ext }), "err"); return; }
      this.upload = { name: f.name, text: await f.text(), format };
      this.renderLigand();
      this.updateRun();
    });
    $("dk-smiles").addEventListener("input", () => this.updateRun());

    $("dk-center-lig").addEventListener("click", () => {
      const atoms = this.ligandAtoms();
      if (!atoms.length) { toast(t("dock.needLigand"), "err"); return; }
      this.boxFit = () => this.ligandAtoms();
      this.fit(atoms);
    });
    $("dk-center-sel").addEventListener("click", () => {
      const atoms = [...(this.viewer.selections.get("sele") ?? [])].filter((a) => a.obj.enabled);
      if (!atoms.length) { toast(t("dock.needSele"), "err"); return; }
      this.boxFit = () => [...atoms];
      this.fit(atoms);
    });
    for (const id of ["dk-center", "dk-size"]) $(id).addEventListener("input", () => { this.boxFit = null; this.updateBox(); });
    $<HTMLInputElement>("dk-padding").addEventListener("input", () => {
      $("dk-padding-out").textContent = `${$<HTMLInputElement>("dk-padding").value} Å`;
      if (this.boxFit) { const a = this.boxFit(); if (a.length) this.fit(a); }
    });
    for (const id of ["dk-exh", "dk-modes", "dk-erange", "dk-seed", "dk-cpu"]) $(id).addEventListener("input", () => this.updateRun());

    $("dk-run").addEventListener("click", () => (this.job ? this.cancel() : this.start()));
    $("dk-log-toggle").addEventListener("click", () => $("dk-log").classList.toggle("hidden", !$("dk-log-toggle").classList.toggle("open")));

    $("dk-results").addEventListener("click", (e) => {
      const i = (e.target as HTMLElement).closest<HTMLElement>("[data-i]")?.dataset.i;
      if (i !== undefined) this.showPose(+i);
    });
    $<HTMLInputElement>("dk-all").addEventListener("change", (e) => { this.showAll = (e.target as HTMLInputElement).checked; this.showPose(this.results?.shown ?? 0); });
    $("dk-contacts").addEventListener("click", () => { this.contactsOn = !this.contactsOn; this.applyContacts(); });
    $("dk-send").addEventListener("click", () => this.sendToViewer());
    $("dk-download").addEventListener("click", () => {
      if (!this.results) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([this.results.text], { type: "chemical/x-pdbqt" }));
      a.download = "out.pdbqt";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    $("dock-toolbar").addEventListener("click", (e) => {
      const cmd = (e.target as HTMLElement).closest<HTMLElement>("[data-dk]")?.dataset.dk;
      if (cmd === "reset") this.dock.reset();
      else if (cmd === "zoom") this.zoomFocus();
      else if (cmd === "box") { this.boxOn = !this.boxOn; this.updateBox(); }
      else if (cmd === "png") {
        const a = document.createElement("a");
        a.href = this.dock.png();
        a.download = "docking.png";
        a.click();
      } else if (cmd === "fullscreen") {
        if (document.fullscreenElement) document.exitFullscreen(); else $("dock-wrap").requestFullscreen?.();
      }
    });
    $("dk-status").addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("#dk-recheck")) this.checkBackend(); });
  }

  // ------------------------------------------------------------- backend status
  private async checkBackend() {
    const before = this.backend;
    try {
      const s = await api<{ vina: string | null; obabel: string | null }>("/dock/status");
      const ver = (x: string | null) => x?.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? "";
      this.versions = { vina: ver(s.vina), obabel: ver(s.obabel) };
      this.missing = [s.vina ? "" : "Vina", s.obabel ? "" : "Open Babel"].filter(Boolean);
      this.backend = this.missing.length ? "missing" : "ok";
    } catch {
      this.backend = "offline";
    }
    if (this.backend !== before || this.backend !== "ok") { this.renderStatus(); this.updateRun(); }
  }

  private renderStatus() {
    const b = this.backend;
    const text = b === "ok" ? t("dock.status.ok", this.versions)
      : b === "offline" ? t("dock.status.offline")
      : b === "missing" ? t("dock.status.missing", { tools: this.missing.join(", ") })
      : t("dock.status.checking");
    $("dk-status").innerHTML = `<h3>${icon("server")}<span>${esc(t("dock.backend"))}</span>
      <button class="icon-btn sm" id="dk-recheck" title="${esc(t("dock.recheck"))}" style="margin-left:auto">${icon("refresh-cw")}</button></h3>
      <div class="status ${b}"><span class="dot"></span><span>${esc(text)}</span></div>`;
    refreshIcons($("dk-status"));
  }

  // ------------------------------------------------------------- receptor
  private objs() { return this.viewer.objects; }

  private syncReceptorList() {
    const sel = $<HTMLSelectElement>("dk-receptor");
    const names = this.objs().filter((o) => o.atoms.some((a) => a.cls === "protein" || a.cls === "nucleic")).map((o) => o.name);
    sel.innerHTML = names.length ? names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("") : `<option value="">${esc(t("dock.noReceptor"))}</option>`;
    const keep = this.recObj && names.includes(this.recObj.name) ? this.recObj.name : (names.at(-1) ?? "");
    sel.value = keep;
    sel.disabled = !names.length;
    this.setReceptor(keep);
  }

  private setReceptor(name: string) {
    const obj = this.objs().find((o) => o.name === name) ?? null;
    if (obj !== this.recObj) {
      this.recObj = obj;
      this.ligKey = null;
      this.boxFit = null;
      this.clearResults();
      this.syncLigand();
    }
    this.syncReceptor();
    this.renderLigand();
    $("dock-empty").classList.toggle("hidden", !!obj);
  }

  /** Atoms sent as the receptor: polymer, plus optional water / metals / cofactors (never the chosen ligand). */
  private receptorAtoms(): PAtom[] {
    const o = this.recObj;
    if (!o) return [];
    const noWater = $<HTMLInputElement>("dk-nowater").checked, keep = $<HTMLInputElement>("dk-keep").checked;
    const lig = new Set(this.src === "structure" ? this.ligandAtoms() : []);
    return o.atoms.filter((a) => a.cls === "protein" || a.cls === "nucleic"
      || (a.cls === "solvent" && !noWater) || (keep && (a.cls === "inorganic" || (a.cls === "organic" && !lig.has(a)))));
  }

  private syncReceptor() {
    const atoms = this.receptorAtoms();
    const sig = `${this.recObj?.name}|${atoms.length}|${$<HTMLInputElement>("dk-nowater").checked}|${$<HTMLInputElement>("dk-keep").checked}`;
    $("dk-receptor-info").textContent = atoms.length
      ? t("dock.recInfo", { n: atoms.length.toLocaleString(), chains: [...new Set(atoms.filter((a) => a.cls === "protein" || a.cls === "nucleic").map((a) => a.chain))].join(", ") || "–" })
      : "";
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
  private ligandAtoms(): PAtom[] { return (this.ligKey && this.ligands().get(this.ligKey)?.atoms) || []; }

  private setSrc(s: Src) {
    this.src = s;
    this.boxFit = null;
    this.syncLigand();
    this.syncReceptor();
    this.renderLigand();
  }

  private pickLigand(key: string | null) {
    this.ligKey = key;
    this.syncLigand();
    this.syncReceptor();
    this.renderLigand();
    const atoms = this.ligandAtoms();
    if (atoms.length) { this.boxFit = () => this.ligandAtoms(); this.fit(atoms); }
  }

  /** Crystal ligand shown in the dock view (only while it is the docking input). */
  private syncLigand() {
    this.staleView ||= !this.visible;
    this.dock.deleteObject("ref_ligand");
    const atoms = this.src === "structure" ? this.ligandAtoms() : [];
    if (atoms.length) {
      this.dock.addObject("ref_ligand", toPdb(atoms), "pdb");
      this.deps.run(`hide everything, ref_ligand; show sticks, ref_ligand; color ${REF_COLOR}, ref_ligand and elem C; color atomic, ref_ligand and not elem C`);
    }
    this.clearResults();
    this.renderLegend();
  }

  private renderLigand() {
    for (const s of ["structure", "upload", "smiles"]) $(`dk-pane-${s}`).classList.toggle("hidden", s !== this.src);
    $("dk-lig-src").querySelectorAll<HTMLElement>("button").forEach((b) => b.classList.toggle("active", b.dataset.v === this.src));
    const ligs = [...this.ligands()];
    $("dk-lig-chips").innerHTML = this.recObj
      ? ligs.length
        ? ligs.map(([k, l]) => `<button data-key="${esc(k)}" class="${k === this.ligKey ? "active" : ""}" title="${esc(t("dock.heavy", { n: l.atoms.length }))}">${esc(l.label)}</button>`).join("")
        : `<span class="placeholder">${esc(t("dock.noLigands"))}</span>`
      : `<span class="placeholder">${esc(t("dock.noReceptor"))}</span>`;
    $("dk-lig-file-name").textContent = this.upload?.name ?? "";
    $("dk-center-lig").classList.toggle("disabled", this.src !== "structure" || !this.ligKey);
    this.updateRun();
  }

  private ligandPayload(): { text: string; format: string } | null {
    if (this.src === "structure") { const a = this.ligandAtoms(); return a.length ? { text: toPdb(a), format: "pdb" } : null; }
    if (this.src === "upload") return this.upload ? { text: this.upload.text, format: this.upload.format } : null;
    const s = $<HTMLInputElement>("dk-smiles").value.trim();
    return s ? { text: s, format: "smiles" } : null;
  }

  // ------------------------------------------------------------- search box
  private vec(id: string) { return [...$(id).querySelectorAll<HTMLInputElement>("input")].map((i) => (i.value.trim() === "" ? NaN : +i.value)); }
  private setVec(id: string, v: number[]) { $(id).querySelectorAll<HTMLInputElement>("input").forEach((i, k) => { i.value = String(round(v[k])); }); }

  private fit(atoms: PAtom[]) {
    const { center, extent } = bounds(atoms);
    const pad = +$<HTMLInputElement>("dk-padding").value;
    this.setVec("dk-center", center);
    this.setVec("dk-size", extent.map((e) => Math.min(126, Math.max(1, e + pad))));
    this.updateBox();
  }

  private boxValue() {
    const c = this.vec("dk-center"), s = this.vec("dk-size");
    return c.every(Number.isFinite) && s.every((v) => Number.isFinite(v) && v >= 1 && v <= 126) ? { center: c, size: s } : null;
  }
  private updateBox() {
    const b = this.boxValue();
    this.dock.setBox(b && this.boxOn ? b.center : null, b?.size);
    $("dk-box-btn").classList.toggle("active", this.boxOn);
    this.updateRun();
  }

  // ------------------------------------------------------------- running
  private updateRun() {
    const btn = $<HTMLButtonElement>("dk-run");
    const why: Key | null = this.job ? null
      : this.backend !== "ok" ? "dock.why.backend"
      : !this.recObj ? "dock.why.receptor"
      : !this.ligandPayload() ? "dock.why.ligand"
      : !this.boxValue() ? "dock.why.box"
      : null;
    btn.disabled = !this.job && !!why;
    btn.title = why ? t(why) : "";
    btn.classList.toggle("danger", !!this.job);
    btn.classList.toggle("primary", !this.job);
    btn.innerHTML = `${icon(this.job ? "square" : "play")}<span>${esc(t(this.job ? "dock.cancel" : "dock.run"))}</span>`;
    refreshIcons(btn);
  }

  private async start() {
    const box = this.boxValue(), lig = this.ligandPayload();
    if (!this.recObj || !box || !lig) return;
    const opt = (id: string) => { const v = num(id); return Number.isFinite(v) ? v : undefined; };
    const body = {
      receptor_pdb: toPdb(this.receptorAtoms()), ligand: lig, center: box.center, size: box.size,
      exhaustiveness: opt("dk-exh") ?? 8, num_modes: opt("dk-modes") ?? 9, energy_range: opt("dk-erange") ?? 3,
      seed: opt("dk-seed"), cpu: opt("dk-cpu"), scoring: $<HTMLSelectElement>("dk-scoring").value,
    };
    this.clearResults();
    this.logLines = [];
    this.stage = "";
    this.progress = 0;
    this.job = { id: "", stop: () => undefined };
    this.renderRun();
    this.updateRun();
    try {
      const { id } = await api<{ id: string }>("/dock/jobs", { json: body });
      if (!this.job) { api(`/dock/jobs/${id}`, { method: "DELETE" }).catch(() => undefined); return; } // cancelled while submitting
      const finish = () => { this.job?.stop(); this.job = null; this.renderRun(); this.updateRun(); };
      const fail = (message: string) => { this.stage = `err:${message}`; finish(); toast(translateError(message), "err"); };
      this.job.id = id;
      this.job.stop = subscribe(`/dock/jobs/${id}/events`, {
        stage: (d) => { this.stage = d.stage; this.renderRun(); },
        progress: (d) => { this.progress = d.value; this.renderRun(); },
        log: (d) => { this.logLines.push(d.text); if (this.logLines.length > LOG_LINES) this.logLines.shift(); this.renderLog(); },
        done: (d) => { this.stage = "done"; finish(); this.onDone(d.poses, d.modes); },
        error: (d) => { if (d.cancelled) { this.stage = "cancelled"; finish(); } else fail(d.message); },
      }, () => fail(t("dock.lost")));
    } catch (e) {
      this.job = null;
      this.stage = `err:${e instanceof ApiError && e.status === 0 ? t("dock.status.offline") : (e as Error).message}`;
      if (e instanceof ApiError && e.status === 0) this.backend = "offline", this.renderStatus();
      this.renderRun();
      this.updateRun();
      toast(this.stage.slice(4), "err");
    }
  }

  private async cancel() {
    const job = this.job;
    if (!job) return;
    this.stage = "cancelled";
    job.stop();
    this.job = null;
    this.renderRun();
    this.updateRun();
    if (job.id) api(`/dock/jobs/${job.id}`, { method: "DELETE" }).catch(() => undefined);
  }

  private renderRun() {
    const stage = $("dk-stage"), bar = $("dk-progress");
    const running = !!this.job;
    stage.classList.toggle("hidden", !this.stage && !running);
    const err = this.stage.startsWith("err:");
    stage.classList.toggle("err", err);
    stage.textContent = err ? this.stage.slice(4) : this.stage ? t(`dock.stage.${this.stage}` as Key) : running ? t("dock.stage.submit") : "";
    bar.classList.toggle("hidden", !running);
    bar.querySelector<HTMLElement>("i")!.style.width = `${this.stage === "docking" ? this.progress : 0}%`;
    bar.classList.toggle("indeterminate", this.stage !== "docking");
    $("dk-log-toggle").classList.toggle("hidden", !this.logLines.length);
    this.renderLog();
  }
  private renderLog() {
    const log = $("dk-log");
    log.textContent = this.logLines.join("\n");
    log.scrollTop = log.scrollHeight;
    $("dk-log-toggle").classList.toggle("hidden", !this.logLines.length);
  }

  // ------------------------------------------------------------- results
  private clearResults() {
    for (const o of [...this.dock.objects]) if (o.name.startsWith("pose_")) this.dock.deleteObject(o.name);
    this.dock.deleteMeasurement("dock_contacts");
    this.results = null;
    $("dk-results-card").classList.add("hidden");
    this.renderLegend();
  }

  private onDone(text: string, modes: Mode[]) {
    const models = splitModels(text);
    const ref = this.src === "structure" && this.ligKey ? heavyByName(toPdb(this.ligandAtoms())) : null;
    const refRmsd = models.map((m) => (ref ? rmsdByName(heavyByName(m), ref) : null));
    this.results = { text, modes, models, refRmsd, shown: 0 };
    models.forEach((m, i) => {
      const name = `pose_${i + 1}`;
      this.dock.addObject(name, pdbqtToPdb(m), "pdb");
      this.deps.run(`hide everything, ${name}; show sticks, ${name} and not elem H; color ${POSE_COLORS[i % POSE_COLORS.length]}, ${name} and elem C; color atomic, ${name} and not elem C`);
    });
    this.showPose(0);
    this.deps.run(`zoom pose_1${this.dock.objects.some((o) => o.name === "ref_ligand") ? " or ref_ligand" : ""}`);
    $("dk-results-card").classList.remove("hidden");
    if (modes.length) toast(t("dock.done", { aff: modes[0].affinity.toFixed(1) }));
  }

  private showPose(i: number) {
    const r = this.results;
    if (!r) return;
    r.shown = i;
    r.models.forEach((_, j) => this.dock.setEnabled(`pose_${j + 1}`, j === i || this.showAll));
    this.renderResults();
    this.applyContacts();
    this.renderLegend();
  }

  private renderResults() {
    const r = this.results;
    if (!r) return;
    const hasRef = r.refRmsd.some((v) => v !== null);
    $("dk-results").innerHTML = `<table><thead><tr><th>#</th><th>${esc(t("dock.col.aff"))}</th><th>${esc(t("dock.col.lb"))}</th><th>${esc(t("dock.col.ub"))}</th>${hasRef ? `<th title="${esc(t("dock.col.refTitle"))}">${esc(t("dock.col.ref"))}</th>` : ""}</tr></thead><tbody>${
      r.modes.map((m, i) => `<tr data-i="${i}" class="${i === r.shown ? "active" : ""}"><td><span class="swatch" style="background:${css(POSE_COLORS[i % POSE_COLORS.length])}"></span>${m.mode}</td><td>${m.affinity.toFixed(1)}</td><td>${m.rmsd_lb.toFixed(2)}</td><td>${m.rmsd_ub.toFixed(2)}</td>${
        hasRef ? `<td>${r.refRmsd[i] === null ? "–" : r.refRmsd[i]!.toFixed(2)}</td>` : ""}</tr>`).join("")}</tbody></table>`;
    const contacts = this.dock.measurements.some((m) => m.name === "dock_contacts");
    $("dk-contacts").classList.toggle("active", contacts);
    $("dk-contacts").querySelector("span")!.textContent = t(contacts ? "contactsOff" : "contacts");
  }

  private async applyContacts() {
    const r = this.results;
    this.dock.deleteMeasurement("dock_contacts");
    if (r && this.contactsOn) await this.deps.run(`polar_contacts pose_${r.shown + 1}, receptor and polymer, dock_contacts`);
    this.renderResults();
  }

  private zoomFocus() {
    const r = this.results;
    if (r) this.deps.run(`zoom pose_${r.shown + 1}`);
    else if (this.dock.objects.some((o) => o.name === "ref_ligand")) this.deps.run("zoom ref_ligand");
    else this.dock.reset();
  }

  private sendToViewer() {
    const r = this.results;
    if (!r || !this.recObj) return;
    const base = this.recObj.name;
    this.deps.toViewer(this.viewer.addObject(`${base}_dock`, toPdb(this.receptorAtoms()), "pdb"));
    const picks = this.showAll ? r.models.map((_, i) => i) : [r.shown];
    for (const i of picks) {
      const obj = this.viewer.addObject(`${base}_pose${i + 1}`, pdbqtToPdb(r.models[i]), "pdb");
      this.deps.toViewer(obj);
    }
    toast(t("dock.sent"));
    this.deps.openViewer();
  }

  // ------------------------------------------------------------- language-dependent bits
  private renderLegend() {
    const items: [string, string][] = [];
    if (this.dock.objects.some((o) => o.name === "receptor")) items.push([RECEPTOR_COLOR, t("dock.leg.receptor")]);
    if (this.dock.objects.some((o) => o.name === "ref_ligand")) items.push([REF_COLOR, t("dock.leg.ref")]);
    const r = this.results;
    if (r) r.models.forEach((_, i) => { if (i === r.shown || this.showAll) items.push([POSE_COLORS[i % POSE_COLORS.length], t("dock.leg.pose", { n: i + 1 })]); });
    $("dock-legend").innerHTML = items.map(([c, l]) => `<span><i style="background:${c === REF_COLOR ? "#999999" : css(c)}"></i>${esc(l)}</span>`).join("");
  }

  private renderAll() {
    this.renderStatus();
    this.renderLigand();
    this.renderRun();
    this.renderResults();
    this.renderLegend();
    this.syncReceptorList();
    this.updateRun();
  }
}
