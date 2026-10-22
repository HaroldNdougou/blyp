import { isRasterDocumentPreview } from "@/lib/document/kind";
import FS from "@/lib/voice/fileSystemLegacy";
import { Linking, Platform } from "react-native";

export function mimeTypeForDocument(
  fileName: string,
  contentType?: string | null,
): string {
  const ct = String(contentType ?? "").trim();
  if (ct) return ct;
  const lower = String(fileName ?? "").trim().toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

/** Ouvre un fichier local (galerie, lecteur PDF, etc.). */
export async function openDocumentWithViewer(
  localUri: string,
  fileName: string,
  contentType?: string | null,
): Promise<void> {
  const raw = String(localUri ?? "").trim();
  if (!raw) throw new Error("NO_URI");
  const mime = mimeTypeForDocument(fileName, contentType);

  if (Platform.OS === "android") {
    const IntentLauncher = await import("expo-intent-launcher");
    let data = raw;
    if (raw.startsWith("file://")) {
      data = await FS.getContentUriAsync(raw);
    }
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data,
      flags: 1,
      type: mime,
    });
    return;
  }

  const openUri = raw.startsWith("file://") ? raw : `file://${raw}`;
  if (isRasterDocumentPreview(fileName, contentType)) {
    const can = await Linking.canOpenURL(openUri);
    if (can) {
      await Linking.openURL(openUri);
      return;
    }
  }
  await Linking.openURL(openUri);
}
