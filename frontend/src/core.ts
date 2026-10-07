// Framework-free singletons: the two 3Dmol scenes, their command interpreters and the viewer's UI state.
// React components render from these and call run(); nothing here imports React components.

import { Interpreter } from "./commands";
import { DockController } from "./dock/controller";
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
export const scene = new Scene(sceneHost);
export const dockScene = new Scene(dockHost);

const applyBackground = () => {
  scene.setThemeBackground(THEME_BG[getTheme()]);
  dockScene.setThemeBackground(THEME_BG[getTheme()]);
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

export const appUi = createStore({ page: "viewer" as "viewer" | "dock" });

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
export type Page = "viewer" | "dock";

export function setPage(p: Page) {
  appUi.set({ page: p });
  history.replaceState(null, "", p === "dock" ? "#dock" : location.pathname + location.search);
  try { localStorage.setItem("pymol-web-page", p); } catch { /* storage unavailable */ }
  requestAnimationFrame(() => {
    if (p === "dock") { dockCtl.show(); dockScene.resize(); } else { dockCtl.hide(); scene.resize(); }
  });
}

export function initialPage(): Page {
  if (location.hash === "#dock") return "dock";
  if (location.hash === "#viewer") return "viewer";
  try { return localStorage.getItem("pymol-web-page") === "dock" ? "dock" : "viewer"; } catch { return "viewer"; }
}

export const dockCtl = new DockController({
  viewer: scene, dock: dockScene, run: dockRun,
  toViewer: (obj) => onLoaded(obj), openViewer: () => setPage("viewer"),
});

(window as unknown as { __pymol: unknown }).__pymol = { scene, dockScene, dockCtl }; // debugging / headless tests
