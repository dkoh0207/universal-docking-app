// Loading structures into the Viewer (fetch by PDB id, local files).

import { run, scene, viewerUi, onLoaded } from "./core";
import { t } from "./i18n";
import { isPdbId } from "./rcsb";
import { toast } from "./ui/toast";

export async function loadId(id: string) {
  viewerUi.set({ busy: t("busy.loading", { id: id.toUpperCase() }) });
  try {
    if (await run(`fetch ${id}`)) toast(t("loaded", { id: id.toUpperCase() }));
  } finally {
    viewerUi.set({ busy: "" });
  }
}

export function fetchFromInput(value: string): boolean {
  const id = value.trim();
  if (!isPdbId(id)) { toast(t("badId"), "err"); return false; }
  loadId(id);
  return true;
}

const FORMATS: Record<string, string> = { pdb: "pdb", ent: "pdb", cif: "cif", mmcif: "cif", sdf: "sdf", mol: "sdf", mol2: "mol2", xyz: "xyz", pqr: "pqr" };

export async function loadFile(file: File) {
  const ext = file.name.split(".").pop()!.toLowerCase();
  const fmt = FORMATS[ext];
  if (!fmt) { toast(t("unsupported", { ext }), "err"); return; }
  const name = file.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]/g, "_") || "obj";
  try {
    const obj = scene.addObject(name, await file.text(), fmt);
    onLoaded(obj);
    toast(t("loaded", { id: file.name }));
  } catch (err) {
    toast(t("readFail", { name: file.name, err: (err as Error).message }), "err");
  }
}
