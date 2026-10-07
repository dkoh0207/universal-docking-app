import "./styles.css";
import { Interpreter } from "./commands";
import { DockPanel } from "./dock/panel";
import { applyStatic, lang, setLang, t, translateError, type Key, type Lang } from "./i18n";
import { fetchEntryInfo, isPdbId, loadExamples, type ExampleEntry } from "./rcsb";
import type { PAtom, PObject } from "./types";
import { esc, refreshIcons } from "./ui/icons";
import { Panels } from "./ui/panels";
import { SequenceView } from "./ui/sequence";
import { toast } from "./ui/toast";
import { Scene, THEME_BG } from "./viewer";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- theme & language
type Theme = "dark" | "light";
function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem("pymol-web-theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch { /* storage unavailable */ }
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
let theme = initialTheme();
document.documentElement.dataset.theme = theme;

const markSwitch = (id: string, v: string) =>
  $(id).querySelectorAll<HTMLElement>("button").forEach((b) => b.classList.toggle("active", b.dataset.v === v));

// ---------------------------------------------------------------- core
const scene = new Scene($("viewport"));
scene.setThemeBackground(THEME_BG[theme]);

// Every control runs a PyMOL command through the interpreter; failures show as toasts.
const interp: Interpreter = new Interpreter(scene, {
  log: (text, kind) => { if (kind === "err") toast(translateError(text), "err"); },
  loaded: (obj) => onLoaded(obj),
  download: (name, url) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  },
});
const run = (cmd: string) => interp.run(cmd, false);

// the Docking page has its own scene (and interpreter, so PyMOL commands work there too)
const dockScene = new Scene($("dock-viewport"));
dockScene.setThemeBackground(THEME_BG[theme]);
const dockInterp = new Interpreter(dockScene, { log: (text, kind) => { if (kind === "err") toast(translateError(text), "err"); } });

applyStatic();
const panels = new Panels(scene, run);
new SequenceView(scene);
refreshIcons();
markSwitch("theme-switch", theme);
markSwitch("lang-switch", lang);
const dockPanel = new DockPanel({
  viewer: scene, dock: dockScene, run: (cmd) => dockInterp.run(cmd, false),
  toViewer: (obj) => onLoaded(obj), openViewer: () => setPage("viewer"),
});
refreshIcons();

// ---------------------------------------------------------------- pages (Viewer / Docking)
type Page = "viewer" | "dock";
function setPage(p: Page) {
  $("app").dataset.page = p;
  markSwitch("page-tabs", p);
  history.replaceState(null, "", p === "dock" ? "#dock" : location.pathname + location.search);
  try { localStorage.setItem("pymol-web-page", p); } catch { /* storage unavailable */ }
  requestAnimationFrame(() => {
    if (p === "dock") { dockPanel.show(); dockScene.resize(); } else { dockPanel.hide(); scene.resize(); }
  });
}
$("page-tabs").addEventListener("click", (e) => {
  const v = (e.target as HTMLElement).closest<HTMLElement>("button")?.dataset.v as Page | undefined;
  if (v && v !== $("app").dataset.page) setPage(v);
});
function initialPage(): Page {
  if (location.hash === "#dock") return "dock";
  if (location.hash === "#viewer") return "viewer";
  try { return localStorage.getItem("pymol-web-page") === "dock" ? "dock" : "viewer"; } catch { return "viewer"; }
}

$("theme-switch").addEventListener("click", (e) => {
  const v = (e.target as HTMLElement).closest<HTMLElement>("button")?.dataset.v as Theme | undefined;
  if (!v || v === theme) return;
  theme = v;
  document.documentElement.dataset.theme = theme;
  scene.setThemeBackground(THEME_BG[theme]);
  dockScene.setThemeBackground(THEME_BG[theme]);
  markSwitch("theme-switch", theme);
  try { localStorage.setItem("pymol-web-theme", theme); } catch { /* storage unavailable */ }
});
$("lang-switch").addEventListener("click", (e) => {
  const v = (e.target as HTMLElement).closest<HTMLElement>("button")?.dataset.v as Lang | undefined;
  if (!v || v === lang) return;
  setLang(v);
  markSwitch("lang-switch", v);
});

function onLoaded(obj: PObject) {
  panels.setCurrent(obj);
  if (!obj.pdbId || panels.info.has(obj.pdbId)) return;
  const id = obj.pdbId;
  panels.info.set(id, "loading");
  panels.renderInfo();
  fetchEntryInfo(id)
    .then((info) => panels.info.set(id, info))
    .catch(() => panels.info.set(id, "error"))
    .finally(() => panels.renderInfo());
}

// ---------------------------------------------------------------- empty state, busy
const syncEmpty = () => $("empty").classList.toggle("hidden", scene.objects.length > 0);
scene.addEventListener("objects", syncEmpty);
scene.addEventListener("busy", (e) => {
  if ((e as CustomEvent).detail) $("busy-text").textContent = t("busy.surface");
  $("busy").classList.toggle("show", (e as CustomEvent).detail);
});
scene.addEventListener("view", () => {
  $("spin-btn").classList.toggle("active", scene.spinning);
  $("rock-btn").classList.toggle("active", scene.rocking);
});

// ---------------------------------------------------------------- loading
async function loadId(id: string) {
  $("busy-text").textContent = t("busy.loading", { id: id.toUpperCase() });
  $("busy").classList.add("show");
  try {
    if (await run(`fetch ${id}`)) toast(t("loaded", { id: id.toUpperCase() }));
  } finally {
    $("busy").classList.remove("show");
  }
}

$("fetch-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("fetch-input");
  const id = input.value.trim();
  if (!isPdbId(id)) { toast(t("badId"), "err"); return; }
  input.value = "";
  input.blur();
  loadId(id);
});

const exBtn = $("examples-btn");
exBtn.addEventListener("click", (e) => { e.stopPropagation(); $("examples").classList.toggle("open"); });
document.addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest("#examples")) $("examples").classList.remove("open");
  if (!(e.target as HTMLElement).closest(".pop")) document.querySelectorAll(".pop.open").forEach((p) => p.classList.remove("open"));
});

let examples: ExampleEntry[] = [];
function renderExamples() {
  const ko = lang === "ko";
  const name = (x: ExampleEntry) => (ko && x.name_ko) || x.name;
  $("examples-menu").innerHTML = examples.map((x) => `
    <button class="menu-item" data-id="${x.id}">
      <span class="pdb-chip">${x.id}</span>
      <span><b>${esc(name(x))}<span class="tag">${esc((ko && x.tag_ko) || x.tag)}</span></b><small>${esc((ko && x.desc_ko) || x.desc)}</small></span>
    </button>`).join("");
  $("empty-examples").innerHTML = examples.map((x) => `<button data-id="${x.id}"><span class="pdb-chip">${x.id}</span>${esc(name(x))}</button>`).join("");
}
loadExamples().then((list) => { examples = list; renderExamples(); });
window.addEventListener("langchange", renderExamples);
for (const host of [$("examples-menu"), $("empty-examples")]) {
  host.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-id]")?.dataset.id;
    if (!id) return;
    $("examples").classList.remove("open");
    loadId(id);
  });
}

const FORMATS: Record<string, string> = { pdb: "pdb", ent: "pdb", cif: "cif", mmcif: "cif", sdf: "sdf", mol: "sdf", mol2: "mol2", xyz: "xyz", pqr: "pqr" };
async function loadFile(file: File) {
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
$<HTMLInputElement>("file-input").addEventListener("change", (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) loadFile(f);
  (e.target as HTMLInputElement).value = "";
});
const wrap = $("viewport-wrap");
wrap.addEventListener("dragover", (e) => { e.preventDefault(); wrap.classList.add("dragging"); });
wrap.addEventListener("dragleave", (e) => { if (!wrap.contains(e.relatedTarget as Node)) wrap.classList.remove("dragging"); });
wrap.addEventListener("drop", (e) => {
  e.preventDefault();
  wrap.classList.remove("dragging");
  const f = e.dataTransfer?.files?.[0];
  if (f) loadFile(f);
});

// ---------------------------------------------------------------- picking: selection & measurement
type MeasureMode = "distance" | "angle" | "dihedral" | null;
let measureMode: MeasureMode = null;
let picks: PAtom[] = [];
const NEED = { distance: 2, angle: 3, dihedral: 4 };

function setMeasureMode(m: MeasureMode) {
  measureMode = measureMode === m ? null : m;
  clearPicks();
  document.querySelectorAll<HTMLElement>("#measure-mode button").forEach((b) => b.classList.toggle("active", b.dataset.m === measureMode));
  $("measure-btn").classList.toggle("active", !!measureMode);
  updateBadge();
}
function clearPicks() {
  picks = [];
  for (const k of ["pk1", "pk2", "pk3", "pk4", "_picks"]) scene.selections.delete(k);
  if (scene.indicated === "_picks") scene.indicate(scene.selections.has("sele") ? "sele" : null);
}
function updateBadge() {
  const badge = $("mode-badge");
  if (!measureMode) { badge.classList.remove("show"); return; }
  const mode = t(measureMode as Key);
  badge.innerHTML = `${esc(t("badge", { mode, i: picks.length + 1, n: NEED[measureMode] }))} <button id="badge-x">${esc(t("done"))}</button>`;
  badge.classList.add("show");
  $("badge-x").onclick = () => setMeasureMode(null);
}
window.addEventListener("langchange", updateBadge);
$("measure-mode").addEventListener("click", (e) => {
  const m = (e.target as HTMLElement).closest<HTMLElement>("button")?.dataset.m as MeasureMode;
  if (m) setMeasureMode(m);
});
$("measure-btn").addEventListener("click", () => setMeasureMode(measureMode ? measureMode : "distance"));

scene.addEventListener("pick", async (e) => {
  const { atom, event } = (e as CustomEvent).detail as { atom: PAtom; event?: MouseEvent };
  if (measureMode) {
    picks.push(atom);
    scene.selections.set(`pk${picks.length}`, new Set([atom]));
    scene.selections.set("_picks", new Set(picks));
    scene.indicate("_picks");
    if (picks.length === NEED[measureMode]) {
      const name = scene.nextMeasureName(measureMode === "distance" ? "dist" : measureMode === "angle" ? "angle" : "dihe");
      const sels = picks.map((_, i) => `pk${i + 1}`).join(", ");
      await run(`${measureMode} ${name}, ${sels}`);
      clearPicks();
    }
    updateBadge();
    return;
  }
  scene.pickSelect(atom, event?.shiftKey);
  if (scene.selections.get("sele")?.size) panels.setTarget("sele");
});

// hover tooltip
const tip = $("tooltip");
wrap.addEventListener("mousemove", (e) => {
  const r = wrap.getBoundingClientRect();
  tip.style.left = `${e.clientX - r.left}px`;
  tip.style.top = `${e.clientY - r.top}px`;
});
wrap.addEventListener("mouseleave", () => tip.classList.remove("show"));
scene.addEventListener("hover", (e) => {
  const a = (e as CustomEvent).detail.atom as PAtom | null;
  if (!a) { tip.classList.remove("show"); return; }
  tip.innerHTML = `<b>${esc(a.resn)} ${a.resi}${esc(a.icode ?? "")}</b> · ${esc(a.atom)}<small>${esc(t("chain"))} ${esc(a.chain || "–")} · ${esc(a.obj.name)} · B ${a.b.toFixed(1)}</small>`;
  tip.classList.add("show");
});

// ---------------------------------------------------------------- toolbar extras
$("clip-btn").addEventListener("click", (e) => { e.stopPropagation(); $("clip-btn").parentElement!.classList.toggle("open"); });
$<HTMLInputElement>("clip-range").addEventListener("input", (e) => scene.clip("fraction", +(e.target as HTMLInputElement).value));
$("fullscreen-btn").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else wrap.requestFullscreen?.();
});

// Esc leaves measure mode, then clears the selection highlight
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (measureMode) setMeasureMode(null);
  else if (scene.indicated) run("deselect");
});

// keep the WebGL canvas sized to its container
new ResizeObserver(() => scene.resize()).observe(wrap);
new ResizeObserver(() => dockScene.resize()).observe($("dock-wrap"));

// ---------------------------------------------------------------- start
(window as unknown as { __pymol: unknown }).__pymol = { scene, dockScene }; // debugging / headless tests
syncEmpty();
if (initialPage() === "dock") setPage("dock");
const fromUrl = new URLSearchParams(location.search).get("pdb");
loadId(fromUrl && isPdbId(fromUrl) ? fromUrl : "1HSG");
