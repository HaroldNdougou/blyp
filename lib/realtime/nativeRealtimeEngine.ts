import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import {
  decodeWsFrame,
  encodeClientAction,
} from "@/lib/realtime/blypWsFrame";

type RealtimeMod = {
  start: (wsUrl: string, accessToken: string) => Promise<void>;
  stop: () => Promise<void>;
  sendActionJson: (json: string) => Promise<void>;
  sendFrameBase64: (b64: string) => Promise<void>;
  addListener: (event: string) => void;
  removeListeners: (count: number) => void;
};

const EVENT = "BlypRealtimePayload";

function module(): RealtimeMod | null {
  if (Platform.OS !== "android") return null;
  const mod = NativeModules.BlypRealtimeEngine as RealtimeMod | undefined;
  if (!mod?.start) return null;
  return mod;
}

export function isNativeRealtimeEngineAvailable(): boolean {
  return module() != null;
}

export async function startNativeRealtimeEngine(
  wsUrl: string,
  accessToken: string,
): Promise<void> {
  const mod = module();
  if (!mod) return;
  try {
    await mod.start(wsUrl, accessToken);
  } catch (e) {
    if (__DEV__) {
      console.warn(
        "[realtime] native start",
        e instanceof Error ? e.message : e,
      );
    }
  }
}

export async function stopNativeRealtimeEngine(): Promise<void> {
  const mod = module();
  if (!mod) return;
  try {
    await mod.stop();
  } catch {
    /* ignore */
  }
}

export async function sendNativeRealtimeAction(
  body: Record<string, unknown>,
): Promise<void> {
  const mod = module();
  if (!mod) return;
  try {
    await mod.sendActionJson(JSON.stringify(body));
  } catch {
    /* ignore */
  }
}

export async function sendNativeRealtimeRaw(frame: Uint8Array): Promise<void> {
  const mod = module();
  if (!mod?.sendFrameBase64) return;
  try {
    const b64 = uint8ToBase64(frame);
    await mod.sendFrameBase64(b64);
  } catch {
    /* ignore */
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return globalThis.btoa(binary);
}

export function subscribeNativeRealtimePayload(
  handler: (data: Record<string, unknown>) => void,
): () => void {
  const mod = module();
  if (!mod) return () => {};
  const emitter = new NativeEventEmitter(mod);
  const sub = emitter.addListener(
    EVENT,
    (payload: { json?: string }) => {
      const raw = payload?.json;
      if (!raw) return;
      try {
        const obj = JSON.parse(raw) as Record<string, unknown>;
        if (obj && typeof obj === "object") handler(obj);
      } catch {
        /* ignore */
      }
    },
  );
  return () => sub.remove();
}

/** Encode action côté JS si le module n’expose que JSON. */
export function encodeActionForNative(body: Record<string, unknown>): Uint8Array {
  return encodeClientAction(body);
}

export function decodeNativeFrame(bytes: Uint8Array): Record<string, unknown> | null {
  return decodeWsFrame(bytes);
}
