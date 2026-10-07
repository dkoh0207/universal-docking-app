import { useEffect, useReducer } from "react";
import type { Scene } from "@/viewer";

/** Re-render when the scene fires any of the given events ("style" is coalesced to one frame). */
export function useScene(scene: Scene, events: string[]) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let raf = 0;
    const on = (e: Event) => {
      if (e.type !== "style") { bump(); return; }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(bump);
    };
    for (const e of events) scene.addEventListener(e, on);
    return () => {
      cancelAnimationFrame(raf);
      for (const e of events) scene.removeEventListener(e, on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, events.join()]);
}
