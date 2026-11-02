/**
 * Vérification locale du PIN (UX « mauvais PIN » sans réseau).
 * S’appuie sur le coffre SecureStore déjà présent — pas de module natif extra.
 * Import dynamique depuis Pay uniquement (hors cold start).
 */
import { Platform } from "react-native";

export type LocalTransactionPinVerifyResult = "ok" | "wrong" | "unknown";

function normalizePin(pin: string): string {
  return String(pin).replace(/\D/g, "");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Compare la saisie au PIN du coffre ; `unknown` si coffre non configuré. */
export async function verifyLocalTransactionPin(
  pin: string,
): Promise<LocalTransactionPinVerifyResult> {
  if (Platform.OS === "web") return "unknown";
  const normalized = normalizePin(pin);
  if (normalized.length !== 4) return "wrong";
  const { hasTransactionPinVault, readTransactionPinForNativeQuickPay } =
    await import("@/lib/security/transactionPinVault");
  if (!(await hasTransactionPinVault())) return "unknown";
  const stored = await readTransactionPinForNativeQuickPay();
  if (!stored) return "unknown";
  return timingSafeEqual(normalized, stored) ? "ok" : "wrong";
}
