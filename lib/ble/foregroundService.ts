import { NativeEventEmitter, NativeModules, Platform } from "react-native";

type ForegroundModule = {
  start: (title: string, body: string, stopLabel: string) => Promise<void>;
  stop: () => Promise<void>;
  addListener: (event: string) => void;
  removeListeners: (count: number) => void;
};

const STOP_EVENT = "BlypBleForegroundStop";

function module(): ForegroundModule | null {
  if (Platform.OS !== "android") return null;
  const mod = NativeModules.BlypBleForeground as ForegroundModule | undefined;
  if (!mod?.start) return null;
  return mod;
}

export function isBleForegroundServiceAvailable(): boolean {
  return module() != null;
}

export async function startBleBroadcastForeground(opts: {
  title: string;
  body: string;
  stopLabel: string;
}): Promise<void> {
  const mod = module();
  if (!mod) return;
  try {
    await mod.start(opts.title, opts.body, opts.stopLabel);
  } catch (e) {
    if (__DEV__) {
      console.warn("[ble] foreground start", e instanceof Error ? e.message : e);
    }
  }
}

export async function stopBleBroadcastForeground(): Promise<void> {
  const mod = module();
  if (!mod) return;
  try {
    await mod.stop();
  } catch (e) {
    if (__DEV__) {
      console.warn("[ble] foreground stop", e instanceof Error ? e.message : e);
    }
  }
}

/** Bouton « Arrêter » dans la notif système. */
export function subscribeBleForegroundStop(
  handler: () => void,
): () => void {
  const mod = module();
  if (!mod) return () => {};
  const emitter = new NativeEventEmitter(mod);
  const sub = emitter.addListener(STOP_EVENT, handler);
  return () => sub.remove();
}
