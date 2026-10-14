import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { DockSidebar, DockStage } from "@/components/dock/page";
import { MdSidebar, MdStage } from "@/components/md/page";
import { TopBar } from "@/components/topbar";
import { ViewerSidebar } from "@/components/viewer/sidebar";
import { ViewerStage } from "@/components/viewer/stage";
import { appUi } from "@/core";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/** Both pages stay mounted (the inactive one is display:none) so their WebGL scenes keep their state. */
export function App() {
  useT();
  const { page } = appUi.use();
  const pane = (p: string) => cn("contents", page !== p && "hidden");
  return (
    <TooltipProvider>
      <div className="grid h-dvh min-w-[1024px] grid-cols-[320px_minmax(0,1fr)] grid-rows-[58px_minmax(0,1fr)] gap-2.5 px-2.5 pb-2.5">
        <TopBar />
        <div className={pane("viewer")}><ViewerSidebar /><ViewerStage /></div>
        <div className={pane("dock")}><DockSidebar /><DockStage /></div>
        <div className={pane("md")}><MdSidebar /><MdStage /></div>
      </div>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
