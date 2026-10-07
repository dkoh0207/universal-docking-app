import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/** Single-choice button strip. Clicking the active item calls onChange with it again (callers may treat that as "off"). */
export function Segmented({ value, onChange, items, className, itemClass }: {
  value: string;
  onChange: (v: string) => void;
  items: { value: string; label?: ReactNode; icon?: LucideIcon; title?: string }[];
  className?: string;
  itemClass?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => onChange(v || value)}
      spacing={1}
      className={cn("w-full gap-[3px] rounded-[10px] border bg-secondary p-[3px]", className)}
    >
      {items.map(({ value: v, label, icon: Icon, title }) => (
        <ToggleGroupItem
          key={v}
          value={v}
          title={title}
          className={cn(
            "h-7 flex-1 gap-1.5 rounded-[7px] px-2 text-xs font-semibold text-muted-foreground",
            "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground",
            itemClass,
          )}
        >
          {Icon && <Icon className="size-3.5" />}
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Slider with a label and a value readout. */
export function SliderRow({ label, value, min, max, step, onChange, onCommit, output, disabled, title }: {
  label: ReactNode; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; onCommit?: (v: number) => void; output: ReactNode; disabled?: boolean; title?: string;
}) {
  return (
    <div className={cn("grid grid-cols-[1fr_auto] items-center gap-x-2.5 gap-y-2 text-xs text-muted-foreground", disabled && "pointer-events-none opacity-45")} title={title}>
      <span>{label}</span>
      <output className="text-[11.5px] font-semibold text-foreground tabular-nums">{output}</output>
      <Slider className="col-span-2" min={min} max={max} step={step} value={[value]} disabled={disabled}
        onValueChange={([v]) => onChange(v)} onValueCommit={([v]) => onCommit?.(v)} />
    </div>
  );
}

export function SwitchRow({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Label className={cn("cursor-pointer gap-2.5 text-[12.5px] font-normal", disabled && "pointer-events-none opacity-45")}>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
      {label}
    </Label>
  );
}

/** Label on the left, control on the right (parameter forms). */
export function Field({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Label className={cn("grid grid-cols-[112px_1fr] items-center gap-2 text-[12.5px] font-normal text-muted-foreground", className)}>
      <span>{label}</span>
      {children}
    </Label>
  );
}

export const Hint = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <div className={cn("text-[11.5px] leading-snug text-faint", className)}>{children}</div>
);

export const Placeholder = ({ children }: { children: ReactNode }) => <div className="px-0.5 py-1 text-xs text-faint">{children}</div>;

/** Small uppercase-free caption above a control. */
export const FieldLabel = ({ children, icon: Icon, className }: { children: ReactNode; icon?: LucideIcon; className?: string }) => (
  <div className={cn("flex items-center gap-1.5 text-xs font-semibold text-muted-foreground", className)}>
    {Icon && <Icon className="size-3.5 text-primary" />}
    {children}
  </div>
);
