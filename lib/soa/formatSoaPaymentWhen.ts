import i18n from "@/lib/i18n";

/** Texte relatif pour un paiement siège (ex. « il y a 5 min »). */
export function formatSoaPaymentWhen(
  paidAt: string,
  nowMs = Date.now(),
): string {
  const t = new Date(paidAt).getTime();
  if (!Number.isFinite(t)) return "";
  const diffSec = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (diffSec < 45) return i18n.t("soaCar.paymentWhenJustNow");
  const min = Math.floor(diffSec / 60);
  if (min < 60) {
    return i18n.t("soaCar.paymentWhenMinutes", { count: min });
  }
  const hours = Math.floor(min / 60);
  if (hours < 24) {
    return i18n.t("soaCar.paymentWhenHours", { count: hours });
  }
  const days = Math.floor(hours / 24);
  return i18n.t("soaCar.paymentWhenDays", { count: days });
}
