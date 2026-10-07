import { GRADIENTS, SS_COLORS, toHex } from "../colors";
import { t, type Key } from "../i18n";
import type { EntryInfo } from "../rcsb";
import { evaluate } from "../selection";
import { ALL_REPS, REP, type Measurement, type PObject, type RepName, type Settings } from "../types";
import type { Scene } from "../viewer";
import { esc, icon, refreshIcons } from "./icons";

type Run = (cmd: string) => Promise<boolean>;

const REPS: { rep: RepName; icon: string; applies: string }[] = [
  { rep: "cartoon", icon: "spline", applies: "guide" },
  { rep: "ribbon", icon: "waves", applies: "guide" },
  { rep: "surface", icon: "cloud", applies: "not solvent" },
  { rep: "mesh", icon: "grid-3x3", applies: "not solvent" },
  { rep: "sticks", icon: "network", applies: "not solvent" },
  { rep: "lines", icon: "activity", applies: "not solvent" },
  { rep: "spheres", icon: "circle", applies: "not solvent" },
  { rep: "ballstick", icon: "atom", applies: "not solvent" },
  { rep: "nonbonded", icon: "asterisk", applies: "all" },
];

const grad = (stops: number[]) => `linear-gradient(135deg, ${stops.map(toHex).join(", ")})`;
const SCHEMES: { label: Key; cmd: string; hetero: boolean; css: string }[] = [
  { label: "scheme.chain", cmd: "util.cbc {t}", hetero: true, css: grad([0x3b82f6, 0x22d3ee, 0x8b5cf6]) },
  { label: "scheme.rainbow", cmd: "util.chainbow {t}", hetero: true, css: grad(GRADIENTS.rainbow) },
  { label: "scheme.ss", cmd: "color_by_ss {t}", hetero: true, css: grad([SS_COLORS.h, SS_COLORS.h, SS_COLORS.s, SS_COLORS.c]) },
  { label: "scheme.element", cmd: "util.cbaw {t}", hetero: false, css: grad([0xe6e6e6, 0x3a5bff, 0xff4d4d, 0xe6c640]) },
  { label: "scheme.b", cmd: "spectrum b, blue_white_red, {t}", hetero: false, css: grad(GRADIENTS.blue_white_red) },
  { label: "scheme.hydro", cmd: "color_by_hydrophobicity {t}", hetero: true, css: grad(GRADIENTS.hydro) },
  { label: "scheme.restype", cmd: "color_by_restype {t}", hetero: true, css: grad([0x3b82f6, 0xf43f5e, 0x34d399, 0xe2e8f0]) },
  { label: "scheme.ocean", cmd: "spectrum count, ocean, {t}", hetero: true, css: grad(GRADIENTS.ocean) },
];

export class Panels {
  private targetSel = document.getElementById("target") as HTMLSelectElement;
  private repMode: "toggle" | "as" = "toggle";
  private surfaceOn = false;
  private currentObj: PObject | null = null;
  readonly info = new Map<string, EntryInfo | "loading" | "error">();

  constructor(private scene: Scene, private run: Run) {
    this.buildSidebar();
    scene.addEventListener("objects", () => {
      if (!this.currentObj || !scene.objects.includes(this.currentObj)) this.currentObj = scene.objects.at(-1) ?? null;
      this.refreshTargets(); this.renderObjects(); this.renderInfo(); this.syncReps(); this.renderSelections(); this.syncLigandRegion();
    });
    scene.addEventListener("selections", () => { this.refreshTargets(); this.renderSelections(); this.syncReps(); this.syncToggles(); });
    scene.addEventListener("measurements", () => { this.renderMeasurements(); this.syncToggles(); });
    scene.addEventListener("settings", () => this.syncSettings());
    let pending = 0;
    scene.addEventListener("style", () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => { this.syncReps(); this.syncToggles(); this.renderSelections(); });
    });
    this.targetSel.addEventListener("change", () => this.syncReps());
    window.addEventListener("langchange", () => this.renderAll());
    this.renderAll();
  }

  /** Render everything that contains translated text. */
  private renderAll() {
    this.renderReps(); this.renderSchemes(); this.refreshTargets();
    this.renderObjects(); this.renderSelections(); this.renderMeasurements(); this.renderInfo();
    this.syncReps(); this.syncToggles(); this.syncLigandRegion();
  }

  get target() { return this.targetSel.value || "all"; }
  setTarget(expr: string) {
    this.refreshTargets(expr);
    this.targetSel.value = expr;
    this.syncReps();
  }
  setCurrent(obj: PObject) { this.currentObj = obj; this.renderInfo(); this.renderObjects(); }

  /** Substitute {t} with the target expression (parenthesized when needed). */
  fill(cmd: string) {
    const t = this.target;
    return cmd.replace(/\{t\}/g, /\s/.test(t) ? `(${t})` : t);
  }

  // ------------------------------------------------------------- controls
  private buildSidebar() {
    document.querySelectorAll<HTMLElement>("[data-collapsible] h3").forEach((h) =>
      h.addEventListener("click", () => h.parentElement!.classList.toggle("collapsed")));

    document.getElementById("rep-grid")!.addEventListener("click", async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>(".rep");
      if (!b) return;
      const rep = b.dataset.rep as RepName;
      const t = this.fill("{t}");
      if (this.repMode === "as") await this.run(`as ${rep}, ${t}`);
      else await this.run(`${b.classList.contains("on") ? "hide" : "show"} ${rep}, ${t}`);
    });
    this.segmented("rep-mode", "mode", (v) => { this.repMode = v as "toggle" | "as"; });

    document.getElementById("scheme-list")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>(".scheme");
      if (!b) return;
      const s = SCHEMES[+b.dataset.i!];
      this.colorCmd(s.cmd, s.hetero);
    });

    // surface type buttons double as an on/off control: pick a type to show the surface
    // on the target, click the highlighted type again to hide it
    document.getElementById("surface-type")!.addEventListener("click", (e) => {
      const v = (e.target as HTMLElement).closest<HTMLElement>("button")?.dataset.v;
      if (!v) return;
      if (this.surfaceOn && v === this.scene.settings.surface_type) this.run(this.fill("hide surface, {t}"));
      else this.run(this.fill(`set surface_type, ${v}; show surface, {t}`));
    });
    // limit the surface to residues near the ligand centers (0 = whole surface)
    const cutoff = document.getElementById("ligand-cutoff") as HTMLInputElement;
    cutoff.addEventListener("input", () => { this.syncLigandRegion(+cutoff.value); this.scene.set("surface_ligand_cutoff", +cutoff.value); });
    cutoff.addEventListener("change", () => this.run(this.fill(`set surface_ligand_cutoff, ${cutoff.value}${
      +cutoff.value && !this.surfaceOn ? "; show surface, {t}" : ""}`)));

    this.segmented("pick-mode", "v", (v) => this.run(`set mouse_selection_mode, ${v}`));

    document.querySelectorAll<HTMLInputElement>("input[data-setting]").forEach((inp) => {
      const key = inp.dataset.setting as keyof Settings;
      const out = inp.parentElement!.querySelector("output");
      const show = () => { if (out) out.textContent = (+inp.value).toFixed(2); };
      show();
      inp.addEventListener("input", () => { show(); this.scene.set(key, +inp.value as never); });
      inp.addEventListener("change", () => this.run(`set ${key}, ${inp.value}`));
    });
    document.querySelectorAll<HTMLInputElement>("input[data-toggle]").forEach((inp) =>
      inp.addEventListener("change", () => this.run(`set ${inp.dataset.toggle}, ${inp.checked ? 1 : 0}`)));
    document.getElementById("cartoon-style")!.addEventListener("change", (e) => this.run(`cartoon ${(e.target as HTMLSelectElement).value}`));

    // on/off controls: each click runs the command that undoes the current state
    document.getElementById("contacts-btn")!.addEventListener("click", () =>
      this.run(this.scene.measurements.some((m) => m.kind === "contacts") ? "polar_contacts off" : "polar_contacts"));
    document.getElementById("pocket-btn")!.addEventListener("click", () => this.run(this.scene.selections.has("pocket")
      ? "hide sticks, pocket and polymer; delete pocket; zoom not solvent"
      : "select pocket, byres polymer within 5 of organic; show sticks, pocket and not name N+C+O; deselect; zoom pocket"));
    document.getElementById("water-toggle")!.addEventListener("change", (e) =>
      this.run((e.target as HTMLInputElement).checked ? "show ballstick, solvent" : "hide everything, solvent"));

    document.body.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-cmd]");
      if (b && !b.closest(".rep-grid")) this.run(this.fill(b.dataset.cmd!));
    });
  }

  private renderReps() {
    document.getElementById("rep-grid")!.innerHTML = REPS.map((r) =>
      `<button class="rep" data-rep="${r.rep}">${icon(r.icon)}${esc(t(`rep.${r.rep}` as Key))}</button>`).join("");
    refreshIcons(document.getElementById("rep-grid")!);
  }

  private renderSchemes() {
    document.getElementById("scheme-list")!.innerHTML = SCHEMES.map((s, i) =>
      `<button class="scheme" data-i="${i}"><span class="grad" style="background:${s.css}"></span>${esc(t(s.label))}</button>`).join("");
  }

  private colorCmd(cmd: string, hetero: boolean) {
    const keep = (document.getElementById("keep-hetero") as HTMLInputElement).checked;
    let line = this.fill(cmd);
    if (hetero && keep) line += `; color atomic, (${this.target}) and not elem C`;
    this.run(line);
  }

  private segmented(id: string, attr: string, fn: (v: string) => void) {
    const el = document.getElementById(id)!;
    el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("button");
      if (!b || b.dataset[attr] === undefined) return;
      el.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      fn(b.dataset[attr]!);
    });
  }

  private setSegment(id: string, attr: string, value: string) {
    document.getElementById(id)!.querySelectorAll<HTMLElement>("button").forEach((b) => b.classList.toggle("active", b.dataset[attr] === value));
  }

  /** Reflect settings changed by presets in the controls. */
  private syncSettings() {
    const s = this.scene.settings;
    document.querySelectorAll<HTMLInputElement>("input[data-setting]").forEach((inp) => {
      const v = s[inp.dataset.setting as keyof Settings] as number;
      if (document.activeElement !== inp && +inp.value !== v) {
        inp.value = String(v);
        const out = inp.parentElement!.querySelector("output");
        if (out) out.textContent = v.toFixed(2);
      }
    });
    document.querySelectorAll<HTMLInputElement>("input[data-toggle]").forEach((inp) => { inp.checked = !!s[inp.dataset.toggle as keyof Settings]; });
    (document.getElementById("cartoon-style") as HTMLSelectElement).value = s.cartoon_style;
    this.syncSurfaceType();
    this.setSegment("pick-mode", "v", s.mouse_selection_mode);
    this.syncLigandRegion();
  }

  /** Slider value and label for the ligand-region cutoff; disabled without ligands. */
  private syncLigandRegion(value = this.scene.settings.surface_ligand_cutoff) {
    const inp = document.getElementById("ligand-cutoff") as HTMLInputElement;
    const hasLigand = this.scene.atoms.some((a) => a.cls === "organic");
    if (document.activeElement !== inp) inp.value = String(value);
    document.getElementById("ligand-region")!.classList.toggle("disabled", !hasLigand);
    document.getElementById("ligand-cutoff-out")!.textContent =
      !hasLigand ? t("ligandRegion.none") : value ? `${value} Å` : t("ligandRegion.all");
  }

  /** Reflect scene state in the on/off controls. */
  private syncToggles() {
    const s = this.scene;
    const btn = (id: string, on: boolean, onText: Key, offText: Key) => {
      const b = document.getElementById(id)!;
      b.classList.toggle("active", on);
      b.querySelector("span")!.textContent = t(on ? onText : offText);
    };
    btn("contacts-btn", s.measurements.some((m) => m.kind === "contacts"), "contactsOff", "contacts");
    btn("pocket-btn", s.selections.has("pocket"), "pocketOff", "pocket");
    const water = s.atoms.filter((a) => a.cls === "solvent");
    (document.getElementById("water-toggle") as HTMLInputElement).checked = water.some((a) => a.reps & ALL_REPS);
    document.getElementById("water-switch")!.classList.toggle("disabled", !water.length);
    document.querySelectorAll<HTMLElement>("#info [data-lig]").forEach((b) =>
      b.classList.toggle("active", s.selections.has(ligSel(b.dataset.lig!))));
  }

  /** Highlight representation buttons that are on for the current target. */
  syncReps() {
    let base: Uint8Array;
    try { base = evaluate(this.target, this.scene); } catch { base = new Uint8Array(this.scene.atoms.length); }
    for (const r of REPS) {
      const btn = document.querySelector<HTMLElement>(`.rep[data-rep="${r.rep}"]`)!;
      let m = base;
      if (r.applies !== "all") {
        const ap = evaluate(r.applies, this.scene);
        m = base.map((v, i) => v & ap[i]);
      }
      if (r.rep === "nonbonded") { const atoms = this.scene.atoms; m = m.map((v, i) => (v && !atoms[i].bonds.length ? 1 : 0)); }
      const c = this.scene.repCoverage(REP[r.rep], m);
      btn.classList.toggle("on", c > 0.999);
      btn.classList.toggle("partial", c > 0 && c <= 0.999);
      if (r.rep === "surface") this.surfaceOn = c > 0;
    }
    this.syncSurfaceType();
  }

  /** Highlight the surface type only while the target actually shows a surface. */
  private syncSurfaceType() {
    this.setSegment("surface-type", "v", this.surfaceOn ? this.scene.settings.surface_type : "");
  }

  private refreshTargets(extra?: string) {
    const s = this.scene;
    const prev = extra ?? this.targetSel.value ?? "all";
    const opts: [string, string][] = [["all", t("tg.all")]];
    if (s.selections.has("sele")) opts.push(["sele", t("tg.sele", { n: s.selections.get("sele")!.size })]);
    const has = (cls: string) => s.atoms.some((a) => a.cls === cls);
    if (has("protein") || has("nucleic")) opts.push(["polymer", t("tg.polymer")]);
    if (has("organic")) opts.push(["organic", t("tg.organic")]);
    if (has("inorganic")) opts.push(["inorganic", t("tg.inorganic")]);
    if (has("solvent")) opts.push(["solvent", t("tg.solvent")]);
    const multi = s.objects.length > 1;
    for (const o of s.objects) {
      if (multi) opts.push([o.name, t("tg.object", { name: o.name })]);
      for (const c of [...new Set(o.atoms.filter((a) => a.cls === "protein" || a.cls === "nucleic").map((a) => a.chain))]) {
        opts.push([multi ? `model ${o.name} and chain ${c}` : `chain ${c}`, `${multi ? o.name + " · " : ""}${t("tg.chain", { c })}`]);
      }
    }
    for (const k of s.selections.keys()) if (k !== "sele" && !k.startsWith("_") && !/^pk\d$/.test(k)) opts.push([k, t("tg.selection", { name: k })]);
    if (extra && !opts.some(([v]) => v === extra)) opts.push([extra, extra]);
    this.targetSel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
    this.targetSel.value = opts.some(([v]) => v === prev) ? prev : "all";
  }

  // ------------------------------------------------------------- structure info & lists
  renderInfo() {
    const el = document.getElementById("info")!;
    const o = this.currentObj;
    if (!o) {
      el.innerHTML = `<h3>${icon("info")}${esc(t("structure"))}</h3><div class="placeholder">${esc(t("info.none"))}</div>`;
      refreshIcons(el);
      return;
    }
    const residues = new Set(o.atoms.filter((a) => a.cls === "protein" || a.cls === "nucleic").map((a) => a.rid)).size;
    const chains = [...new Set(o.atoms.filter((a) => a.cls === "protein" || a.cls === "nucleic").map((a) => a.chain))];
    const ligs = new Map<string, number>();
    const ligRids = new Set<number>();
    for (const a of o.atoms) if (a.cls === "organic" && !ligRids.has(a.rid)) { ligRids.add(a.rid); ligs.set(a.resn, (ligs.get(a.resn) ?? 0) + 1); }
    const waters = new Set(o.atoms.filter((a) => a.cls === "solvent").map((a) => a.rid)).size;
    const info = o.pdbId ? this.info.get(o.pdbId) : undefined;
    const ent = typeof info === "object" ? info : undefined;
    const title = ent?.title ?? t(info === "loading" ? "info.loading" : o.pdbId ? "info.unavailable" : "info.local");
    const meta = (label: Key, value: string, wide = false) =>
      `<div${wide ? ` class="wide"` : ""}><span>${esc(t(label))}</span><b title="${esc(value)}">${esc(value)}</b></div>`;
    el.innerHTML = `
      <div class="info-head">
        <span class="pdb-chip">${esc(o.pdbId ?? o.name.slice(0, 6).toUpperCase())}</span>
        <div><div class="info-sub">${esc(ent?.method ? cap(ent.method) : t(o.pdbId ? "info.entry" : "info.uploaded"))}</div>
        <b>${esc(o.name)}</b></div>
        ${o.pdbId ? `<a href="https://www.rcsb.org/structure/${o.pdbId}" target="_blank" rel="noopener" title="${esc(t("info.open"))}">${icon("external-link")}</a>` : ""}
      </div>
      <div class="info-title">${esc(title)}</div>
      <div class="meta">
        ${ent?.resolution ? meta("info.resolution", `${ent.resolution.toFixed(2)} Å`) : ""}
        ${ent?.released ? meta("info.released", ent.released) : ""}
        ${ent?.organism ? meta("info.organism", ent.organism, true) : ""}
        ${ent?.description ? meta("info.entity", ent.description, true) : ""}
        ${meta("info.atoms", o.atoms.length.toLocaleString())}
        ${meta("info.residues", residues.toLocaleString())}
        ${meta("info.chains", chains.join(", ") || "–")}
        ${meta("info.waters", String(waters))}
      </div>
      ${ligs.size ? `<div class="field-label sm">${esc(t("info.ligands"))}</div><div class="lig-chips">${[...ligs].map(([r, n]) =>
        `<button data-lig="${esc(r)}" title="${esc(t("info.ligTitle"))}">${esc(r)}${n > 1 ? ` ×${n}` : ""}</button>`).join("")}</div>` : ""}`;
    el.querySelectorAll<HTMLElement>("[data-lig]").forEach((b) => b.addEventListener("click", () => {
      const r = b.dataset.lig!;
      const name = ligSel(r);
      if (this.scene.selections.has(name)) this.run(`delete ${name}; zoom not solvent`);
      else this.run(`select ${name}, model ${o.name} and resn ${r}; show sticks, ${name}; zoom ${name}`).then(() => this.setTarget(name));
    }));
    refreshIcons(el);
    this.syncToggles();
  }

  private renderObjects() {
    const el = document.getElementById("objects")!;
    const s = this.scene;
    if (!s.objects.length) { el.innerHTML = `<div class="placeholder">${esc(t("list.noObjects"))}</div>`; return; }
    el.innerHTML = s.objects.map((o) => `
      <div class="item${o.enabled ? "" : " off"}${o === this.currentObj ? " active" : ""}" data-name="${esc(o.name)}">
        <span class="dot" style="background:${toHex(s.chainColor(o, o.atoms[0].chain))}"></span>
        <span class="name">${esc(o.name)}</span><span class="sub">${esc(t("list.atoms", { n: o.atoms.length.toLocaleString() }))}</span>
        <span class="acts">
          <button data-a="toggle" title="${esc(t(o.enabled ? "act.hide" : "act.show"))}">${icon(o.enabled ? "eye" : "eye-off")}</button>
          <button data-a="zoom" title="${esc(t("act.zoom"))}">${icon("scan")}</button>
          <button data-a="delete" class="danger" title="${esc(t("act.delete"))}">${icon("trash-2")}</button>
        </span>
      </div>`).join("");
    this.bindList(el, (name, a) => {
      const o = s.objects.find((x) => x.name === name)!;
      if (a === "toggle") this.run(`${o.enabled ? "disable" : "enable"} ${name}`);
      else if (a === "zoom") this.run(`zoom ${name}`);
      else if (a === "delete") this.run(`delete ${name}`);
      else this.setCurrent(o);
    });
    refreshIcons(el);
  }

  private renderSelections() {
    const el = document.getElementById("selections")!;
    const s = this.scene;
    const names = [...s.selections.keys()].filter((k) => !k.startsWith("_") && !/^pk\d$/.test(k));
    if (!names.length) {
      el.innerHTML = `<div class="placeholder">${esc(t("list.noSelections"))}</div>`;
      return;
    }
    const sticksOn = (n: string) => {
      const atoms = [...s.selections.get(n)!].filter((a) => a.cls !== "solvent");
      return atoms.length > 0 && atoms.every((a) => a.reps & REP.sticks);
    };
    el.innerHTML = names.map((n) => `
      <div class="item${s.indicated === n ? " active" : ""}" data-name="${esc(n)}">
        <span class="dot" style="background:#ff4fd8"></span>
        <span class="name">${esc(n)}</span><span class="sub">${esc(t("list.atoms", { n: s.selections.get(n)!.size }))}</span>
        <span class="acts">
          <button data-a="toggle" title="${esc(t("act.indicate"))}">${icon(s.indicated === n ? "eye" : "eye-off")}</button>
          <button data-a="zoom" title="${esc(t("act.zoom"))}">${icon("scan")}</button>
          <button data-a="sticks" class="${sticksOn(n) ? "on" : ""}" title="${esc(t(sticksOn(n) ? "act.hideSticks" : "act.showSticks"))}">${icon("network")}</button>
          <button data-a="delete" class="danger" title="${esc(t("act.delete"))}">${icon("trash-2")}</button>
        </span>
      </div>`).join("");
    this.bindList(el, (name, a) => {
      if (a === "toggle") this.run(`${s.indicated === name ? "disable" : "enable"} ${name}`);
      else if (a === "zoom") this.run(`zoom ${name}`);
      else if (a === "sticks") this.run(`${sticksOn(name) ? "hide" : "show"} sticks, ${name}`);
      else if (a === "delete") this.run(`delete ${name}`);
      else this.setTarget(name);
    });
    refreshIcons(el);
  }

  private renderMeasurements() {
    const el = document.getElementById("measurements")!;
    const ms = this.scene.measurements;
    if (!ms.length) { el.innerHTML = `<div class="placeholder">${esc(t("list.noMeasurements"))}</div>`; return; }
    const ic = { distance: "ruler", angle: "triangle", dihedral: "axis-3d", contacts: "network" };
    el.innerHTML = ms.map((m) => `
      <div class="item${m.visible ? "" : " off"}" data-name="${esc(m.name)}">
        <span style="color:${m.kind === "contacts" ? "#38bdf8" : "#f59e0b"};display:grid">${icon(ic[m.kind])}</span>
        <span class="name">${esc(m.name)}</span><span class="sub">${esc(summary(m))}</span>
        <span class="acts">
          <button data-a="toggle" title="${esc(t(m.visible ? "act.hide" : "act.show"))}">${icon(m.visible ? "eye" : "eye-off")}</button>
          <button data-a="delete" class="danger" title="${esc(t("act.delete"))}">${icon("trash-2")}</button>
        </span>
      </div>`).join("");
    this.bindList(el, (name, a) => {
      const m = ms.find((x) => x.name === name)!;
      if (a === "toggle") this.run(`${m.visible ? "disable" : "enable"} ${name}`);
      else if (a === "delete") this.run(`delete ${name}`);
    });
    refreshIcons(el);
  }

  private bindList(el: HTMLElement, fn: (name: string, action: string | undefined) => void) {
    el.onclick = (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>(".item");
      if (!item) return;
      const btn = (e.target as HTMLElement).closest<HTMLElement>("button[data-a]");
      fn(item.dataset.name!, btn?.dataset.a);
    };
  }
}

/** Measurement summary; counts are translated, single values (Å, °) are not. */
function summary(m: Measurement) {
  const n = m.groups.length;
  if (!n) return t("list.noPairs");
  if (n > 1) return t(m.kind === "contacts" ? "list.contacts" : "list.pairs", { n });
  return m.summary;
}

const ligSel = (resn: string) => `lig_${resn.replace(/\W/g, "")}`;
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
