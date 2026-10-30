import { NativeEventEmitter, NativeModules, Platform } from "react-native";

type QuickPayMod = {
  start: (
    title: string,
    body: string,
    l50: string,
    l100: string,
    l200: string,
    l500: string,
  ) => Promise<void>;
  stop: () => Promise<void>;
  clearHighlight?: () => Promise<void>;
  consumePendingQuickPay?: () => Promise<number>;
  syncRuntimeSecrets?: (
    apiBaseUrl: string,
    accessToken: string,
    recipientJson: string,
    transactionPin: string,
    balanceFcfa: number,
    phoneDigits: string,
  ) => Promise<void>;
  clearRuntimeSecrets?: () => Promise<void>;
  addListener: (event: string) => void;
  removeListeners: (count: number) => void;
};

const EVENT = "BlypQuickPayRequested";

function module(): QuickPayMod | null {
  if (Platform.OS !== "android") return null;
  const mod = NativeModules.BlypQuickPayNotif as QuickPayMod | undefined;
  if (!mod?.start) return null;
  return mod;
}

export function isQuickPayNotifNativeAvailable(): boolean {
  return module() != null;
}

export async function startQuickPayNotifNative(opts: {
  title: string;
  body: string;
  l50: string;
  l100: string;
  l200: string;
  l500: string;
}): Promise<void> {
  const mod = module();
  if (!mod) return;
  try {
    await mod.start(
      opts.title,
      opts.body,
      opts.l50,
      opts.l100,
      opts.l200,
      opts.l500,
    );
  } catch (e) {
    if (__DEV__) {
      console.warn(
        "[quickPay] notif start",
        e instanceof Error ? e.message : e,
      );
    }
  }
}

export async function stopQuickPayNotifNative(): Promise<void> {
  const mod = module();
  if (!mod) return;
  try {
    await mod.stop();
  } catch {
    /* ignore */
  }
}

/** Remet les puces de la notif persistante à l’état neutre. */
export async function clearQuickPayNotifHighlight(): Promise<void> {
  const mod = module();
  if (!mod?.clearHighlight) return;
  try {
    await mod.clearHighlight();
  } catch {
    /* ignore */
  }
}

/** Récupère un montant tapé en notif pendant que React n’était pas prêt. */
export async function consumePendingQuickPayNative(): Promise<number> {
  const mod = module();
  if (!mod?.consumePendingQuickPay) return 0;
  try {
    const n = Math.floor(Number(await mod.consumePendingQuickPay()) || 0);
    return n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export async function syncQuickPayNotifNativeSecrets(opts: {
  apiBaseUrl: string;
  accessToken: string;
  recipientJson: string;
  transactionPin: string;
  balanceFcfa: number;
  phoneDigits: string;
}): Promise<void> {
  const mod = module();
  if (!mod?.syncRuntimeSecrets) return;
  try {
    await mod.syncRuntimeSecrets(
      opts.apiBaseUrl,
      opts.accessToken,
      opts.recipientJson,
      opts.transactionPin,
      opts.balanceFcfa,
      opts.phoneDigits,
    );
  } catch (e) {
    if (__DEV__) {
      console.warn(
        "[quickPay] syncRuntimeSecrets",
        e instanceof Error ? e.message : e,
      );
    }
  }
}

export async function clearQuickPayNotifNativeSecrets(): Promise<void> {
  const mod = module();
  if (!mod?.clearRuntimeSecrets) return;
  try {
    await mod.clearRuntimeSecrets();
  } catch {
    /* ignore */
  }
}

const EVENT_COMPLETED = "BlypQuickPayCompleted";

export function subscribeQuickPayCompleted(
  handler: (payload: {
    amountFcfa: number;
    balanceFcfa: number;
    transactionId: string | null;
  }) => void,
): () => void {
  const mod = module();
  if (!mod) return () => {};
  const emitter = new NativeEventEmitter(mod);
  const sub = emitter.addListener(
    EVENT_COMPLETED,
    (payload: {
      amountFcfa?: number;
      balanceFcfa?: number;
      transactionId?: string | null;
    }) => {
      handler({
        amountFcfa: Math.floor(Number(payload?.amountFcfa) || 0),
        balanceFcfa: Math.floor(Number(payload?.balanceFcfa) || 0),
        transactionId: payload?.transactionId ?? null,
      });
    },
  );
  return () => sub.remove();
}

export function subscribeQuickPayRequested(
  handler: (amountFcfa: number) => void,
): () => void {
  const mod = module();
  if (!mod) return () => {};
  const emitter = new NativeEventEmitter(mod);
  const sub = emitter.addListener(
    EVENT,
    (payload: { amountFcfa?: number }) => {
      const n = Math.floor(Number(payload?.amountFcfa) || 0);
      if (n > 0) handler(n);
    },
  );
  return () => sub.remove();
}
