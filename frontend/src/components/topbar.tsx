import { useRef, useState } from "react";
import { Activity, Anchor, Atom, ChevronDown, FlaskConical, Languages, Moon, Search, Sun, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PdbChip } from "@/components/viewer/sidebar";
import { fetchFromInput, loadFile, loadId } from "@/actions";
import { appUi, setPage, type Page } from "@/core";
import { useExamples } from "@/hooks/use-examples";
import { setLang, useT, lang, type Lang } from "@/i18n";
import { setTheme, useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const switchClass = "gap-[3px] rounded-[10px] border bg-card p-[3px] shadow-card";
const switchItem = "h-7 flex-none gap-1.5 rounded-[7px] px-2.5 text-xs font-semibold whitespace-nowrap text-muted-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground";

export function TopBar() {
  const t = useT();
  const { page } = appUi.use();
  const theme = useTheme();
  const [id, setId] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const examples = useExamples();
  return (
    <header className="col-span-2 flex min-w-0 items-center gap-2.5 px-1">
      <div className="mr-2.5 flex items-center gap-2.5">
        <img src="/favicon.svg" alt="" className="size-8 rounded-[9px] shadow-[0_4px_14px_rgba(37,99,235,0.35)]" />
        <div className="flex flex-col leading-[1.15]">
          <strong className="text-[15px] font-bold tracking-tight">PyMOL Web</strong>
          <span className="text-[11.5px] text-muted-foreground">{t("brand.sub")}</span>
        </div>
      </div>

      <Tabs value={page} onValueChange={(v) => setPage(v as Page)} className="flex-none">
        <TabsList className={cn(switchClass, "h-auto")}>
          <TabsTrigger value="viewer" className="h-7 px-3 text-[12.5px] font-semibold data-active:bg-primary data-active:text-primary-foreground"><Atom />{t("tab.viewer")}</TabsTrigger>
          <TabsTrigger value="dock" className="h-7 px-3 text-[12.5px] font-semibold data-active:bg-primary data-active:text-primary-foreground"><Anchor />{t("tab.dock")}</TabsTrigger>
          <TabsTrigger value="md" className="h-7 px-3 text-[12.5px] font-semibold data-active:bg-primary data-active:text-primary-foreground"><Activity />{t("tab.md")}</TabsTrigger>
        </TabsList>
      </Tabs>

      <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (fetchFromInput(id)) setId(""); }}
        className="flex w-[300px] max-w-[40vw] items-center gap-2 rounded-xl border bg-card py-1 pr-1 pl-3 shadow-card focus-within:border-primary focus-within:ring-3 focus-within:ring-primary-soft">
        <Search className="size-4 text-faint" />
        <Input value={id} onChange={(e) => setId(e.target.value)} maxLength={4} spellCheck={false} placeholder={t("fetch.placeholder")}
          className="h-7 border-0 bg-transparent px-0 font-semibold tracking-[0.04em] uppercase shadow-none placeholder:font-normal placeholder:tracking-normal placeholder:normal-case focus-visible:ring-0 dark:bg-transparent" />
        <Button type="submit" size="sm" className="h-[30px] rounded-lg px-3 text-[13px] font-semibold">{t("fetch.btn")}</Button>
      </form>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-9 gap-[7px] rounded-[10px] bg-card px-3 font-semibold shadow-card"><FlaskConical />{t("examples")}<ChevronDown className="size-3.5 opacity-60" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80 rounded-(--radius) p-1.5">
          {examples.map((x) => (
            <DropdownMenuItem key={x.id} onSelect={() => loadId(x.id)} className="grid grid-cols-[52px_1fr] items-center gap-2.5 rounded-[10px] p-2">
              <PdbChip>{x.id}</PdbChip>
              <span>
                <b className="block font-semibold">{x.name}<span className="ml-1.5 inline-block rounded-full bg-chip px-[7px] py-px align-[1px] text-[10.5px] font-semibold text-chip-foreground">{x.tag}</span></b>
                <small className="text-xs text-muted-foreground">{x.desc}</small>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="outline" title={t("upload.title")} className="h-9 gap-[7px] rounded-[10px] bg-card px-3 font-semibold shadow-card" onClick={() => file.current?.click()}>
        <Upload />{t("upload")}
      </Button>
      <input ref={file} type="file" hidden accept=".pdb,.ent,.cif,.mmcif,.sdf,.mol,.mol2,.xyz,.pqr"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ""; }} />

      <div className="flex-1" />

      <ToggleGroup type="single" value={theme} spacing={1} className={switchClass} onValueChange={(v) => v && setTheme(v as Theme)}>
        <ToggleGroupItem value="light" className={switchItem}><Sun />{t("theme.light")}</ToggleGroupItem>
        <ToggleGroupItem value="dark" className={switchItem}><Moon />{t("theme.dark")}</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup type="single" value={lang} spacing={1} className={switchClass} onValueChange={(v) => v && setLang(v as Lang)}>
        <ToggleGroupItem value="en" className={switchItem}><Languages />EN</ToggleGroupItem>
        <ToggleGroupItem value="ko" className={switchItem}>한국어</ToggleGroupItem>
      </ToggleGroup>
    </header>
  );
}
