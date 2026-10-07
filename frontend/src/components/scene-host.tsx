import { useEffect, useRef, type ComponentProps, type RefObject } from "react";
import type { Scene } from "@/viewer";
import { cn } from "@/lib/utils";

/** Frame that adopts a Scene's canvas div (created outside React) and keeps the WebGL size in sync. */
export function SceneHost({ scene, host, wrapRef, className, children, ...rest }: { scene: Scene; host: HTMLElement; wrapRef?: RefObject<HTMLDivElement | null> } & ComponentProps<"div">) {
  const own = useRef<HTMLDivElement>(null);
  const ref = wrapRef ?? own;
  useEffect(() => {
    const el = ref.current!;
    el.prepend(host);
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [scene, host, ref]);
  return (
    <div
      ref={ref}
      className={cn("relative min-h-60 flex-1 overflow-hidden rounded-(--radius) border bg-card shadow-card", className)}
      {...rest}
    >
      {children}
    </div>
  );
}
