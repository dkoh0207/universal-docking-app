import { useEffect, useRef, type ReactNode } from "react";
import { C, interactionColor } from "@/md/palette";
import { cn } from "@/lib/utils";

const W = 360, H = 150, PL = 38, PR = 8, PT = 8, PB = 22;


export interface Series { label?: string; y: number[]; color: string }

const nice = (lo: number, hi: number) => {
  if (!(hi > lo)) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad] as const;
};
const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

export function ChartCard({ title, children, className, legend }: { title: ReactNode; children: ReactNode; className?: string; legend?: { label: string; color: string }[] }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-(--radius) border bg-card p-3 shadow-card", className)}>
      <div className="flex flex-wrap items-center gap-x-3 text-xs font-semibold text-muted-foreground">
        <span>{title}</span>
        {legend?.map((l) => <span key={l.label} className="inline-flex items-center gap-1.5 font-medium"><i className="size-2 rounded-full" style={{ background: l.color }} />{l.label}</span>)}
      </div>
      {children}
    </div>
  );
}

/** Line chart with axes; `x` shared by all series. `ref` draws a dashed horizontal reference line. */
export function LineChart({ x, series, xLabel, refLine, step }: { x: number[]; series: Series[]; xLabel?: string; refLine?: number; step?: boolean }) {
  const ys = series.flatMap((s) => s.y).concat(refLine !== undefined ? [refLine] : []).filter(Number.isFinite);
  if (!x.length || !ys.length) return <div className="h-[150px]" />;
  const [lo, hi] = nice(Math.min(...ys), Math.max(...ys));
  const x0 = x[0], x1 = x[x.length - 1] || x0 + 1;
  const sx = (v: number) => PL + ((v - x0) / (x1 - x0 || 1)) * (W - PL - PR);
  const sy = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
  const yt = [lo + (hi - lo) * 0.08, (lo + hi) / 2, hi - (hi - lo) * 0.08];
  const xt = [x0, (x0 + x1) / 2, x1];
  const path = (y: number[]) => y.map((v, i) => `${i ? "L" : "M"}${sx(x[i]).toFixed(1)},${sy(v).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {yt.map((v) => <g key={v}><line x1={PL} x2={W - PR} y1={sy(v)} y2={sy(v)} className="stroke-border" strokeWidth={0.6} /><text x={PL - 4} y={sy(v) + 3} textAnchor="end" className="fill-faint text-[9px]">{fmt(v)}</text></g>)}
      {xt.map((v, i) => <text key={i} x={sx(v)} y={H - 8} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} className="fill-faint text-[9px]">{fmt(v)}</text>)}
      {xLabel && <text x={W - PR} y={H - 0.5} textAnchor="end" className="fill-faint text-[8px]">{xLabel}</text>}
      {refLine !== undefined && <line x1={PL} x2={W - PR} y1={sy(refLine)} y2={sy(refLine)} className="stroke-muted-foreground" strokeDasharray="4 3" strokeWidth={0.8} />}
      {series.map((s, i) => <path key={i} d={path(s.y)} fill="none" stroke={s.color} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap={step ? "butt" : "round"} />)}
    </svg>
  );
}

/** Bar chart for per-residue values. */
export function BarChart({ labels, values, color }: { labels: string[]; values: number[]; color: string }) {
  if (!values.length) return <div className="h-[150px]" />;
  const hi = Math.max(...values) * 1.08 || 1;
  const bw = (W - PL - PR) / values.length;
  const sy = (v: number) => PT + (1 - v / hi) * (H - PT - PB);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {[0, hi / 2].map((v) => <g key={v}><line x1={PL} x2={W - PR} y1={sy(v)} y2={sy(v)} className="stroke-border" strokeWidth={0.6} /><text x={PL - 4} y={sy(v) + 3} textAnchor="end" className="fill-faint text-[9px]">{fmt(v)}</text></g>)}
      {values.map((v, i) => <rect key={i} x={PL + i * bw} y={sy(v)} width={Math.max(bw - 0.3, 0.4)} height={H - PB - sy(v)} fill={color}><title>{labels[i]}: {v.toFixed(2)}</title></rect>)}
      <text x={PL} y={H - 8} className="fill-faint text-[9px]">{labels[0]}</text>
      <text x={W - PR} y={H - 8} textAnchor="end" className="fill-faint text-[9px]">{labels[labels.length - 1]}</text>
    </svg>
  );
}


/** Residue x frame interaction map (canvas): one row per (residue, interaction type), a coloured cell where present. */
export function Heatmap({ rows, frames, selected, onSelect }: {
  rows: { label: string; type: string; present: number[]; occupancy: number }[]; frames: number; selected: string | null; onSelect: (r: string) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rowH = 16, labelW = 150, occW = 44;
  const height = Math.max(rows.length * rowH + 4, 40);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const w = c.clientWidth, dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = height * dpr;
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    const css = getComputedStyle(c);
    const fg = css.getPropertyValue("--muted-foreground") || C.slate, bg = css.getPropertyValue("--secondary") || C.light;
    g.clearRect(0, 0, w, height);
    g.font = "11px ui-sans-serif, system-ui";
    g.textBaseline = "middle";
    const gw = w - labelW - occW - 6, cw = gw / Math.max(frames, 1);
    rows.forEach((r, i) => {
      const y = i * rowH + 2;
      g.fillStyle = bg;
      g.fillRect(labelW, y, gw, rowH - 3);
      g.fillStyle = interactionColor(r.type);
      r.present.forEach((p, f) => { if (p) g.fillRect(labelW + f * cw, y, Math.ceil(cw), rowH - 3); });
      g.fillStyle = fg;
      g.textAlign = "left";
      g.font = r.label === selected ? "600 11px ui-sans-serif, system-ui" : "11px ui-sans-serif, system-ui";
      g.fillText(`${r.label} · ${r.type}`, 2, y + rowH / 2 - 1);
      g.textAlign = "right";
      g.fillText(`${Math.round(r.occupancy * 100)}%`, w - 2, y + rowH / 2 - 1);
    });
  }, [rows, frames, selected, height]);
  return (
    <canvas ref={ref} style={{ height }} className="w-full cursor-pointer"
      onClick={(e) => { const i = Math.floor((e.nativeEvent.offsetY - 2) / rowH); if (rows[i]) onSelect(rows[i].label); }} />
  );
}
