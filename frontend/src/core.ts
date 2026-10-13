// Framework-free singletons: the two 3Dmol scenes, their command interpreters and the viewer's UI state.
// React components render from these and call run(); nothing here imports React components.

import { Interpreter } from "./commands";
import { DockController } from "./dock/controller";
import { MdController } from "./md/controller";
import { translateError } from "./i18n";
import { fetchEntryInfo, type EntryInfo } from "./rcsb";
import { createStore } from "./lib/store";
import { getTheme, subscribeTheme } from "./lib/theme";
import type { PObject } from "./types";
import { toast } from "./ui/toast";
import { Scene, THEME_BG } from "./viewer";

/** A scene renders into a div we own; <SceneHost> moves that div into the page. */
function makeHost() {
  const el = document.createElement("div");
  el.className = "absolute inset-0";
  return el;
}

export const sceneHost = makeHost();
export const dockHost = makeHost();
export const mdHost = makeHost();
export const scene = new Scene(sceneHost);
export const dockScene = new Scene(dockHost);
export const mdScene = new Scene(mdHost);

const applyBackground = () => {
  scene.setThemeBackground(THEME_BG[getTheme()]);
  dockScene.setThemeBackground(THEME_BG[getTheme()]);
  mdScene.setThemeBackground(THEME_BG[getTheme()]);
};
applyBackground();
subscribeTheme(applyBackground);

const logError = (text: string, kind?: string) => { if (kind === "err") toast(translateError(text), "err"); };

// Every control runs a PyMOL command through the interpreter; failures show as toasts.
export const interp: Interpreter = new Interpreter(scene, {
  log: logError,
  loaded: (obj) => onLoaded(obj),
  download: (name, url) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  },
});
export const run = (cmd: string) => interp.run(cmd, false);

// the Docking page has its own scene (and interpreter, so PyMOL commands work there too)
const dockInterp = new Interpreter(dockScene, { log: logError });
export const dockRun = (cmd: string) => dockInterp.run(cmd, false);
const mdInterp = new Interpreter(mdScene, { log: logError });
export const mdRun = (cmd: string) => mdInterp.run(cmd, false);

// ---------------------------------------------------------------- viewer UI state shared across components
export type InfoState = EntryInfo | "loading" | "error";
export const viewerUi = createStore({
  current: null as PObject | null,
  info: new Map<string, InfoState>(),
  target: "all", // the selection expression that {t} in commands expands to
  measureMode: null as "distance" | "angle" | "dihedral" | null,
  picks: 0,
  busy: "" as string, // text of the busy indicator, "" when idle
});

export const appUi = createStore({ page: "viewer" as "viewer" | "dock" | "md" });

export function onLoaded(obj: PObject) {
  viewerUi.set({ current: obj });
  if (!obj.pdbId || viewerUi.get().info.has(obj.pdbId)) return;
  const id = obj.pdbId;
  const put = (v: InfoState) => viewerUi.set({ info: new Map(viewerUi.get().info).set(id, v) });
  put("loading");
  fetchEntryInfo(id).then(put, () => put("error"));
}

/** Substitute {t} with the target expression (parenthesized when needed). */
export function fill(cmd: string) {
  const t = viewerUi.get().target;
  return cmd.replace(/\{t\}/g, /\s/.test(t) ? `(${t})` : t);
}

scene.addEventListener("objects", () => {
  const cur = viewerUi.get().current;
  if (!cur || !scene.objects.includes(cur)) viewerUi.set({ current: scene.objects.at(-1) ?? null });
});

// ---------------------------------------------------------------- pages (Viewer / Docking)
export type Page = "viewer" | "dock" | "md";

export function setPage(p: Page) {
  appUi.set({ page: p });
  history.replaceState(null, "", p === "viewer" ? location.pathname + location.search : `#${p}`);
  try { localStorage.setItem("pymol-web-page", p); } catch { /* storage unavailable */ }
  requestAnimationFrame(() => {
    if (p === "dock") { dockCtl.show(); dockScene.resize(); } else dockCtl.hide();
    if (p === "md") mdCtl.show(); else mdCtl.hide();
    if (p === "viewer") scene.resize();
  });
}

export function initialPage(): Page {
  if (location.hash === "#dock") return "dock";
  if (location.hash === "#md") return "md";
  if (location.hash === "#viewer") return "viewer";
  try { const v = localStorage.getItem("pymol-web-page"); return v === "dock" || v === "md" ? v : "viewer"; } catch { return "viewer"; }
}

export const dockCtl = new DockController({
  viewer: scene, dock: dockScene, run: dockRun,
  toViewer: (obj) => onLoaded(obj), select: (obj) => { if (viewerUi.get().current !== obj) viewerUi.set({ current: obj }); }, openViewer: () => setPage("viewer"),
});

export const mdCtl = new MdController(dockCtl, mdScene, mdRun);

// one active structure: choosing a polymer in the Viewer's object list makes it the Docking receptor too
viewerUi.subscribe(() => {
  const cur = viewerUi.get().current;
  if (cur && cur.name !== dockCtl.store.get().receptor && dockCtl.store.get().receptors.includes(cur.name)) dockCtl.setReceptor(cur.name);
});

(window as unknown as { __pymol: unknown }).__pymol = { scene, dockScene, dockCtl, mdScene, mdCtl }; // debugging / headless tests
