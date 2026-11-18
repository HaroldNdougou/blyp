import { Platform, NativeModules } from "react-native";

type ColdStartMod = {
  notifyPayInteractive?: () => Promise<void>;
  consumeBootHandoff?: () => Promise<{
    digits?: string;
    pendingPayFcfa?: number;
  }>;
};

function mod(): ColdStartMod | null {
  if (Platform.OS !== "android") return null;
  return (NativeModules.BlypColdStart as ColdStartMod | undefined) ?? null;
}

/** Retire l’overlay Pay natif une fois la coquille JS peinte. */
export function notifyNativePayInteractive(): void {
  const m = mod();
  if (!m?.notifyPayInteractive) return;
  void m.notifyPayInteractive().catch(() => {
    /* ignore */
  });
}

export async function consumeNativeBootPayHandoff(): Promise<{
  digits: string;
  pendingPayFcfa: number;
}> {
  const m = mod();
  if (!m?.consumeBootHandoff) {
    return { digits: "", pendingPayFcfa: 0 };
  }
  try {
    const r = await m.consumeBootHandoff();
    return {
      digits: String(r?.digits ?? "").replace(/\D/g, ""),
      pendingPayFcfa: Math.max(0, Math.floor(Number(r?.pendingPayFcfa) || 0)),
    };
  } catch {
    return { digits: "", pendingPayFcfa: 0 };
  }
}

export function isNativePayColdOverlayAvailable(): boolean {
  return mod()?.notifyPayInteractive != null;
}
