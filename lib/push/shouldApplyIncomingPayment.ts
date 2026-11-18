import type { ApiUser } from "@/lib/api/types";
import { getOfflineCashierModeSnapshot } from "@/lib/commerce/offlineCashierMode";
import type { PaymentReceivedPushData } from "@/lib/push/handleIncoming";

/**
 * Évite d’afficher « paiement reçu » sur le téléphone du payeur (contexte perso)
 * ou pour un commerce que l’utilisateur ne encaisse pas.
 */
export function shouldApplyIncomingPayment(
  user: ApiUser | null | undefined,
  data: PaymentReceivedPushData,
): boolean {
  if (!user?.id) return false;
  const amount = Math.floor(Number(data.amountFcfa) || 0);
  if (amount <= 0) return false;

  const commerceId = String(data.commerceId ?? "").trim();
  const isCommerce =
    String(data.contextType ?? "").toLowerCase() === "commerce" &&
    commerceId.length > 0;

  if (isCommerce) {
    const owns = user.commerces?.some((c) => c.id === commerceId);
    if (!owns) return false;

    const offline = getOfflineCashierModeSnapshot();
    if (offline.active && offline.commerceId === commerceId) return true;

    if (
      user.activeContext?.type === "commerce" &&
      user.activeContext.commerceId === commerceId
    ) {
      return true;
    }
    return false;
  }

  if (user.activeContext?.type === "commerce") return false;
  return true;
}
