import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";
const KEY = "pymol-web-theme";
const listeners = new Set<() => void>();

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch { /* storage unavailable */ }
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

let theme = initialTheme();
document.documentElement.dataset.theme = theme;

export const getTheme = () => theme;
export const subscribeTheme = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

export function setTheme(t: Theme) {
  if (t === theme) return;
  theme = t;
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
}

export const useTheme = () => useSyncExternalStore(subscribeTheme, getTheme);
