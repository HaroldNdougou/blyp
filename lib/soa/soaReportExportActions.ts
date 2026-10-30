import {
  FORWARD_SOURCE_SOA_REPORT,
  setForwardDraft,
  type OutboundDocumentForward,
} from "@/lib/messages/forwardDraft";
import type { SoaReportExportPayload } from "@/lib/soa/soaReportExport";
import {
  buildSoaReportPlainText,
  generateSoaReportPdfFile,
  writeSoaReportCsvFile,
} from "@/lib/soa/soaReportExport";
import { router } from "expo-router";
import { Platform, Share } from "react-native";

async function thumbForPdf(localUri: string, cacheKey: string) {
  const { prepareDocumentSendArtifacts } = await import(
    "@/lib/document/prepareSend"
  );
  const { thumbLocalUri, pageCount } = await prepareDocumentSendArtifacts(
    {
      uri: localUri,
      name: "report.pdf",
      mimeType: "application/pdf",
      size: 1,
    },
    cacheKey,
  );
  return { thumbLocalUri, pageCount };
}

export async function shareSoaReportSystem(
  uri: string,
  _mimeType: string,
  message?: string,
): Promise<void> {
  const url = String(uri ?? "").trim();
  if (!url) return;
  const msg = String(message ?? "").trim();
  if (Platform.OS === "ios") {
    await Share.share({
      url,
      message: msg || undefined,
    });
    return;
  }
  await Share.share({
    message: msg ? `${msg}\n${url}` : url,
    title: msg || undefined,
  });
}

export async function shareSoaReportPlainSummary(
  payload: SoaReportExportPayload,
): Promise<void> {
  await Share.share({ message: buildSoaReportPlainText(payload) });
}

export async function exportSoaReportPdf(
  payload: SoaReportExportPayload,
  periodKey: string,
): Promise<{ uri: string; fileName: string; sizeBytes: number }> {
  return generateSoaReportPdfFile(payload, periodKey);
}

export async function exportSoaReportCsv(
  payload: SoaReportExportPayload,
  periodKey: string,
): Promise<{ uri: string; fileName: string; sizeBytes: number }> {
  return writeSoaReportCsvFile(payload, periodKey);
}

export async function forwardSoaReportFileViaBlyp(
  file: {
    uri: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  },
  periodKey: string,
): Promise<void> {
  let thumbLocalUri: string | null = null;
  let pageCount: number | null = null;
  if (file.contentType === "application/pdf") {
    const thumb = await thumbForPdf(file.uri, `soa-export:${periodKey}`);
    thumbLocalUri = thumb.thumbLocalUri;
    pageCount = thumb.pageCount ?? null;
  }
  const outbound: OutboundDocumentForward = {
    localUri: file.uri,
    fileName: file.fileName,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    pageCount,
    thumbLocalUri,
  };
  setForwardDraft({
    sourceConversationId: FORWARD_SOURCE_SOA_REPORT,
    messages: [],
    outboundDocument: outbound,
  });
  router.push("/forward");
}
