import type { CommerceStamp } from "@/lib/receipts/commerceStampTypes";
import {
  addBlypMerchantReceipt,
  getReceiptsSnapshot,
} from "@/lib/receipts/receiptsStore";
import type { MerchantReceipt } from "@/lib/receipts/types";
import { formatFcfa } from "@/lib/formatFcfa";
import { resolveAppLanguage } from "@/lib/i18n/locale";
import { bytesToBase64 } from "@/lib/ble/base64";
import FS from "@/lib/voice/fileSystem";
import i18n from "@/lib/i18n";

export type BlypMoneyReceiptDraft = {
  transferId: string;
  amountFcfa: number;
  clientName: string;
  reason: string;
  stamp: CommerceStamp;
};

function blypReceiptId(transferId: string): string {
  return `blyp-mt-${String(transferId ?? "").trim()}`;
}

/** Helvetica WinAnsi — pas d’espace fine / unicode hors CP1252 (ex. montant fr-FR). */
function pdfSafeText(value: string): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u202f/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[·—–]/g, "-");
}

function formatAmountForPdf(amountFcfa: number): string {
  const n = Math.max(0, Math.floor(amountFcfa));
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

async function writePdfToCache(
  transferId: string,
  pdfBytes: Uint8Array,
): Promise<{ uri: string; sizeBytes: number }> {
  const uri = `${FS.cacheDirectory}${blypReceiptId(transferId)}.pdf`;
  await FS.writeAsStringAsync(uri, bytesToBase64(pdfBytes), {
    encoding: FS.EncodingType.Base64,
  });
  const info = await FS.getInfoAsync(uri);
  const sizeBytes =
    info.exists && "size" in info && typeof info.size === "number"
      ? Math.max(1, info.size)
      : pdfBytes.length;
  return { uri, sizeBytes };
}

export async function generateBlypMoneyReceiptPdf(
  draft: BlypMoneyReceiptDraft,
): Promise<{ uri: string; sizeBytes: number }> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const lang = resolveAppLanguage();
  const t = i18n.getFixedT(lang);

  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 48;
  let y = 800;

  const draw = (text: string, bold = false, size = 11) => {
    const lines = pdfSafeText(text).split("\n");
    for (const line of lines) {
      page.drawText(line, {
        x: margin,
        y,
        size,
        font: bold ? fontBold : font,
        color: rgb(0.12, 0.12, 0.12),
      });
      y -= size + 6;
    }
  };

  draw(t("receipts.blypPdfTitle"), true, 18);
  y -= 8;
  const merchant = [draft.stamp.line1, draft.stamp.line2]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join(" · ");
  if (merchant) draw(merchant, true, 13);
  y -= 10;

  draw(`${t("receipts.blypPdfClient")}: ${draft.clientName.trim()}`);
  draw(
    `${t("receipts.blypPdfAmount")}: ${formatAmountForPdf(draft.amountFcfa)} ${t("common.fcfa")}`,
    true,
    12,
  );
  if (draft.reason.trim()) {
    draw(`${t("receipts.blypPdfReason")}: ${draft.reason.trim()}`);
  }
  draw(`${t("receipts.blypPdfDate")}: ${new Date().toLocaleString(lang === "fr" ? "fr-FR" : "en-GB")}`);
  draw(`${t("receipts.blypPdfTransfer")}: ${draft.transferId}`);
  y -= 12;
  draw(t("receipts.blypPdfSigned"), false, 10);

  const bytes = await doc.save();
  return writePdfToCache(draft.transferId, bytes);
}

/** Enregistre le reçu Blyp dans Mes reçus (idempotent par transfert). */
export async function saveBlypMoneyReceiptToProfile(
  accountId: string,
  draft: BlypMoneyReceiptDraft,
): Promise<MerchantReceipt> {
  const aid = String(accountId ?? "").trim();
  const transferId = String(draft.transferId ?? "").trim();
  if (!aid || !transferId) throw new Error("INVALID_RECEIPT");

  const existing = getReceiptsSnapshot(aid)?.find(
    (r) => r.id === blypReceiptId(transferId),
  );
  if (existing) return existing;

  const { uri, sizeBytes } = await generateBlypMoneyReceiptPdf(draft);
  const lang = resolveAppLanguage();
  const t = i18n.getFixedT(lang);
  const name = pdfSafeText(
    t("receipts.blypAutoName", {
      amount: formatFcfa(draft.amountFcfa),
      client: draft.clientName.trim() || t("receipts.defaultName"),
    }),
  );
  const merchantName = String(draft.stamp.line1 ?? "").trim() || null;

  return addBlypMerchantReceipt({
    accountId: aid,
    transferId,
    name,
    merchantName,
    category: "service",
    localUri: uri,
    fileName: `${blypReceiptId(transferId)}.pdf`,
    contentType: "application/pdf",
    sizeBytes,
  });
}
