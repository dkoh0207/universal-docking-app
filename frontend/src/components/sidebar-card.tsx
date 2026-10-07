import { useState, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const cardClass = "shrink-0 gap-0 rounded-(--radius) border bg-card px-3 py-3 shadow-card ring-0";

/** Card with an uppercase heading; collapsible unless `plain`. */
export function SidebarCard({ icon: Icon, title, children, action, plain, open: initial = true, className }: {
  icon?: LucideIcon; title?: ReactNode; children?: ReactNode; action?: ReactNode; plain?: boolean; open?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(initial);
  const head = (
    <>
      {Icon && <Icon className="size-4 text-primary" />}
      <span>{title}</span>
    </>
  );
  const headClass = "flex w-full items-center gap-2 text-[12.5px] font-bold tracking-[0.06em] text-muted-foreground uppercase";
  if (plain) {
    return (
      <Card size="sm" className={cn(cardClass, "gap-3", className)}>
        {(Icon || title) && <div className={headClass}>{head}{action && <span className="ml-auto">{action}</span>}</div>}
        {children}
      </Card>
    );
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card size="sm" className={cn(cardClass, className)}>
        <CollapsibleTrigger className={cn(headClass, "cursor-pointer select-none")}>
          {head}
          <ChevronDown className={cn("ml-auto size-4 text-faint transition-transform", !open && "-rotate-90")} />
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2.5 pt-3">{children}</CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
