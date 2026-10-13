import type { HistoryUiRow } from "@/lib/history/historyUiCache";
import type { TFunction } from "i18next";

const MONEY_REFUND_KINDS = new Set(["MONEY_RECALL", "MONEY_EXPIRE_REFUND"]);

function isLegacyMoneyRefundName(name: string): boolean {
  return String(name ?? "")
    .trim()
    .startsWith("Message Money (");
}

/** Libellé court du chip « type » dans l’onglet Transactions. */
export function historyTxTypeLabel(
  row: Pick<HistoryUiRow, "type" | "txKind" | "name">,
  t: TFunction,
): string {
  const kind = row.txKind ?? null;
  if (kind === "MONEY_SEND") return t("history.typeMoneyTransfer");
  if (kind && MONEY_REFUND_KINDS.has(kind)) {
    return t("history.typeMoneyReclaimed");
  }
  if (row.type === "received" && isLegacyMoneyRefundName(row.name)) {
    return t("history.typeMoneyReclaimed");
  }
  if (kind === "DEPOSIT") return t("history.typeReceived");
  if (kind === "PAYMENT") return t("history.typeSent");
  return row.type === "received"
    ? t("history.typeReceived")
    : t("history.typeSent");
}
