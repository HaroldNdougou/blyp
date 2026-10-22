import { InteractionManager } from "react-native";

/** Travail lourd (SQLite, sync, parse) — après transition / 1er paint. */
export function runAfterPaint(task: () => void): { cancel: () => void } {
  return InteractionManager.runAfterInteractions(task);
}

export function runAfterPaintAsync<T>(task: () => Promise<T>): {
  cancel: () => void;
} {
  let cancelled = false;
  const handle = InteractionManager.runAfterInteractions(() => {
    if (cancelled) return;
    void task();
  });
  return {
    cancel: () => {
      cancelled = true;
      handle.cancel?.();
    },
  };
}
