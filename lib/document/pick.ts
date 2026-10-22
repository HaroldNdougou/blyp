import FS from "@/lib/voice/fileSystemLegacy";
import * as DocumentPicker from "expo-document-picker";

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export type PickedDocument = {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
};

async function resolveFileSizeBytes(uri: string, reported: number): Promise<number> {
  let size = Math.floor(Number(reported) || 0);
  if (size > 0) return size;
  try {
    const info = await FS.getInfoAsync(uri);
    if (info.exists && typeof info.size === "number" && info.size > 0) {
      size = Math.floor(info.size);
    }
  } catch {
    /* garde 0 */
  }
  return size;
}

export async function pickDocumentFromDevice(): Promise<PickedDocument | null> {
  let result;
  try {
    result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: "*/*",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ExpoDocumentPicker|native module/i.test(msg)) {
      throw new Error("DOCUMENT_NATIVE_MISSING");
    }
    throw e;
  }
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  const uri = String(asset.uri ?? "").trim();
  if (!uri) return null;
  const size = await resolveFileSizeBytes(uri, Number(asset.size) || 0);
  if (size <= 0 || size > MAX_DOCUMENT_BYTES) {
    throw new Error("DOCUMENT_SIZE");
  }
  const name =
    String(asset.name ?? "").trim() ||
    uri.split("/").pop() ||
    "document";
  const mimeType =
    String(asset.mimeType ?? "").trim() || "application/octet-stream";
  return { uri, name, size, mimeType };
}
