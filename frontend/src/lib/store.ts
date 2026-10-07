import { useSyncExternalStore } from "react";

/** Minimal observable store: replace-on-write state with subscribe, for state shared by several components. */
export function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T>) {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    use(): T {
      return useSyncExternalStore(this.subscribe, this.get);
    },
  };
}
