import { useEffect, useState } from "react";
import {
  Activity, Asterisk, Atom, Axis3d, Boxes, Circle, Cloud, Contrast, ExternalLink, Eye, EyeOff, Focus,
  Grid3x3, Image as ImageIcon, Info, Layers, Microscope, MousePointerClick, Network, Palette, RotateCcw, Ruler, Scan,
  SlidersHorizontal, Spline, Target, Trash2, Triangle, WandSparkles, Waves, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Segmented, SliderRow, SwitchRow, FieldLabel, Placeholder } from "@/components/controls";
import { SidebarCard } from "@/components/sidebar-card";
import { GRADIENTS, SS_COLORS, toHex } from "@/colors";
import { fill, run, scene, viewerUi } from "@/core";
import { useScene } from "@/hooks/use-scene";
import { useT, type Key } from "@/i18n";
import { cn } from "@/lib/utils";
import { setMeasureMode } from "@/measure";
import { evaluate } from "@/selection";
import { ALL_REPS, REP, type Measurement, type RepName, type Settings } from "@/types";

const REPS: { rep: RepName; icon: LucideIcon; applies: string }[] = [
  { rep: "cartoon", icon: Spline, applies: "guide" },
  { rep: "ribbon", icon: Waves, applies: "guide" },
  { rep: "surface", icon: Cloud, applies: "not solvent" },
  { rep: "mesh", icon: Grid3x3, applies: "not solvent" },
  { rep: "sticks", icon: Network, applies: "not solvent" },
  { rep: "lines", icon: Activity, applies: "not solvent" },
  { rep: "spheres", icon: Circle, applies: "not solvent" },
  { rep: "ballstick", icon: Atom, applies: "not solvent" },
  { rep: "nonbonded", icon: Asterisk, applies: "all" },
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

const EVENTS = ["objects", "selections", "measurements", "settings", "style"];
const visibleSelections = () => [...scene.selections.keys()].filter((k) => !k.startsWith("_") && !/^pk\d$/.test(k));
const ligSel = (resn: string) => `lig_${resn.replace(/\W/g, "")}`;
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function ViewerSidebar() {
  return (
    <aside className="flex min-h-0 flex-col gap-2.5 overflow-y-auto pb-1">
      <TargetCard />
      <RepresentationCard />
      <ColorCard />
      <SurfaceCard />
      <StyleCard />
      <SceneCard />
      <PresetsCard />
      <AnalysisCard />
      <InfoCard />
      <ObjectsCard />
      <SelectionsCard />
      <MeasurementsCard />
    </aside>
  );
}

// ---------------------------------------------------------------- target
function targetOptions(t: ReturnType<typeof useT>): [string, string][] {
  const opts: [string, string][] = [["all", t("tg.all")]];
  if (scene.selections.has("sele")) opts.push(["sele", t("tg.sele", { n: scene.selections.get("sele")!.size })]);
  const has = (cls: string) => scene.atoms.some((a) => a.cls === cls);
  if (has("protein") || has("nucleic")) opts.push(["polymer", t("tg.polymer")]);
  if (has("organic")) opts.push(["organic", t("tg.organic")]);
  if (has("inorganic")) opts.push(["inorganic", t("tg.inorganic")]);
  if (has("solvent")) opts.push(["solvent", t("tg.solvent")]);
  const multi = scene.objects.length > 1;
  for (const o of scene.objects) {
    if (multi) opts.push([o.name, t("tg.object", { name: o.name })]);
    for (const c of [...new Set(o.atoms.filter((a) => a.cls === "protein" || a.cls === "nucleic").map((a) => a.chain))]) {
      opts.push([multi ? `model ${o.name} and chain ${c}` : `chain ${c}`, `${multi ? o.name + " · " : ""}${t("tg.chain", { c })}`]);
    }
  }
  for (const k of visibleSelections()) if (k !== "sele") opts.push([k, t("tg.selection", { name: k })]);
  return opts;
}

function TargetCard() {
  const t = useT();
  useScene(scene, ["objects", "selections"]);
  const { target } = viewerUi.use();
  const opts = targetOptions(t);
  const valid = opts.some(([v]) => v === target);
  useEffect(() => { if (!valid) viewerUi.set({ target: "all" }); }, [valid]);
  return (
    <Card size="sm" className="sticky top-0 z-10 shrink-0 gap-1.5 rounded-(--radius) border bg-card px-3 py-2.5 shadow-card ring-0">
      <FieldLabel icon={Target}>{t("target")}</FieldLabel>
      <Select value={valid ? target : "all"} onValueChange={(v) => viewerUi.set({ target: v })}>
        <SelectTrigger className="w-full bg-secondary font-medium"><SelectValue /></SelectTrigger>
        <SelectContent position="popper">{opts.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </Card>
  );
}

// ---------------------------------------------------------------- representation
/** Per-representation coverage of the current target, plus whether any surface is shown. */
function repCoverage(target: string) {
  let base: Uint8Array;
  try { base = evaluate(target, scene); } catch { base = new Uint8Array(scene.atoms.length); }
  const out = {} as Record<RepName, number>;
  for (const r of REPS) {
    let m = base;
    if (r.applies !== "all") { const ap = evaluate(r.applies, scene); m = base.map((v, i) => v & ap[i]); }
    if (r.rep === "nonbonded") m = m.map((v, i) => (v && !scene.atoms[i].bonds.length ? 1 : 0));
    out[r.rep] = scene.repCoverage(REP[r.rep], m);
  }
  return out;
}

function RepresentationCard() {
  const t = useT();
  useScene(scene, EVENTS);
  const { target } = viewerUi.use();
  const [mode, setMode] = useState<"toggle" | "as">("toggle");
  const cov = repCoverage(target);
  return (
    <SidebarCard icon={Layers} title={t("card.rep")}>
      <Segmented value={mode} onChange={(v) => setMode(v as "toggle" | "as")}
        items={[{ value: "toggle", label: t("rep.toggle") }, { value: "as", label: t("rep.as") }]} />
      <div className="grid grid-cols-3 gap-1.5">
        {REPS.map(({ rep, icon: Icon }) => {
          const on = cov[rep] > 0.999, partial = cov[rep] > 0 && !on;
          return (
            <button key={rep} onClick={() => run(mode === "as" ? `as ${rep}, ${fill("{t}")}` : `${on ? "hide" : "show"} ${rep}, ${fill("{t}")}`)}
              className={cn(
                "relative flex h-[62px] flex-col items-center justify-center gap-1 rounded-[11px] border bg-secondary text-[11.5px] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary",
                partial && "border-primary text-primary",
                on && "border-primary bg-primary text-primary-foreground shadow-md hover:text-primary-foreground",
              )}>
              <Icon className="size-[19px]" />
              {t(`rep.${rep}` as Key)}
              {partial && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" />}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="outline" size="lg" className="bg-secondary" onClick={() => run(fill("hide everything, {t}"))}><EyeOff />{t("hideAll")}</Button>
        <Button variant="outline" size="lg" className="bg-secondary" onClick={() => run(fill("preset.simple {t}"))}><RotateCcw />{t("default")}</Button>
      </div>
    </SidebarCard>
  );
}

// ---------------------------------------------------------------- color
function ColorCard() {
  const t = useT();
  const [keep, setKeep] = useState(true);
  const apply = (cmd: string, hetero: boolean) => {
    let line = fill(cmd);
    if (hetero && keep) line += `; color atomic, (${viewerUi.get().target}) and not elem C`;
    run(line);
  };
  return (
    <SidebarCard icon={Palette} title={t("card.color")}>
      <div className="grid grid-cols-2 gap-1.5">
        {SCHEMES.map((s) => (
          <button key={s.label} onClick={() => apply(s.cmd, s.hetero)}
            className="flex h-[34px] items-center gap-2 rounded-[9px] border bg-secondary px-2 text-left text-xs font-semibold hover:border-primary hover:text-primary">
            <span className="size-[18px] flex-none rounded-md shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]" style={{ background: s.css }} />
            {t(s.label)}
          </button>
        ))}
      </div>
      <Label className="gap-2 text-xs font-normal text-muted-foreground">
        <Checkbox checked={keep} onCheckedChange={(v) => setKeep(v === true)} />
        {t("keepHetero")}
      </Label>
    </SidebarCard>
  );
}

// ---------------------------------------------------------------- settings sliders
/** Slider bound to a numeric scene setting: live while dragging, committed as a `set` command on release. */
function SettingSlider({ name, label, min, max, step }: { name: keyof Settings; label: string; min: number; max: number; step: number }) {
  useScene(scene, ["settings"]);
  const [drag, setDrag] = useState<number | null>(null);
  const value = drag ?? (scene.settings[name] as number);
  return (
    <SliderRow label={label} value={value} min={min} max={max} step={step} output={value.toFixed(2)}
      onChange={(v) => { setDrag(v); scene.set(name, v as never); }}
      onCommit={(v) => { setDrag(null); run(`set ${name}, ${v}`); }} />
  );
}

function SurfaceCard() {
  const t = useT();
  useScene(scene, EVENTS);
  const { target } = viewerUi.use();
  const [drag, setDrag] = useState<number | null>(null);
  const surfaceOn = repCoverage(target).surface > 0;
  const hasLigand = scene.atoms.some((a) => a.cls === "organic");
  const cutoff = drag ?? scene.settings.surface_ligand_cutoff;
  return (
    <SidebarCard icon={Cloud} title={t("card.surface")}>
      {/* the surface type buttons double as on/off: pick a type to show it, click the highlighted one to hide */}
      <Segmented value={surfaceOn ? scene.settings.surface_type : ""}
        onChange={(v) => run(surfaceOn && v === scene.settings.surface_type ? fill("hide surface, {t}") : fill(`set surface_type, ${v}; show surface, {t}`))}
        items={[{ value: "VDW", label: t("surf.vdw") }, { value: "SAS", label: t("surf.sas") }, { value: "SES", label: t("surf.ses") }]} />
      <SettingSlider name="transparency" label={t("transparency")} min={0} max={0.9} step={0.05} />
      <SliderRow label={t("ligandRegion")} title={t("ligandRegion.title")} value={cutoff} min={0} max={30} step={1} disabled={!hasLigand}
        output={!hasLigand ? t("ligandRegion.none") : cutoff ? `${cutoff} Å` : t("ligandRegion.all")}
        onChange={(v) => { setDrag(v); scene.set("surface_ligand_cutoff", v); }}
        onCommit={(v) => { setDrag(null); run(fill(`set surface_ligand_cutoff, ${v}${v && !surfaceOn ? "; show surface, {t}" : ""}`)); }} />
    </SidebarCard>
  );
}

function StyleCard() {
  const t = useT();
  useScene(scene, ["settings"]);
  const styles = ["automatic", "oval", "rectangle", "tube", "trace", "parabola", "edged"] as const;
  return (
    <SidebarCard icon={SlidersHorizontal} title={t("card.style")}>
      <Label className="grid grid-cols-[90px_1fr] items-center gap-2 text-[12.5px] font-normal text-muted-foreground">
        {t("cartoon")}
        <Select value={scene.settings.cartoon_style} onValueChange={(v) => run(`cartoon ${v}`)}>
          <SelectTrigger className="w-full bg-secondary font-medium"><SelectValue /></SelectTrigger>
          <SelectContent position="popper">{styles.map((s) => <SelectItem key={s} value={s}>{t(`cs.${s}` as Key)}</SelectItem>)}</SelectContent>
        </Select>
      </Label>
      <SettingSlider name="cartoon_transparency" label={t("cartoonTransparency")} min={0} max={0.9} step={0.05} />
      <SettingSlider name="stick_radius" label={t("stickRadius")} min={0.08} max={0.5} step={0.01} />
      <SettingSlider name="sphere_scale" label={t("sphereScale")} min={0.2} max={1.5} step={0.05} />
    </SidebarCard>
  );
}

function SceneCard() {
  const t = useT();
  useScene(scene, EVENTS);
  const water = scene.atoms.filter((a) => a.cls === "solvent");
  const toggles: [keyof Settings, Key][] = [["fog", "fog"], ["outline", "outline"], ["orthoscopic", "ortho"]];
  return (
    <SidebarCard icon={Contrast} title={t("card.scene")}>
      <div className="flex flex-col gap-2.5">
        <SwitchRow label={t("water")} checked={water.some((a) => a.reps & ALL_REPS)} disabled={!water.length}
          onChange={(on) => run(on ? "show ballstick, solvent" : "hide everything, solvent")} />
        {toggles.map(([key, label]) => (
          <SwitchRow key={key} label={t(label)} checked={!!scene.settings[key]} onChange={(on) => run(`set ${key}, ${on ? 1 : 0}`)} />
        ))}
      </div>
    </SidebarCard>
  );
}

function PresetsCard() {
  const t = useT();
  const presets: [string, LucideIcon, Key][] = [
    ["simple", Spline, "preset.simple"], ["ligand_sites", Target, "preset.ligand"], ["pretty_surface", Cloud, "preset.surface"],
    ["publication", ImageIcon, "preset.publication"], ["ball_and_stick", Atom, "preset.ballstick"], ["b_factor", Activity, "preset.bfactor"],
  ];
  return (
    <SidebarCard icon={WandSparkles} title={t("card.presets")}>
      <div className="grid grid-cols-2 gap-1.5">
        {presets.map(([cmd, Icon, label]) => (
          <button key={cmd} onClick={() => run(fill(`preset.${cmd} {t}`))}
            className="flex h-[38px] items-center gap-2 rounded-[10px] border bg-gradient-to-b from-card to-secondary px-2.5 text-left text-xs font-semibold hover:border-primary hover:text-primary">
            <Icon className="size-4 text-primary" />{t(label)}
          </button>
        ))}
      </div>
    </SidebarCard>
  );
}

function AnalysisCard() {
  const t = useT();
  useScene(scene, EVENTS);
  const { measureMode } = viewerUi.use();
  const contacts = scene.measurements.some((m) => m.kind === "contacts");
  const pocket = scene.selections.has("pocket");
  return (
    <SidebarCard icon={Microscope} title={t("card.analysis")}>
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant={contacts ? "default" : "outline"} size="lg" title={t("contacts.title")} className={cn(!contacts && "bg-secondary")}
          onClick={() => run(contacts ? "polar_contacts off" : "polar_contacts")}>
          <Network />{t(contacts ? "contactsOff" : "contacts")}
        </Button>
        <Button variant={pocket ? "default" : "outline"} size="lg" title={t("pocket.title")} className={cn(!pocket && "bg-secondary")}
          onClick={() => run(pocket
            ? "hide sticks, pocket and polymer; delete pocket; zoom not solvent"
            : "select pocket, byres polymer within 5 of organic; show sticks, pocket and not name N+C+O; deselect; zoom pocket")}>
          <Focus />{t(pocket ? "pocketOff" : "pocket")}
        </Button>
      </div>
      <FieldLabel className="-mb-1 text-[11.5px]">{t("measureHint")}</FieldLabel>
      <Segmented value={measureMode ?? ""} onChange={(v) => setMeasureMode(v as "distance" | "angle" | "dihedral")}
        items={[{ value: "distance", label: t("distance"), icon: Ruler }, { value: "angle", label: t("angle"), icon: Triangle }, { value: "dihedral", label: t("dihedral"), icon: Axis3d }]} />
      <FieldLabel className="-mb-1 text-[11.5px]">{t("mouseSelects")}</FieldLabel>
      <Segmented value={scene.settings.mouse_selection_mode} onChange={(v) => run(`set mouse_selection_mode, ${v}`)}
        items={[{ value: "atoms", label: t("atoms") }, { value: "residues", label: t("residues") }, { value: "chains", label: t("chains") }]} />
    </SidebarCard>
  );
}

// ---------------------------------------------------------------- structure info
function PdbChip({ children, className }: { children: string; className?: string }) {
  return (
    <span className={cn("grid h-[34px] place-items-center rounded-lg bg-gradient-to-br from-primary to-sky px-2 text-xs font-bold tracking-[0.03em] text-white", className)}>{children}</span>
  );
}
export { PdbChip };

function InfoCard() {
  const t = useT();
  useScene(scene, ["objects", "selections"]);
  const { current: o, info: infos } = viewerUi.use();
  if (!o) {
    return <SidebarCard plain icon={Info} title={t("structure")}><Placeholder>{t("info.none")}</Placeholder></SidebarCard>;
  }
  const polymer = o.atoms.filter((a) => a.cls === "protein" || a.cls === "nucleic");
  const residues = new Set(polymer.map((a) => a.rid)).size;
  const chains = [...new Set(polymer.map((a) => a.chain))];
  const ligs = new Map<string, number>();
  const ligRids = new Set<number>();
  for (const a of o.atoms) if (a.cls === "organic" && !ligRids.has(a.rid)) { ligRids.add(a.rid); ligs.set(a.resn, (ligs.get(a.resn) ?? 0) + 1); }
  const waters = new Set(o.atoms.filter((a) => a.cls === "solvent").map((a) => a.rid)).size;
  const info = o.pdbId ? infos.get(o.pdbId) : undefined;
  const ent = typeof info === "object" ? info : undefined;
  const title = ent?.title ?? t(info === "loading" ? "info.loading" : o.pdbId ? "info.unavailable" : "info.local");
  const meta = (label: Key, value: string, wide = false) => (
    <div key={label} className={cn("min-w-0 rounded-[10px] border bg-secondary px-2 py-1.5", wide && "col-span-2")}>
      <span className="block text-[10.5px] font-semibold tracking-[0.05em] text-faint uppercase">{t(label)}</span>
      <b className="block truncate text-[12.5px] font-semibold" title={value}>{value}</b>
    </div>
  );
  return (
    <SidebarCard plain className="gap-2.5">
      <div className="flex items-center gap-2.5">
        <PdbChip className="h-10 min-w-[58px] text-sm">{o.pdbId ?? o.name.slice(0, 6).toUpperCase()}</PdbChip>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{ent?.method ? cap(ent.method) : t(o.pdbId ? "info.entry" : "info.uploaded")}</div>
          <b className="block truncate">{o.name}</b>
        </div>
        {o.pdbId && (
          <a href={`https://www.rcsb.org/structure/${o.pdbId}`} target="_blank" rel="noopener" title={t("info.open")}
            className="ml-auto grid size-[30px] flex-none place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-primary">
            <ExternalLink className="size-4" />
          </a>
        )}
      </div>
      <div className="text-[13.5px] leading-snug font-semibold">{title}</div>
      <div className="grid grid-cols-2 gap-1.5">
        {ent?.resolution ? meta("info.resolution", `${ent.resolution.toFixed(2)} Å`) : null}
        {ent?.released ? meta("info.released", ent.released) : null}
        {ent?.organism ? meta("info.organism", ent.organism, true) : null}
        {ent?.description ? meta("info.entity", ent.description, true) : null}
        {meta("info.atoms", o.atoms.length.toLocaleString())}
        {meta("info.residues", residues.toLocaleString())}
        {meta("info.chains", chains.join(", ") || "–")}
        {meta("info.waters", String(waters))}
      </div>
      {ligs.size > 0 && (
        <>
          <FieldLabel className="-mb-1 text-[11.5px]">{t("info.ligands")}</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {[...ligs].map(([r, n]) => {
              const name = ligSel(r), on = scene.selections.has(name);
              return (
                <button key={r} title={t("info.ligTitle")}
                  className={cn("rounded-full border bg-secondary px-2 py-0.5 text-[11.5px] font-semibold text-ligand hover:border-ligand", on && "border-ligand bg-ligand text-white hover:text-white")}
                  onClick={() => on ? run(`delete ${name}; zoom not solvent`)
                    : run(`select ${name}, model ${o.name} and resn ${r}; show sticks, ${name}; zoom ${name}`).then(() => viewerUi.set({ target: name }))}>
                  {r}{n > 1 ? ` ×${n}` : ""}
                </button>
              );
            })}
          </div>
        </>
      )}
    </SidebarCard>
  );
}

// ---------------------------------------------------------------- lists
function Item({ active, off, dot, name, sub, onClick, children }: {
  active?: boolean; off?: boolean; dot: React.ReactNode; name: string; sub: string; onClick?: () => void; children: React.ReactNode;
}) {
  return (
    <div onClick={onClick}
      className={cn("flex min-h-[38px] items-center gap-2 rounded-[10px] border border-transparent bg-secondary py-1.5 pr-1.5 pl-2.5 hover:border-border", off && "opacity-55", active && "border-primary hover:border-primary", onClick && "cursor-pointer")}>
      {dot}
      <span className="truncate font-semibold">{name}</span>
      <span className="ml-auto text-[11.5px] whitespace-nowrap text-muted-foreground tabular-nums">{sub}</span>
      <span className="flex gap-px" onClick={(e) => e.stopPropagation()}>{children}</span>
    </div>
  );
}

function Act({ title, icon: Icon, onClick, danger, on }: { title: string; icon: LucideIcon; onClick: () => void; danger?: boolean; on?: boolean }) {
  return (
    <Button variant="ghost" size="icon-xs" title={title} onClick={onClick}
      className={cn("size-[26px] text-faint hover:text-primary", on && "text-primary", danger && "hover:text-destructive")}>
      <Icon className="size-3.5" />
    </Button>
  );
}

function ObjectsCard() {
  const t = useT();
  useScene(scene, ["objects"]);
  const { current } = viewerUi.use();
  return (
    <SidebarCard icon={Boxes} title={t("objects")}>
      <div className="flex flex-col gap-1">
        {!scene.objects.length && <Placeholder>{t("list.noObjects")}</Placeholder>}
        {scene.objects.map((o) => (
          <Item key={o.name} off={!o.enabled} active={o === current} name={o.name}
            dot={<span className="size-2.5 flex-none rounded-full" style={{ background: toHex(scene.chainColor(o, o.atoms[0].chain)) }} />}
            sub={t("list.atoms", { n: o.atoms.length.toLocaleString() })} onClick={() => viewerUi.set({ current: o })}>
            <Act title={t(o.enabled ? "act.hide" : "act.show")} icon={o.enabled ? Eye : EyeOff} onClick={() => run(`${o.enabled ? "disable" : "enable"} ${o.name}`)} />
            <Act title={t("act.zoom")} icon={Scan} onClick={() => run(`zoom ${o.name}`)} />
            <Act title={t("act.delete")} icon={Trash2} danger onClick={() => run(`delete ${o.name}`)} />
          </Item>
        ))}
      </div>
    </SidebarCard>
  );
}

function SelectionsCard() {
  const t = useT();
  useScene(scene, EVENTS);
  const names = visibleSelections();
  const sticksOn = (n: string) => {
    const atoms = [...scene.selections.get(n)!].filter((a) => a.cls !== "solvent");
    return atoms.length > 0 && atoms.every((a) => a.reps & REP.sticks);
  };
  return (
    <SidebarCard icon={MousePointerClick} title={t("selections")}>
      <div className="flex flex-col gap-1">
        {!names.length && <Placeholder>{t("list.noSelections")}</Placeholder>}
        {names.map((n) => {
          const ind = scene.indicated === n, sticks = sticksOn(n);
          return (
            <Item key={n} active={ind} name={n} dot={<span className="size-2.5 flex-none rounded-full bg-pick" />}
              sub={t("list.atoms", { n: scene.selections.get(n)!.size })} onClick={() => viewerUi.set({ target: n })}>
              <Act title={t("act.indicate")} icon={ind ? Eye : EyeOff} onClick={() => run(`${ind ? "disable" : "enable"} ${n}`)} />
              <Act title={t("act.zoom")} icon={Scan} onClick={() => run(`zoom ${n}`)} />
              <Act title={t(sticks ? "act.hideSticks" : "act.showSticks")} icon={Network} on={sticks} onClick={() => run(`${sticks ? "hide" : "show"} sticks, ${n}`)} />
              <Act title={t("act.delete")} icon={Trash2} danger onClick={() => run(`delete ${n}`)} />
            </Item>
          );
        })}
      </div>
    </SidebarCard>
  );
}

/** Measurement summary; counts are translated, single values (Å, °) are not. */
function summary(t: ReturnType<typeof useT>, m: Measurement) {
  const n = m.groups.length;
  if (!n) return t("list.noPairs");
  if (n > 1) return t(m.kind === "contacts" ? "list.contacts" : "list.pairs", { n });
  return m.summary;
}

function MeasurementsCard() {
  const t = useT();
  useScene(scene, ["measurements"]);
  const icons = { distance: Ruler, angle: Triangle, dihedral: Axis3d, contacts: Network };
  return (
    <SidebarCard icon={Ruler} title={t("measurements")}>
      <div className="flex flex-col gap-1">
        {!scene.measurements.length && <Placeholder>{t("list.noMeasurements")}</Placeholder>}
        {scene.measurements.map((m) => {
          const Icon = icons[m.kind];
          return (
            <Item key={m.name} off={!m.visible} name={m.name} sub={summary(t, m)}
              dot={<Icon className={cn("size-4 flex-none", m.kind === "contacts" ? "text-sky" : "text-ligand")} />}>
              <Act title={t(m.visible ? "act.hide" : "act.show")} icon={m.visible ? Eye : EyeOff} onClick={() => run(`${m.visible ? "disable" : "enable"} ${m.name}`)} />
              <Act title={t("act.delete")} icon={Trash2} danger onClick={() => run(`delete ${m.name}`)} />
            </Item>
          );
        })}
      </div>
    </SidebarCard>
  );
}
