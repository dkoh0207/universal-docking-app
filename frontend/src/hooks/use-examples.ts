import { useEffect, useState } from "react";
import { lang } from "@/i18n";
import { loadExamples, type ExampleEntry } from "@/rcsb";

export interface Example { id: string; name: string; desc: string; tag: string }

/** Bundled example structures, localized to the current language (call useT() in the component to refresh). */
export function useExamples(): Example[] {
  const [list, setList] = useState<ExampleEntry[]>([]);
  useEffect(() => { loadExamples().then(setList, () => undefined); }, []);
  const ko = lang === "ko";
  return list.map((x) => ({ id: x.id, name: (ko && x.name_ko) || x.name, desc: (ko && x.desc_ko) || x.desc, tag: (ko && x.tag_ko) || x.tag }));
}
