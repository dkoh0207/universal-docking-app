import { useRef, useState } from "react";
import {
  Anchor, Box, Camera, ChevronDown, Crosshair, Dna, Download, Maximize, MousePointerClick, Network, Pill, Play, RefreshCw,
  RotateCcw, Scan, Send, Server, Settings2, Square, Terminal, Trophy, Upload,
} from "lucide-react";
import { fetchFromInput } from "@/actions";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field, Hint, Placeholder, Segmented, SliderRow, SwitchRow } from "@/components/controls";
import { SceneHost } from "@/components/scene-host";
import { SidebarCard } from "@/components/sidebar-card";
import { ToolButton, ToolSep, toolbarClass } from "@/components/viewer/stage";
import { dockCtl as ctl, dockHost, dockScene } from "@/core";
import { ADDITIVES, backendStatus, poseColor, shortVersion, type Src } from "@/dock/controller";
import { CNN_SCORING, ENGINES, ENGINE_IDS, POSE_SORT, type EngineId } from "@/dock/engines";
import { useScene } from "@/hooks/use-scene";
import { useT, type Key } from "@/i18n";
import { cn } from "@/lib/utils";

const selectTrigger = "w-full bg-secondary font-medium";

export function DockSidebar() {
  return (
    <aside className="flex min-h-0 flex-col gap-2.5 overflow-y-auto pb-1">
      <StatusCard />
      <ReceptorCard />
      <LigandCard />
      <BoxCard />
      <ParamsCard />
      <RunCard />
      <ResultsCard />
    </aside>
  );
}

// ---------------------------------------------------------------- backend & engines
function StatusCard() {
  const t = useT();
  const s = ctl.store.use();
  const { kind, missing } = backendStatus(s);
  const engine = ENGINES[s.engine];
  const cmd = missing.length === 1 && missing[0] === "Open Babel" ? "pnpm run setup" : engine.setup;
  const text = kind === "ok" ? t("dock.status.ok", { engine: engine.label, ver: shortVersion(s.versions[s.engine]), obabel: shortVersion(s.obabel) })
    : kind === "offline" ? t("dock.status.offline")
    : kind === "missing" ? t("dock.status.missing", { tools: missing.join(", "), cmd })
    : t("dock.status.checking");
  const bad = kind === "offline" || kind === "missing";
  return (
    <SidebarCard plain icon={Server} title={t("dock.backend")}
      action={<Button variant="ghost" size="icon-sm" title={t("dock.recheck")} onClick={() => ctl.checkBackend()}><RefreshCw /></Button>}>
      <div className={cn("flex items-start gap-2.5 text-[12.5px] leading-snug font-semibold", bad && "text-destructive")}>
        <span className={cn("mt-1 size-[9px] flex-none rounded-full bg-faint", kind === "ok" && "bg-ok ring-[3px] ring-ok/25", bad && "bg-destructive ring-[3px] ring-destructive/25")} />
        <span>{text}</span>
      </div>
      {s.backend === "ready" && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-muted-foreground">
          {ENGINE_IDS.map((id) => (
            <li key={id} className="flex items-center justify-between gap-2">
              <span>{ENGINES[id].label}</span>
              <span className={cn("tabular-nums", !s.versions[id] && "text-faint")}>{s.versions[id] ? shortVersion(s.versions[id]) : t("dock.status.notInstalled")}</span>
            </li>
          ))}
        </ul>
      )}
    </SidebarCard>
  );
}

// ---------------------------------------------------------------- receptor
function ReceptorCard() {
  const t = useT();
  const s = ctl.store.use();
  const [id, setId] = useState("");
  return (
    <SidebarCard icon={Dna} title={t("dock.receptor")}>
      <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (fetchFromInput(id)) setId(""); }}>
        <Input value={id} onChange={(e) => setId(e.target.value)} maxLength={4} spellCheck={false} autoComplete="off" placeholder="1IEP" aria-label={t("dock.fetch")} className="bg-secondary uppercase" />
        <Button type="submit" variant="outline" className="bg-secondary" disabled={id.trim().length !== 4}><Download />{t("dock.fetch")}</Button>
      </form>
      <Select value={s.receptor} onValueChange={(v) => ctl.setReceptor(v)} disabled={!s.receptors.length}>
        <SelectTrigger className={selectTrigger}><SelectValue placeholder={t("dock.noReceptor")} /></SelectTrigger>
        <SelectContent position="popper">{s.receptors.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
      </Select>
      <div className="flex flex-col gap-2.5">
        <SwitchRow label={t("dock.noWater")} checked={s.noWater} onChange={(v) => ctl.setReceptorOptions({ noWater: v })} />
        <SwitchRow label={t("dock.keepHet")} checked={s.keepHet} onChange={(v) => ctl.setReceptorOptions({ keepHet: v })} />
      </div>
      {s.recInfo && <Hint>{t("dock.recInfo", s.recInfo)}</Hint>}
    </SidebarCard>
  );
}

// ---------------------------------------------------------------- ligand
function LigandCard() {
  const t = useT();
  const s = ctl.store.use();
  const file = useRef<HTMLInputElement>(null);
  return (
    <SidebarCard icon={Pill} title={t("dock.ligand")}>
      <Segmented value={s.src} onChange={(v) => ctl.setSrc(v as Src)}
        items={[{ value: "structure", label: t("dock.src.structure") }, { value: "upload", label: t("dock.src.upload") }, { value: "smiles", label: t("dock.src.smiles") }]} />
      {s.src === "structure" && (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap gap-1.5">
            {!s.receptor && <Placeholder>{t("dock.noReceptor")}</Placeholder>}
            {s.receptor && !s.ligands.length && <Placeholder>{t("dock.noLigands")}</Placeholder>}
            {[...s.ligands].sort((a, b) => b.n - a.n).map((l) => (
              <button key={l.key} title={t("dock.heavy", { n: l.n })} onClick={() => ctl.pickLigand(l.key)}
                className={cn("rounded-full border bg-secondary px-2 py-0.5 text-[11.5px] font-semibold text-ligand hover:border-ligand",
                  l.key !== s.ligKey && (ADDITIVES.has(l.key.split("|")[3]) || l.n < 6) && "opacity-50",
                  l.key === s.ligKey && "border-ligand bg-ligand text-white hover:text-white")}>{l.label}</button>
            ))}
          </div>
          <Hint>{t("dock.structureHint")}</Hint>
        </div>
      )}
      {s.src === "upload" && (
        <div className="flex flex-col gap-2.5">
          <Button variant="outline" size="lg" className="w-full bg-secondary" onClick={() => file.current?.click()}><Upload />{t("dock.chooseFile")}</Button>
          <input ref={file} type="file" hidden accept=".sdf,.mol,.mol2,.pdb"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) ctl.setUpload(f); }} />
          <Hint>{s.uploadName}</Hint>
        </div>
      )}
      {s.src === "smiles" && (
        <div className="flex flex-col gap-2.5">
          <Input value={s.smiles} onChange={(e) => ctl.setSmiles(e.target.value)} spellCheck={false} autoComplete="off" placeholder={t("dock.smilesPlaceholder")} className="bg-secondary" />
          <Hint>{t("dock.smilesHint")}</Hint>
        </div>
      )}
    </SidebarCard>
  );
}

// ---------------------------------------------------------------- search box
function Vec({ label, which, step, attrs }: { label: string; which: "center" | "size"; step: number; attrs?: { min: number; max: number } }) {
  const s = ctl.store.use();
  return (
    <div className="grid grid-cols-[52px_repeat(3,minmax(0,1fr))] items-center gap-1.5 text-xs text-muted-foreground">
      <span>{label}</span>
      {[0, 1, 2].map((i) => (
        <Input key={i} type="number" step={step} {...attrs} value={s[which][i]} placeholder={which === "center" ? "xyz"[i] : undefined}
          onChange={(e) => ctl.setVec(which, i, e.target.value)} className="bg-secondary px-2 font-medium tabular-nums" />
      ))}
    </div>
  );
}

function BoxCard() {
  const t = useT();
  const s = ctl.store.use();
  const canCenter = s.src === "structure" && !!s.ligKey;
  return (
    <SidebarCard icon={Box} title={t("dock.box")}>
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="outline" size="lg" className="bg-secondary px-1.5 text-xs" disabled={!canCenter} onClick={() => ctl.centerOnLigand()}><Crosshair />{t("dock.centerLig")}</Button>
        <Button variant="outline" size="lg" className="bg-secondary px-1.5 text-xs" onClick={() => ctl.centerOnSelection()}><MousePointerClick />{t("dock.centerSel")}</Button>
      </div>
      <Vec label={t("dock.center")} which="center" step={0.5} />
      <Vec label={t("dock.size")} which="size" step={1} attrs={{ min: 1, max: 126 }} />
      <SliderRow label={t("dock.padding")} value={s.padding} min={0} max={20} step={1} output={`${s.padding} Å`} onChange={(v) => ctl.setPadding(v)} />
    </SidebarCard>
  );
}

// ---------------------------------------------------------------- parameters
function NumField({ label, value, onChange, placeholder, ...rest }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; min?: number; max?: number; step?: number }) {
  return (
    <Field label={label}><Input type="number" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="bg-secondary font-medium tabular-nums" {...rest} /></Field>
  );
}

function ParamsCard() {
  const t = useT();
  const s = ctl.store.use();
  const engine = ENGINES[s.engine];
  const ready = s.backend === "ready";
  return (
    <SidebarCard icon={Settings2} title={t("dock.params")}>
      <Field label={t("dock.engine")}>
        <Select value={s.engine} onValueChange={(v) => ctl.setEngine(v as EngineId)}>
          <SelectTrigger className={selectTrigger}><SelectValue /></SelectTrigger>
          <SelectContent position="popper">
            {ENGINE_IDS.map((id) => (
              <SelectItem key={id} value={id}>
                {ENGINES[id].label}
                {ready && !s.versions[id] && <span className="text-faint"> · {t("dock.status.notInstalled")}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <NumField label={t("dock.exh")} value={s.exh} onChange={(v) => ctl.setParams({ exh: v })} min={1} max={64} />
      <NumField label={t("dock.modes")} value={s.modes} onChange={(v) => ctl.setParams({ modes: v })} min={1} max={20} />
      {!engine.cnn && <NumField label={t("dock.erange")} value={s.erange} onChange={(v) => ctl.setParams({ erange: v })} min={1} max={20} step={0.5} />}
      <Field label={t("dock.scoring")}>
        <Select value={s.scoring} onValueChange={(v) => ctl.setParams({ scoring: v })}>
          <SelectTrigger className={selectTrigger}><SelectValue /></SelectTrigger>
          <SelectContent position="popper">{engine.scoring.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      {engine.cnn && (
        <>
          <Field label={t("dock.cnnScoring")}>
            <Select value={s.cnnScoring} onValueChange={(v) => ctl.setParams({ cnnScoring: v as typeof s.cnnScoring })}>
              <SelectTrigger className={selectTrigger}><SelectValue /></SelectTrigger>
              <SelectContent position="popper">{CNN_SCORING.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t("dock.poseSort")}>
            <Select value={s.poseSort} onValueChange={(v) => ctl.setParams({ poseSort: v as typeof s.poseSort })}>
              <SelectTrigger className={selectTrigger}><SelectValue /></SelectTrigger>
              <SelectContent position="popper">{POSE_SORT.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <SwitchRow label={t("dock.noGpu")} checked={s.noGpu} onChange={(v) => ctl.setParams({ noGpu: v })} />
        </>
      )}
      <NumField label={t("dock.seed")} value={s.seed} onChange={(v) => ctl.setParams({ seed: v })} min={0} placeholder={t("dock.random")} />
      <NumField label={t("dock.cpu")} value={s.cpu} onChange={(v) => ctl.setParams({ cpu: v })} min={1} placeholder={t("dock.all")} />
    </SidebarCard>
  );
}

// ---------------------------------------------------------------- run
function RunCard() {
  const t = useT();
  const s = ctl.store.use();
  const [logOpen, setLogOpen] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const err = s.stage.startsWith("err:");
  const stageText = err ? s.stage.slice(4) : s.stage ? t(`dock.stage.${s.stage}` as Key) : s.running ? t("dock.stage.submit") : "";
  const docking = s.stage === "docking";
  return (
    <SidebarCard plain className="gap-2.5">
      <Button variant={s.running ? "destructive" : "default"} disabled={!s.running && !!s.why} title={s.why ? t(s.why) : ""}
        className={cn("h-[42px] w-full text-sm font-semibold", s.running && "bg-destructive text-white hover:bg-destructive/90")}
        onClick={() => ctl.toggleRun()}>
        {s.running ? <Square /> : <Play />}{t(s.running ? "dock.cancel" : "dock.run")}
      </Button>
      {stageText && <div className={cn("text-[12.5px] font-semibold text-muted-foreground", err && "text-destructive")}>{stageText}</div>}
      {s.running && (docking ? <Progress value={s.progress} className="h-1.5" />
        : (
          <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
            <i className="absolute block h-full w-[35%] animate-[slide_1.1s_ease-in-out_infinite] rounded-full bg-primary" />
          </div>
        ))}
      {s.log.length > 0 && (
        <Collapsible open={logOpen} onOpenChange={setLogOpen}>
          <CollapsibleTrigger className="flex w-full items-center gap-[7px] text-xs font-semibold text-muted-foreground">
            <Terminal className="size-4" />{t("dock.log")}<ChevronDown className={cn("ml-auto size-3.5 transition-transform", logOpen && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre ref={(el) => { logRef.current = el; if (el) el.scrollTop = el.scrollHeight; }}
              className="mt-2 max-h-[180px] overflow-auto rounded-[9px] border bg-secondary px-2.5 py-2 font-mono text-[11px] leading-normal break-all whitespace-pre-wrap text-muted-foreground">{s.log.join("\n")}</pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </SidebarCard>
  );
}

// ---------------------------------------------------------------- results
function ResultsCard() {
  const t = useT();
  const s = ctl.store.use();
  useScene(dockScene, ["measurements"]);
  const r = s.results;
  if (!r) return null;
  const hasRef = r.refRmsd.some((v) => v !== null);
  const hasCnn = r.modes.some((m) => m.cnn_score !== undefined);
  const hasAev = r.modes.some((m) => m.aev_plig !== undefined);
  const hasRmsd = r.engine !== "gnina"; // GNINA does not report RMSD bounds
  const contacts = ctl.contactsShown();
  const head = "h-6 px-2 text-right text-[10.5px] font-semibold tracking-[0.04em] text-faint uppercase";
  return (
    <SidebarCard plain icon={Trophy} title={t("dock.results")}>
      <Table className="border-separate border-spacing-y-[3px] text-xs tabular-nums">
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            <TableHead className={cn(head, "text-left")}>#</TableHead>
            <TableHead className={head}>{t("dock.col.aff")}</TableHead>
            {hasCnn && <TableHead className={head}>{t("dock.col.cnn")}</TableHead>}
            {hasCnn && <TableHead className={head}>{t("dock.col.cnnAff")}</TableHead>}
            {hasAev && <TableHead className={head} title={t("dock.col.aevTitle")}>{t("dock.col.aev")}</TableHead>}
            {hasRmsd && <TableHead className={head}>{t("dock.col.lb")}</TableHead>}
            {hasRmsd && <TableHead className={head}>{t("dock.col.ub")}</TableHead>}
            {hasRef && <TableHead className={head} title={t("dock.col.refTitle")}>{t("dock.col.ref")}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {r.modes.map((m, i) => {
            const cell = "bg-secondary px-2 py-[7px] text-right font-semibold whitespace-nowrap group-hover/row:bg-accent group-data-[active=true]/row:bg-primary-soft group-data-[active=true]/row:text-primary";
            return (
              <TableRow key={m.mode} data-active={i === r.shown} onClick={() => ctl.showPose(i)} className="group/row cursor-pointer border-0 hover:bg-transparent">
                <TableCell className={cn(cell, "rounded-l-[9px] text-left")}>
                  <span className="mr-2 inline-block size-[9px] rounded-full" style={{ background: poseColor(i) }} />{m.mode}
                </TableCell>
                <TableCell className={cell}>{m.affinity.toFixed(1)}</TableCell>
                {hasCnn && <TableCell className={cell}>{m.cnn_score?.toFixed(2) ?? "–"}</TableCell>}
                {hasCnn && <TableCell className={cell}>{m.cnn_affinity?.toFixed(2) ?? "–"}</TableCell>}
                {hasAev && <TableCell className={cell}>{m.aev_plig?.toFixed(2) ?? "–"}</TableCell>}
                {hasRmsd && <TableCell className={cell}>{m.rmsd_lb.toFixed(2)}</TableCell>}
                {hasRmsd && <TableCell className={cell}>{m.rmsd_ub.toFixed(2)}</TableCell>}
                {hasRef && <TableCell className={cell}>{r.refRmsd[i] === null ? "–" : r.refRmsd[i]!.toFixed(2)}</TableCell>}
                <TableCell className="hidden" />
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <SwitchRow label={t("dock.showAll")} checked={s.showAll} onChange={(v) => ctl.setShowAll(v)} />
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant={contacts ? "default" : "outline"} size="lg" className={cn("px-1.5 text-xs", !contacts && "bg-secondary")} onClick={() => ctl.toggleContacts()}>
          <Network />{t(contacts ? "contactsOff" : "contacts")}
        </Button>
        <Button variant="outline" size="lg" className="bg-secondary px-1.5 text-xs" onClick={() => ctl.sendToViewer()}><Send />{t("dock.send")}</Button>
      </div>
      <Button variant="outline" size="lg" className="bg-secondary" disabled={r.rescoring} onClick={() => ctl.rescore()}>
        <Trophy />{t(r.rescoring ? "dock.rescoring" : "dock.rescore")}
      </Button>
      <Button variant="outline" size="lg" className="bg-secondary" onClick={() => ctl.download()}><Download />{t("dock.download")}</Button>
    </SidebarCard>
  );
}

// ---------------------------------------------------------------- stage
export function DockStage() {
  const t = useT();
  const s = ctl.store.use();
  const wrap = useRef<HTMLDivElement>(null);
  return (
    <main className="flex min-h-0 min-w-0 flex-col gap-2.5">
      <SceneHost scene={dockScene} host={dockHost} wrapRef={wrap}>
        {!s.receptor && (
          <div className="pointer-events-none absolute inset-0 z-[4] flex flex-col items-center justify-center gap-1.5 p-5 text-center">
            <Anchor className="mb-1.5 size-11 stroke-[1.5] text-primary" />
            <h2 className="m-0 text-xl tracking-tight">{t("dock.empty.title")}</h2>
            <p className="m-0 text-muted-foreground">{t("dock.empty.text")}</p>
          </div>
        )}
        <div className="pointer-events-none absolute top-3 left-3 z-[5] flex flex-col gap-[5px]">
          {s.legend.map((l) => (
            <span key={l.key + (l.n ?? "")} className="inline-flex items-center gap-2 self-start rounded-full border bg-glass py-1 pr-2.5 pl-2 text-[11.5px] font-semibold backdrop-blur-md">
              <i className="size-[9px] rounded-full" style={{ background: l.color }} />{t(l.key, { n: l.n ?? 0 })}
            </span>
          ))}
        </div>
        <nav className={toolbarClass}>
          <ToolButton title={t("tb.reset")} icon={RotateCcw} onClick={() => ctl.resetView()} />
          <ToolButton title={t("dock.tb.zoom")} icon={Scan} onClick={() => ctl.zoomFocus()} />
          <ToolButton title={t("dock.tb.box")} icon={Box} active={s.boxOn} onClick={() => ctl.toggleBox()} />
          <ToolSep />
          <ToolButton title={t("tb.png")} icon={Camera} onClick={() => ctl.png()} />
          <ToolButton title={t("tb.fullscreen")} icon={Maximize}
            onClick={() => { if (document.fullscreenElement) document.exitFullscreen(); else wrap.current?.requestFullscreen?.(); }} />
        </nav>
      </SceneHost>
    </main>
  );
}
