import { useMemo, useRef, useState } from "react";
import { Activity, Camera, ChevronDown, Cpu, Dna, Flame, Gauge, History, Maximize, Pause, Pill, Play, RotateCcw, Scan, Settings2, Square, Terminal, Trash2, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, Hint, SwitchRow } from "@/components/controls";
import { BarChart, ChartCard, Heatmap, LineChart } from "@/components/md/charts";
import { C, interactionColor } from "@/md/palette";
import { SceneHost } from "@/components/scene-host";
import { SidebarCard } from "@/components/sidebar-card";
import { ToolButton, ToolSep, toolbarClass } from "@/components/viewer/stage";
import { mdCtl as ctl, mdHost, mdScene } from "@/core";
import type { MdResults, MdState, Settings } from "@/md/controller";
import { useT, type Key } from "@/i18n";
import { cn } from "@/lib/utils";

const selectTrigger = "w-full bg-secondary font-medium";

export function MdSidebar() {
  return (
    <aside className="flex min-h-0 flex-col gap-2.5 overflow-y-auto pb-1">
      <StatusCard />
      <RunsCard />
      <ComplexCard />
      <SimCard />
      <SystemCard />
      <EquilCard />
      <RunCard />
    </aside>
  );
}

function StatusCard() {
  const t = useT();
  const s = ctl.store.use();
  const text = s.backend === "ready" ? t("md.status.ok", { openmm: s.info.openmm ?? "?", prolif: s.info.prolif ?? "?", platforms: (s.info.platforms ?? []).join("/") })
    : s.backend === "missing" ? t("md.status.missing") : s.backend === "offline" ? t("dock.status.offline") : t("dock.status.checking");
  return (
    <SidebarCard plain icon={Cpu} title={t("md.backend")}>
      <div className={cn("flex items-start gap-2 text-xs", s.backend === "ready" ? "text-muted-foreground" : "text-destructive")}>
        <i className={cn("mt-1 size-2 shrink-0 rounded-full", s.backend === "ready" ? "bg-emerald-500" : s.backend === "checking" ? "bg-amber-400" : "bg-destructive")} />
        <span>{text}</span>
      </div>
    </SidebarCard>
  );
}

function RunsCard() {
  const t = useT();
  const s = ctl.store.use();
  const cur = s.runs.find((r) => r.id === s.run);
  return (
    <SidebarCard icon={History} title={t("md.runs")}>
      <Select value={s.run} onValueChange={(v) => ctl.loadRun(v)} disabled={!s.runs.length || s.running}>
        <SelectTrigger className={selectTrigger}><SelectValue placeholder={t("md.runs.pick")} /></SelectTrigger>
        <SelectContent position="popper">
          {s.runs.map((r) => <SelectItem key={r.id} value={r.id}>{r.example ? `★ ${r.name}` : `${r.name} · ${r.created.slice(5, 16).replace("T", " ")}`}</SelectItem>)}
        </SelectContent>
      </Select>
      {cur && (
        <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <span className="flex-1">{t("md.runs.info", { ns: cur.production_ns, frames: cur.frames, ok: cur.checks_ok, n: cur.checks, platform: cur.platform })}</span>
          {!cur.example && <Button variant="ghost" size="icon-sm" title={t("md.runs.delete")} onClick={() => ctl.deleteRun(cur.id)}><Trash2 /></Button>}
        </div>
      )}
      {!s.runs.length && <Hint>{t("md.runs.none")}</Hint>}
    </SidebarCard>
  );
}

function ComplexCard() {
  const t = useT();
  const s = ctl.store.use();
  return (
    <SidebarCard icon={Dna} title={t("md.structure")}>
      <Field label={t("md.receptor")} className="grid-cols-1">
        <div className="rounded-[9px] border bg-secondary px-3 py-2 text-[13px] font-semibold">{s.receptor || "–"}</div>
      </Field>
      <Field label={t("md.ligand")} className="grid-cols-1">
        <Select value={s.ligand} onValueChange={(v) => ctl.setSettings({ ligand: v })} disabled={!s.options.length}>
          <SelectTrigger className={selectTrigger}><SelectValue placeholder={t("md.noLigand")} /></SelectTrigger>
          <SelectContent position="popper">{s.options.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label={t("md.smiles")} className="grid-cols-1">
        <Input value={s.smiles} onChange={(e) => ctl.setSettings({ smiles: e.target.value })} spellCheck={false} className="bg-secondary font-mono text-xs" />
      </Field>
      {s.resname && !s.smiles.trim() && <Hint>{t("md.smilesHint", { res: s.resname })}</Hint>}
    </SidebarCard>
  );
}

function Num({ k, label, step = "any" }: { k: keyof Settings; label: string; step?: string }) {
  const s = ctl.store.use();
  return (
    <Field label={label} className="grid-cols-[1fr_92px]">
      <Input type="number" step={step} value={s[k] as string} onChange={(e) => ctl.setSettings({ [k]: e.target.value } as Partial<MdState>)} className="bg-secondary text-right tabular-nums" />
    </Field>
  );
}

function Pick({ k, label, items }: { k: keyof Settings; label: string; items: string[] }) {
  const s = ctl.store.use();
  return (
    <Field label={label} className="grid-cols-[1fr_130px]">
      <Select value={s[k] as string} onValueChange={(v) => ctl.setSettings({ [k]: v } as Partial<MdState>)}>
        <SelectTrigger className={selectTrigger}><SelectValue /></SelectTrigger>
        <SelectContent position="popper">{items.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
  );
}

function SimCard() {
  const t = useT();
  const s = ctl.store.use();
  const frames = Math.floor((+s.productionNs * 1000) / (+s.reportPs || 1));
  return (
    <SidebarCard icon={Flame} title={t("md.sim")}>
      <Num k="productionNs" label={t("md.prodNs")} />
      <Num k="reportPs" label={t("md.reportPs")} />
      <Hint>≈ {Number.isFinite(frames) ? frames : "?"} frames</Hint>
      <Num k="timestepFs" label={t("md.dt")} />
      <SwitchRow label={t("md.hmr")} checked={s.hmr} onChange={(v) => ctl.setSettings({ hmr: v, ...(v && +s.timestepFs < 4 ? { timestepFs: "4" } : {}) })} />
      <Num k="temperature" label={t("md.temp")} />
      <Num k="pressure" label={t("md.press")} />
      <Num k="friction" label={t("md.friction")} />
      <Num k="barostatInterval" label={t("md.baroInt")} />
    </SidebarCard>
  );
}

function SystemCard() {
  const t = useT();
  return (
    <SidebarCard icon={Waves} title={t("md.system")} open={false}>
      <Num k="padding" label={t("md.padding")} />
      <Num k="ionic" label={t("md.ionic")} />
      <Pick k="waterModel" label={t("md.water")} items={["tip3p", "tip4pew", "spce"]} />
      <Pick k="proteinFf" label={t("md.pff")} items={["amber14-all", "amber99sbildn"]} />
      <Pick k="ligandFf" label={t("md.lff")} items={["openff-2.1.0", "gaff-2.11"]} />
      <Pick k="charges" label={t("md.charges")} items={["gasteiger", "mmff94", "nagl"]} />
      <Hint>{t("md.chargesHint")}</Hint>
      <Num k="cutoff" label={t("md.cutoff")} />
    </SidebarCard>
  );
}

function EquilCard() {
  const t = useT();
  return (
    <SidebarCard icon={Gauge} title={t("md.equil")} open={false}>
      <Num k="minimize" label={t("md.minSteps")} />
      <Num k="nvt" label={t("md.nvt")} />
      <Num k="npt" label={t("md.npt")} />
      <Num k="restraint" label={t("md.restraint")} />
    </SidebarCard>
  );
}

function RunCard() {
  const t = useT();
  const s = ctl.store.use();
  const [logOpen, setLogOpen] = useState(false);
  const err = s.stage.startsWith("err:");
  const stageText = err ? s.stage.slice(4) : s.stage ? t(`md.stage.${s.stage}` as Key, { n: s.frames }) : s.running ? t("dock.stage.submit") : "";
  return (
    <SidebarCard plain icon={Settings2} title={t("md.runCfg")} className="gap-2.5">
      <Pick k="platform" label={t("md.platform")} items={["auto", "CUDA", "OpenCL", "CPU"]} />
      <Num k="maxWall" label={t("md.maxWall")} />
      <Num k="seed" label={t("md.seed")} />
      <Button variant="ghost" size="sm" className="self-start text-xs text-muted-foreground" onClick={() => ctl.reset()}>{t("md.reset")}</Button>
      <Button variant={s.running ? "destructive" : "default"} disabled={!s.running && !!s.why} title={s.why ?? ""}
        className={cn("h-[42px] w-full text-sm font-semibold", s.running && "bg-destructive text-white hover:bg-destructive/90")}
        onClick={() => ctl.toggleRun()}>
        {s.running ? <Square /> : <Play />}{t(s.running ? "md.cancel" : "md.run")}
      </Button>
      {stageText && <div className={cn("text-[12.5px] font-semibold text-muted-foreground", err && "text-destructive")}>{stageText}</div>}
      {s.running && <Progress value={s.progress} className="h-1.5" />}
      {s.log.length > 0 && (
        <Collapsible open={logOpen} onOpenChange={setLogOpen}>
          <CollapsibleTrigger className="flex w-full items-center gap-[7px] text-xs font-semibold text-muted-foreground">
            <Terminal className="size-4" />{t("dock.log")}<ChevronDown className={cn("ml-auto size-3.5 transition-transform", logOpen && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}
              className="mt-2 max-h-[180px] overflow-auto rounded-[9px] border bg-secondary px-2.5 py-2 font-mono text-[11px] leading-normal break-all whitespace-pre-wrap text-muted-foreground">{s.log.join("\n")}</pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </SidebarCard>
  );
}

// ---------------------------------------------------------------- stage
export function MdStage() {
  const t = useT();
  const s = ctl.store.use();
  const wrap = useRef<HTMLDivElement>(null);
  const r = s.results;
  const nFrames = ctl.frameCount();
  return (
    <main className="flex min-h-0 min-w-0 flex-col gap-2.5 overflow-y-auto">
      <SceneHost scene={mdScene} host={mdHost} wrapRef={wrap} className="h-[calc(100dvh-80px)] min-h-[420px] w-full flex-none">
        {!r && !s.running && (
          <div className="pointer-events-none absolute inset-0 z-[4] flex flex-col items-center justify-center gap-1.5 p-5 text-center">
            <Activity className="mb-1.5 size-11 stroke-[1.5] text-primary" />
            <h2 className="m-0 text-xl tracking-tight">{t("md.empty.title")}</h2>
            <p className="m-0 max-w-md text-muted-foreground">{t("md.empty.text")}</p>
          </div>
        )}
        {s.running && (
          <div className="pointer-events-none absolute inset-0 z-[4] flex flex-col items-center justify-center gap-3 p-5 text-center">
            <Flame className="size-9 animate-pulse text-primary" />
            <div className="text-sm font-semibold">{s.stage ? t(`md.stage.${s.stage}` as Key, { n: s.frames }) : t("dock.stage.submit")}</div>
            <Progress value={s.progress} className="h-1.5 w-64" />
          </div>
        )}
        {nFrames > 0 && (
          <div className="absolute right-3 bottom-3 left-3 z-[5] flex items-center gap-3 rounded-full border bg-glass px-3 py-1.5 backdrop-blur-md">
            <Button size="icon-sm" variant="ghost" onClick={() => (s.playing ? ctl.pause() : ctl.play())}>{s.playing ? <Pause /> : <Play />}</Button>
            <Slider min={0} max={nFrames - 1} step={1} value={[s.frame]} onValueChange={([v]) => { ctl.pause(); ctl.setFrame(v); }} className="flex-1" />
            <span className="text-[11.5px] font-semibold whitespace-nowrap tabular-nums">
              {t("md.frame", { i: s.frame + 1, n: nFrames, ps: Math.round((r?.view_dt_ps ?? 0) * s.frame) })}
            </span>
          </div>
        )}
        <nav className={toolbarClass}>
          <ToolButton title={t("tb.reset")} icon={RotateCcw} onClick={() => ctl.resetView()} />
          <ToolButton title={t("dock.tb.zoom")} icon={Scan} onClick={() => ctl.zoomLigand()} />
          <ToolSep />
          <ToolButton title={t("tb.png")} icon={Camera} onClick={() => ctl.png()} />
          <ToolButton title={t("tb.fullscreen")} icon={Maximize}
            onClick={() => { if (document.fullscreenElement) document.exitFullscreen(); else wrap.current?.requestFullscreen?.(); }} />
        </nav>
      </SceneHost>
      {r && <Results r={r} focus={s.focus} />}
    </main>
  );
}

function Results({ r, focus }: { r: MdResults; focus: string | null }) {
  const t = useT();
  const m = r.meta;
  const [sel, setSel] = useState<string | null>(null);
  const rows = useMemo(() => r.interactions.items.map((i) => ({ label: i.res, type: i.type, present: i.present, occupancy: i.occupancy })), [r]);
  const res = r.rmsf.res.map((n, i) => `${r.rmsf.chain[i] || ""}${n}`);
  const T = r.times;
  const S = r.state;
  const speed = m.ns_per_day.toFixed(0);
  void focus;
  return (
    <div className="flex flex-col gap-2.5 pb-1">
      <div className="px-1 text-xs text-muted-foreground">
        {t("md.summary", { frames: m.frames, req: m.frames_requested, atoms: m.atoms.toLocaleString(), platform: m.platform, speed, cut: m.truncated ? t("md.cut") : "" })}
      </div>
      <Tabs defaultValue="contacts">
        <TabsList className="h-auto w-fit gap-[3px] rounded-[10px] border bg-card p-[3px]">
          <TabsTrigger value="contacts" className="h-7 px-3 text-xs font-semibold"><Pill />{t("md.tab.contacts")}</TabsTrigger>
          <TabsTrigger value="stability" className="h-7 px-3 text-xs font-semibold"><Activity />{t("md.tab.stability")}</TabsTrigger>
          <TabsTrigger value="quality" className="h-7 px-3 text-xs font-semibold"><Gauge />{t("md.tab.quality")}</TabsTrigger>
        </TabsList>

        <TabsContent value="contacts" className="mt-2.5">
          <ChartCard title={t("md.heat.title")} legend={[...new Set(rows.map((x) => x.type))].map((x) => ({ label: x, color: interactionColor(x) }))}>
            {rows.length ? <Heatmap rows={rows} frames={r.interactions.times.length} selected={sel} onSelect={(l) => { const v = sel === l ? null : l; setSel(v); ctl.focusResidue(v); }} />
              : <div className="py-6 text-center text-xs text-faint">{t("md.heat.none")}</div>}
            <Hint>{t("md.heat.hint")} · {t("md.chart.time")}: {r.interactions.times[0]}–{r.interactions.times.at(-1)}</Hint>
          </ChartCard>
        </TabsContent>

        <TabsContent value="stability" className="mt-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-2">
          <ChartCard title={t("md.chart.rmsdProt")}><LineChart x={T} series={[{ y: r.rmsd.protein, color: C.blue }]} xLabel={t("md.chart.time")} /></ChartCard>
          <ChartCard title={t("md.chart.rmsdLig")}><LineChart x={T} series={[{ y: r.rmsd.ligand, color: C.amber }]} xLabel={t("md.chart.time")} /></ChartCard>
          <ChartCard title={t("md.chart.com")}><LineChart x={T} series={[{ y: r.com_dist, color: C.violet }]} xLabel={t("md.chart.time")} /></ChartCard>
          <ChartCard title={t("md.chart.min")}><LineChart x={T} series={[{ y: r.min_dist, color: C.teal }]} xLabel={t("md.chart.time")} /></ChartCard>
          <ChartCard title={t("md.chart.contacts")}><LineChart x={T} series={[{ y: r.contacts, color: C.pink }]} xLabel={t("md.chart.time")} step /></ChartCard>
          <ChartCard title={t("md.chart.rg")}><LineChart x={T} series={[{ y: r.rg, color: C.slate }]} xLabel={t("md.chart.time")} /></ChartCard>
          <ChartCard title={t("md.chart.rmsf")} className="xl:col-span-2"><BarChart labels={res} values={r.rmsf.value} color={C.blue} /></ChartCard>
        </TabsContent>

        <TabsContent value="quality" className="mt-2.5 flex flex-col gap-2.5">
          <div className="grid grid-cols-1 gap-1.5 rounded-(--radius) border bg-card p-3 shadow-card md:grid-cols-2">
            {r.checks.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-xs">
                <i className={cn("size-2.5 shrink-0 rounded-full", c.ok ? "bg-emerald-500" : "bg-destructive")} />
                <span className="flex-1">{t(`md.check.${c.id}` as Key)}</span>
                <b className="tabular-nums">{c.value} {c.unit}</b>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
            <ChartCard title={t("md.chart.energy")} legend={[{ label: t("md.chart.pot"), color: C.blue }, { label: t("md.chart.tot"), color: C.amber }]}>
              <LineChart x={S.time} series={[{ y: S.potential, color: C.blue }, { y: S.total, color: C.amber }]} xLabel={t("md.chart.time")} />
            </ChartCard>
            <ChartCard title={t("md.chart.temp")}><LineChart x={S.time} series={[{ y: S.temperature, color: C.red }]} refLine={r.config.temperature_k as number} xLabel={t("md.chart.time")} /></ChartCard>
            <ChartCard title={t("md.chart.density")}><LineChart x={S.time} series={[{ y: S.density, color: C.sky }]} refLine={1} xLabel={t("md.chart.time")} /></ChartCard>
            <ChartCard title={t("md.chart.volume")}><LineChart x={S.time} series={[{ y: S.volume, color: C.slate }]} xLabel={t("md.chart.time")} /></ChartCard>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
