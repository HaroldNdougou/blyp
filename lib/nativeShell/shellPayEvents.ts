import {
  NativeEventEmitter,
  NativeModules,
  Platform,
  type EmitterSubscription,
} from "react-native";

export type ShellPayCompletedPayload = {
  amountFcfa: number;
  balanceFcfa: number;
  transactionId?: string | null;
  recipientAccountId?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  paymentReceiptJson?: string | null;
};

function normalizePayload(raw: ShellPayCompletedPayload): ShellPayCompletedPayload {
  return {
    amountFcfa: Math.floor(Number(raw.amountFcfa) || 0),
    balanceFcfa: Math.floor(Number(raw.balanceFcfa) || 0),
    transactionId: raw.transactionId ?? null,
    recipientAccountId: raw.recipientAccountId ?? null,
    recipientName: raw.recipientName ?? null,
    recipientPhone: raw.recipientPhone ?? null,
    paymentReceiptJson: raw.paymentReceiptJson ?? null,
  };
}

export async function consumePendingShellPayCompleted(): Promise<ShellPayCompletedPayload | null> {
  if (Platform.OS !== "android") return null;
  const mod = NativeModules.BlypNativeShell as
    | {
        consumeShellPayCompleted?: () => Promise<ShellPayCompletedPayload | null>;
      }
    | undefined;
  if (!mod?.consumeShellPayCompleted) return null;
  try {
    const raw = await mod.consumeShellPayCompleted();
    if (!raw) return null;
    return normalizePayload(raw);
  } catch {
    return null;
  }
}

export function subscribeShellPayCompleted(
  listener: (payload: ShellPayCompletedPayload) => void,
): () => void {
  if (Platform.OS !== "android") return () => {};
  const mod = NativeModules.BlypNativeShell;
  if (!mod) return () => {};
  const sub: EmitterSubscription = new NativeEventEmitter(mod as never).addListener(
    "BlypShellPayCompleted",
    (raw: ShellPayCompletedPayload) => {
      listener(normalizePayload(raw));
    },
  );
  return () => {
    sub.remove();
  };
}
