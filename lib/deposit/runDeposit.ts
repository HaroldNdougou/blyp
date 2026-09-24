/**
 * Rechargement wallet — initiation rapide + poll en fond.
 *
 * Ne bloque plus l’UI jusqu’au webhook : après ACCEPTED PawaPay, le pad
 * redevient libre ; le crédit est confirmé par poll léger (Dynamo d’abord).
 */
import { ApiError } from "@/lib/api/errors";

/**
 * Gaps entre polls (ms). Checks pairs = Dynamo seul (rapide) ;
 * impairs = sync PawaPay (rattrapage si webhook lent).
 */
const POLL_GAPS_MS = [
  200, 300, 400, 500, 700, 900, 1200, 1500, 2000, 2000, 2500, 2500, 2500,
  2500, 2500, 2500, 2500, 2500, 2500, 2500, 2500, 2500, 2500, 2500,
] as const;

export function newDepositIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return `idemp-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export type DepositInitResult =
  | { status: "completed"; balanceFcfa?: number }
  | { status: "pending_provider"; depositIntentId: string };

/** POST dépôt uniquement — retourne dès que MoMo est initié (ou sync completed). */
export async function initiateWalletDeposit(
  token: string,
  amountFcfa: number,
  idempotencyKey: string,
): Promise<DepositInitResult> {
  const { deposit: apiDeposit } = await import("@/lib/api/client");
  const res = await apiDeposit(token, amountFcfa, idempotencyKey);
  if (res.status === "completed") {
    return { status: "completed", balanceFcfa: res.balanceFcfa };
  }
  if (res.depositIntentId) {
    return {
      status: "pending_provider",
      depositIntentId: res.depositIntentId,
    };
  }
  throw new ApiError("Réponse dépôt inattendue.", 502);
}

/**
 * Attend completed / failed. `syncRemote` alterne pour limiter les appels PawaPay.
 */
export async function waitDepositCompleted(
  token: string,
  depositIntentId: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const { getDepositIntentStatus } = await import("@/lib/api/client");
  const signal = opts?.signal;

  for (let i = 0; i <= POLL_GAPS_MS.length; i++) {
    if (signal?.aborted) {
      throw new ApiError("Rechargement annulé.", 499);
    }
    /** Dynamo-only d’abord ; sync PawaPay tous les 2 checks après le 2e. */
    const syncRemote = i >= 2 && i % 2 === 0;
    const s = await getDepositIntentStatus(token, depositIntentId, {
      syncRemote,
    });
    if (s.status === "completed") return;
    if (s.status === "failed") {
      throw new ApiError(
        s.failureReason?.trim() || "Rechargement échoué ou annulé.",
        409,
      );
    }
    if (i >= POLL_GAPS_MS.length) break;
    await sleep(POLL_GAPS_MS[i]);
  }
  throw new ApiError(
    "Délai dépassé. Vérifiez votre solde dans un instant ou réessayez.",
    408,
  );
}

/**
 * @deprecated Préférer initiate + wait séparés pour ne pas bloquer l’UI.
 * Conservé pour chemins qui doivent encore attendre la fin.
 */
export async function runWalletDeposit(
  token: string,
  amountFcfa: number,
  idempotencyKey: string,
): Promise<void> {
  const init = await initiateWalletDeposit(token, amountFcfa, idempotencyKey);
  if (init.status === "pending_provider") {
    await waitDepositCompleted(token, init.depositIntentId);
  }
}
