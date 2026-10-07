// Click-to-measure and click-to-select in the Viewer scene (framework-free; the badge UI reads viewerUi).

import { run, scene, viewerUi } from "./core";
import type { PAtom } from "./types";

export type MeasureMode = "distance" | "angle" | "dihedral";
export const NEED = { distance: 2, angle: 3, dihedral: 4 } as const;
let picks: PAtom[] = [];

function clearPicks() {
  picks = [];
  for (const k of ["pk1", "pk2", "pk3", "pk4", "_picks"]) scene.selections.delete(k);
  if (scene.indicated === "_picks") scene.indicate(scene.selections.has("sele") ? "sele" : null);
  viewerUi.set({ picks: 0 });
}

/** Choosing the active mode again turns measuring off. */
export function setMeasureMode(m: MeasureMode | null) {
  const next = viewerUi.get().measureMode === m ? null : m;
  clearPicks();
  viewerUi.set({ measureMode: next });
}

scene.addEventListener("pick", async (e) => {
  const { atom, event } = (e as CustomEvent).detail as { atom: PAtom; event?: MouseEvent };
  const mode = viewerUi.get().measureMode;
  if (mode) {
    picks.push(atom);
    scene.selections.set(`pk${picks.length}`, new Set([atom]));
    scene.selections.set("_picks", new Set(picks));
    scene.indicate("_picks");
    viewerUi.set({ picks: picks.length });
    if (picks.length === NEED[mode]) {
      const name = scene.nextMeasureName(mode === "distance" ? "dist" : mode === "angle" ? "angle" : "dihe");
      const sels = picks.map((_, i) => `pk${i + 1}`).join(", ");
      await run(`${mode} ${name}, ${sels}`);
      clearPicks();
    }
    return;
  }
  scene.pickSelect(atom, event?.shiftKey);
  if (scene.selections.get("sele")?.size) viewerUi.set({ target: "sele" });
});

// Esc leaves measure mode, then clears the selection highlight
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (viewerUi.get().measureMode) setMeasureMode(null);
  else if (scene.indicated) run("deselect");
});
