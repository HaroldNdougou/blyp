import { bytesToBase64 } from "@/lib/ble/base64";
import i18n, { getNumberLocale } from "@/lib/i18n";
import { resolveAppLanguage } from "@/lib/i18n/locale";
import type { SoaReportTripListItem } from "@/lib/soa/soaReportTripList";
import type { SoaReportPeriodKind } from "@/lib/soa/soaReportPeriod";
import { loadPdfLib } from "@/lib/pdf/loadPdfLib";
import FS from "@/lib/voice/fileSystemLegacy";

export type SoaReportExportPayload = {
  commerceName: string;
  periodKind: SoaReportPeriodKind;
  periodLabel: string;
  totalFcfa: number;
  completedTripCount: number;
  trips: SoaReportTripListItem[];
  generatedAtIso: string;
};

function pdfSafeText(value: string): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u202f/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[·—–]/g, "-");
}

function formatAmountPlain(amountFcfa: number): string {
  const n = Math.max(0, Math.floor(amountFcfa));
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function exportFileStem(periodKind: SoaReportPeriodKind, periodKey: string): string {
  const key = String(periodKey ?? "")
    .trim()
    .replace(/[^\dA-Za-z-]/g, "-");
  return `soa-report-${periodKind}-${key || "period"}`;
}

function periodKindLabel(
  kind: SoaReportPeriodKind,
  t: (key: string) => string,
): string {
  if (kind === "day") return t("soaCar.reportPeriodDay");
  if (kind === "week") return t("soaCar.reportPeriodWeek");
  return t("soaCar.reportPeriodMonth");
}

function tripStatusLabel(
  trip: SoaReportTripListItem,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (trip.isActive) return t("soaCar.reportTripActive");
  if (trip.courseNumber != null) {
    return t("soaCar.reportTripLineNumber", { n: trip.courseNumber });
  }
  return t("soaCar.reportTripLine");
}

export function buildSoaReportPlainText(payload: SoaReportExportPayload): string {
  const lang = resolveAppLanguage();
  const t = i18n.getFixedT(lang);
  const lines: string[] = [];
  lines.push(t("soaCar.reportExportTitle"));
  lines.push(`${t("soaCar.reportExportCommerce")}: ${payload.commerceName.trim()}`);
  lines.push(
    `${periodKindLabel(payload.periodKind, t)}: ${payload.periodLabel.trim()}`,
  );
  lines.push(
    `${t("soaCar.reportTotalCollected")}: ${formatAmountPlain(payload.totalFcfa)} ${t("common.fcfa")}`,
  );
  lines.push(
    `${t("soaCar.reportTripsCompleted")}: ${String(payload.completedTripCount).padStart(2, "0")}`,
  );
  lines.push("");
  lines.push(t("soaCar.reportTripCountLabel"));
  if (!payload.trips.length) {
    lines.push(t("soaCar.reportExportNoTrips"));
  } else {
    for (const trip of payload.trips) {
      lines.push(
        `- ${tripStatusLabel(trip, t)} · ${formatAmountPlain(trip.totalFcfa)} ${t("common.fcfa")}`,
      );
    }
  }
  lines.push("");
  lines.push(
    `${t("soaCar.reportExportGenerated")}: ${new Date(payload.generatedAtIso).toLocaleString(lang === "fr" ? "fr-FR" : "en-GB")}`,
  );
  return lines.join("\n");
}

function csvEscape(value: string): string {
  const s = String(value ?? "").replace(/"/g, '""');
  return `"${s}"`;
}

export async function writeSoaReportCsvFile(
  payload: SoaReportExportPayload,
  periodKey: string,
): Promise<{ uri: string; fileName: string; sizeBytes: number }> {
  const lang = resolveAppLanguage();
  const t = i18n.getFixedT(lang);
  const header = [
    t("soaCar.reportExportCsvCourse"),
    t("soaCar.reportExportCsvStatus"),
    t("soaCar.reportExportCsvTotal"),
    t("soaCar.reportExportCsvStarted"),
    t("soaCar.reportExportCsvEnded"),
  ].map(csvEscape).join(",");

  const rows = payload.trips.map((trip) => {
    const course =
      trip.courseNumber != null ? String(trip.courseNumber) : trip.tripId;
    return [
      course,
      trip.isActive ? t("soaCar.reportTripActive") : t("soaCar.reportExportCsvDone"),
      String(trip.totalFcfa),
      trip.tripStartedAt,
      trip.endedAt ?? "",
    ]
      .map(csvEscape)
      .join(",");
  });

  const summary = [
    "",
    csvEscape(t("soaCar.reportTotalCollected")),
    csvEscape(String(payload.totalFcfa)),
  ].join(",");
  const body = [header, ...rows, summary].join("\n");
  const fileName = `${exportFileStem(payload.periodKind, periodKey)}.csv`;
  const uri = `${FS.cacheDirectory}${fileName}`;
  await FS.writeAsStringAsync(uri, body, { encoding: FS.EncodingType.UTF8 });
  const info = await FS.getInfoAsync(uri);
  const sizeBytes =
    info.exists && "size" in info && typeof info.size === "number"
      ? Math.max(1, info.size)
      : body.length;
  return { uri, fileName, sizeBytes };
}

export async function generateSoaReportPdfFile(
  payload: SoaReportExportPayload,
  periodKey: string,
): Promise<{ uri: string; fileName: string; sizeBytes: number }> {
  const { PDFDocument, StandardFonts, rgb } = loadPdfLib();
  const lang = resolveAppLanguage();
  const t = i18n.getFixedT(lang);
  const loc = getNumberLocale(lang === "fr" ? "fr" : "en");

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 48;
  const lineHeight = 14;
  const pageWidth = 595;
  const pageHeight = 842;
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const newPageIfNeeded = (needed = lineHeight) => {
    if (y - needed >= margin) return;
    page = doc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };

  const draw = (text: string, bold = false, size = 11) => {
    const lines = pdfSafeText(text).split("\n");
    for (const line of lines) {
      newPageIfNeeded(size + 8);
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

  draw(t("soaCar.reportExportTitle"), true, 18);
  y -= 4;
  draw(`${t("soaCar.reportExportCommerce")}: ${payload.commerceName.trim()}`, true, 12);
  draw(
    `${periodKindLabel(payload.periodKind, t)}: ${payload.periodLabel.trim()}`,
  );
  draw(
    `${t("soaCar.reportTotalCollected")}: ${formatAmountPlain(payload.totalFcfa)} ${t("common.fcfa")}`,
    true,
    12,
  );
  draw(
    `${t("soaCar.reportTripsCompleted")}: ${String(payload.completedTripCount).padStart(2, "0")}`,
  );
  y -= 8;
  draw(t("soaCar.reportTripCountLabel"), true, 12);
  y -= 4;

  if (!payload.trips.length) {
    draw(t("soaCar.reportExportNoTrips"));
  } else {
    for (const trip of payload.trips) {
      const when = trip.tripStartedAt
        ? new Date(trip.tripStartedAt).toLocaleString(loc)
        : "";
      draw(
        `${tripStatusLabel(trip, t)} · ${formatAmountPlain(trip.totalFcfa)} ${t("common.fcfa")}${when ? ` · ${when}` : ""}`,
        false,
        10,
      );
    }
  }

  y -= 10;
  draw(
    `${t("soaCar.reportExportGenerated")}: ${new Date(payload.generatedAtIso).toLocaleString(loc)}`,
    false,
    9,
  );

  const bytes = await doc.save();
  const fileName = `${exportFileStem(payload.periodKind, periodKey)}.pdf`;
  const uri = `${FS.cacheDirectory}${fileName}`;
  await FS.writeAsStringAsync(uri, bytesToBase64(bytes), {
    encoding: FS.EncodingType.Base64,
  });
  const info = await FS.getInfoAsync(uri);
  const sizeBytes =
    info.exists && "size" in info && typeof info.size === "number"
      ? Math.max(1, info.size)
      : bytes.length;
  return { uri, fileName, sizeBytes };
}
