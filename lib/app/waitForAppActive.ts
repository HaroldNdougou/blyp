import { AppState, type AppStateStatus } from "react-native";

/** Attend le 1er plan (obligatoire pour biométrie après tap notif). */
export function waitForAppActive(timeoutMs = 8000): Promise<boolean> {
  if (AppState.currentState === "active") {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve(true));
      });
    });
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sub.remove();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => finish(true));
        });
      }
    });
  });
}
