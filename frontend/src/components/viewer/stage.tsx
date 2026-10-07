import { memo, useEffect, useRef, useState } from "react";
import {
  Atom, Axis3d, Camera, Crosshair, Maximize, Move3d, Orbit, RotateCcw, Ruler, Scan, Scissors, Upload, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { SceneHost } from "@/components/scene-host";
import { PdbChip } from "@/components/viewer/sidebar";
import { ONE } from "@/commands";
import { fill, run, scene, sceneHost, viewerUi } from "@/core";
import { loadFile, loadId } from "@/actions";
import { useScene } from "@/hooks/use-scene";
import { useExamples } from "@/hooks/use-examples";
import { useT, type Key } from "@/i18n";
import { cn } from "@/lib/utils";
import { NEED, setMeasureMode } from "@/measure";
import type { PAtom } from "@/types";

export function ViewerStage() {
  return (
    <main className="flex min-h-0 min-w-0 flex-col gap-2.5">
      <SequenceBar />
      <Viewport />
    </main>
  );
}

// ---------------------------------------------------------------- sequence strip
const Residue = memo(function Residue({ rid, letter, het, num, title, sel }: { rid: number; letter: string; het: boolean; num: string; title: string; sel: boolean }) {
  return (
    <span data-rid={rid} title={title} style={het ? { width: "auto", margin: "0 3px" } : undefined}
      className="group inline-flex w-[13px] cursor-pointer flex-col items-center font-mono text-xs leading-none">
      <i className="h-3 font-sans text-[8.5px] whitespace-nowrap text-faint not-italic">{num}</i>
      <b className={cn("w-full rounded-[3px] py-1 text-center font-medium group-hover:bg-accent group-hover:text-primary",
        het && "font-bold text-ligand", sel && "bg-pick text-white group-hover:bg-pick group-hover:text-white")}>{letter}</b>
    </span>
  );
});

function SequenceBar() {
  const t = useT();
  useScene(scene, ["objects", "selections"]);
  const lastRid = useRef<number | null>(null);
  const sele = scene.selections.get("sele");
  const selRids = new Set<number>();
  if (sele) for (const a of sele) selRids.add(a.rid);

  const byRid = new Map<number, PAtom[]>();
  for (const a of scene.atoms) (byRid.get(a.rid) ?? byRid.set(a.rid, []).get(a.rid)!).push(a);
  const multi = scene.objects.length > 1;

  const groups: { obj: string; chain: string; residues: PAtom[][] }[] = [];
  for (const obj of scene.objects) {
    if (!obj.enabled) continue;
    const byChain = new Map<string, PAtom[][]>();
    const seen = new Set<number>();
    for (const a of obj.atoms) {
      if (seen.has(a.rid) || a.cls === "solvent" || a.cls === "inorganic") continue;
      seen.add(a.rid);
      (byChain.get(a.chain) ?? byChain.set(a.chain, []).get(a.chain)!).push(byRid.get(a.rid)!);
    }
    for (const [chain, residues] of byChain) groups.push({ obj: obj.name, chain, residues });
  }

  const onClick = (e: React.MouseEvent) => {
    const tag = (e.target as HTMLElement).closest<HTMLElement>("[data-chain]");
    if (tag) {
      scene.toggleInSele(scene.atoms.filter((a) => a.obj.name === tag.dataset.obj && a.chain === tag.dataset.chain));
      return;
    }
    const rid = ridOf(e.target);
    if (rid === null) return;
    let atoms = byRid.get(rid) ?? [];
    if (e.shiftKey && lastRid.current !== null) {
      const [lo, hi] = [Math.min(lastRid.current, rid), Math.max(lastRid.current, rid)];
      const first = atoms[0];
      atoms = scene.atoms.filter((a) => a.rid >= lo && a.rid <= hi && a.obj === first.obj && a.chain === first.chain && a.cls !== "solvent");
      scene.toggleInSele(atoms, true);
    } else {
      scene.toggleInSele(atoms);
    }
    lastRid.current = rid;
  };

  return (
    <div onClick={onClick}
      onDoubleClick={(e) => { const rid = ridOf(e.target); if (rid !== null) scene.zoom(scene.mask((a) => a.rid === rid)); }}
      className="min-h-14 overflow-x-auto overflow-y-hidden rounded-(--radius) border bg-card px-2.5 py-2 whitespace-nowrap shadow-card select-none">
      {!groups.length && <div className="pl-1 text-xs leading-[38px] text-faint">{t("seq.empty")}</div>}
      {groups.map(({ obj, chain, residues }) => (
        <span key={`${obj}|${chain}`} className="mr-3.5 inline-flex items-end align-top">
          <span data-obj={obj} data-chain={chain}
            className="mr-1.5 cursor-pointer self-center rounded-md bg-chip px-[7px] py-[3px] text-[11px] font-bold text-chip-foreground hover:bg-primary hover:text-primary-foreground">
            {multi ? `${obj} · ` : ""}{chain || "–"}
          </span>
          {residues.map((atoms, i) => {
            const a = atoms[0], het = a.cls === "organic";
            return <Residue key={a.rid} rid={a.rid} het={het} sel={selRids.has(a.rid)} letter={het ? a.resn : ONE[a.resn.toUpperCase()] ?? "X"}
              num={a.resi % 10 === 0 || i === 0 ? String(a.resi) : ""} title={`${a.resn} ${a.resi}${a.icode ?? ""} · ${t("chain")} ${chain}`} />;
          })}
        </span>
      ))}
    </div>
  );
}
const ridOf = (t: EventTarget | null) => {
  const r = (t as HTMLElement | null)?.closest<HTMLElement>("[data-rid]");
  return r ? +r.dataset.rid! : null;
};

// ---------------------------------------------------------------- viewport and overlays
function Viewport() {
  const t = useT();
  const wrap = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [tip, setTip] = useState<{ atom: PAtom; x: number; y: number } | null>(null);
  const mouse = useRef({ x: 0, y: 0 });
  useScene(scene, ["objects"]);

  useEffect(() => {
    const onHover = (e: Event) => {
      const atom = (e as CustomEvent).detail.atom as PAtom | null;
      setTip(atom ? { atom, ...mouse.current } : null);
    };
    const onBusy = (e: Event) => viewerUi.set({ busy: (e as CustomEvent).detail ? t("busy.surface") : "" });
    scene.addEventListener("hover", onHover);
    scene.addEventListener("busy", onBusy);
    return () => { scene.removeEventListener("hover", onHover); scene.removeEventListener("busy", onBusy); };
  }, [t]);

  return (
    <SceneHost scene={scene} host={sceneHost} wrapRef={wrap}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) loadFile(f); }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top };
        setTip((p) => (p ? { ...p, ...mouse.current } : p));
      }}
      onMouseLeave={() => setTip(null)}>
      <div className={cn("pointer-events-none absolute inset-3 z-[6] flex items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-primary bg-glass font-semibold text-primary opacity-0 backdrop-blur-md transition-opacity", dragging && "opacity-100")}>
        <Upload className="size-4" />{t("drop")}
      </div>
      <Empty />
      <MeasureBadge />
      <Busy />
      {tip && (
        <div className="pointer-events-none absolute z-[7] translate-x-3.5 translate-y-3.5 rounded-[9px] bg-foreground/90 px-[9px] py-1.5 text-xs whitespace-nowrap text-background shadow-lg" style={{ left: tip.x, top: tip.y }}>
          <b className="font-semibold text-sky">{tip.atom.resn} {tip.atom.resi}{tip.atom.icode ?? ""}</b> · {tip.atom.atom}
          <small className="ml-1.5 opacity-60">{t("chain")} {tip.atom.chain || "–"} · {tip.atom.obj.name} · B {tip.atom.b.toFixed(1)}</small>
        </div>
      )}
      <Toolbar wrap={wrap} />
    </SceneHost>
  );
}

function Empty() {
  const t = useT();
  const examples = useExamples();
  if (scene.objects.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[4] flex flex-col items-center justify-center gap-1.5 p-5 text-center">
      <Atom className="mb-1.5 size-11 stroke-[1.5] text-primary" />
      <h2 className="m-0 text-xl tracking-tight">{t("empty.title")}</h2>
      <p className="mb-3 text-muted-foreground">{t("empty.text")}</p>
      <div className="pointer-events-auto flex max-w-[560px] flex-wrap justify-center gap-2">
        {examples.map((x) => (
          <button key={x.id} onClick={() => loadId(x.id)}
            className="inline-flex items-center gap-2 rounded-[11px] border bg-glass py-[7px] pr-3 pl-[7px] text-[12.5px] font-semibold backdrop-blur-md hover:border-primary hover:text-primary">
            <PdbChip className="h-[26px] px-[7px] text-[11px]">{x.id}</PdbChip>{x.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function MeasureBadge() {
  const t = useT();
  const { measureMode, picks } = viewerUi.use();
  if (!measureMode) return null;
  return (
    <div className="absolute top-3 left-3 z-[5] flex items-center gap-2 rounded-[10px] bg-primary py-[7px] pr-2 pl-3 text-[12.5px] font-semibold text-primary-foreground shadow-lg">
      {t("badge", { mode: t(measureMode as Key), i: picks + 1, n: NEED[measureMode] })}
      <button className="h-6 rounded-[7px] bg-white/20 px-2 text-xs font-semibold" onClick={() => setMeasureMode(null)}>{t("done")}</button>
    </div>
  );
}

function Busy() {
  const { busy } = viewerUi.use();
  if (!busy) return null;
  return (
    <div className="absolute top-3 right-3 z-[5] flex items-center gap-2 rounded-[10px] border bg-glass px-3 py-[7px] text-xs font-semibold backdrop-blur-md">
      <span className="size-3.5 animate-spin rounded-full border-2 border-primary-soft border-t-primary" />{busy}
    </div>
  );
}

// ---------------------------------------------------------------- toolbar
export function ToolButton({ title, icon: Icon, onClick, active }: { title: string; icon: LucideIcon; onClick?: () => void; active?: boolean }) {
  return (
    <Button variant="ghost" size="icon-lg" title={title} onClick={onClick}
      className={cn("size-[34px] rounded-[9px] text-muted-foreground hover:bg-accent hover:text-primary", active && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground")}>
      <Icon className="size-[17px]" />
    </Button>
  );
}
export const ToolSep = () => <span className="mx-1 h-5 w-px bg-border" />;
export const toolbarClass = "absolute bottom-3.5 left-1/2 z-[5] flex -translate-x-1/2 items-center gap-0.5 rounded-[14px] border bg-glass p-[5px] shadow-card backdrop-blur-xl";

function Toolbar({ wrap }: { wrap: React.RefObject<HTMLDivElement | null> }) {
  const t = useT();
  const { measureMode } = viewerUi.use();
  useScene(scene, ["view"]);
  const [clip, setClip] = useState(0);
  const cmd = (c: string) => () => run(fill(c));
  return (
    <nav className={toolbarClass}>
      <ToolButton title={t("tb.reset")} icon={RotateCcw} onClick={cmd("reset")} />
      <ToolButton title={t("tb.orient")} icon={Axis3d} onClick={cmd("orient {t}")} />
      <ToolButton title={t("tb.zoom")} icon={Scan} onClick={cmd("zoom {t}")} />
      <ToolButton title={t("tb.center")} icon={Crosshair} onClick={cmd("center {t}")} />
      <ToolSep />
      <ToolButton title={t("tb.spin")} icon={Orbit} active={scene.spinning} onClick={cmd("spin")} />
      <ToolButton title={t("tb.rock")} icon={Move3d} active={scene.rocking} onClick={cmd("rock")} />
      <Popover>
        <PopoverTrigger asChild><span><ToolButton title={t("tb.clip")} icon={Scissors} /></span></PopoverTrigger>
        <PopoverContent side="top" sideOffset={10} className="w-[200px] gap-2 p-3">
          <span className="text-xs text-muted-foreground">{t("tb.frontClip")}</span>
          <Slider min={0} max={0.98} step={0.02} value={[clip]} onValueChange={([v]) => { setClip(v); scene.clip("fraction", v); }} />
        </PopoverContent>
      </Popover>
      <ToolSep />
      <ToolButton title={t("tb.measure")} icon={Ruler} active={!!measureMode} onClick={() => setMeasureMode(measureMode ?? "distance")} />
      <ToolButton title={t("tb.png")} icon={Camera} onClick={cmd("png")} />
      <ToolButton title={t("tb.fullscreen")} icon={Maximize}
        onClick={() => { if (document.fullscreenElement) document.exitFullscreen(); else wrap.current?.requestFullscreen?.(); }} />
    </nav>
  );
}
