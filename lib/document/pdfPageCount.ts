import FS from "@/lib/voice/fileSystem";

function base64ToBytes(b64: string): Uint8Array {
  const atobFn = globalThis.atob;
  if (typeof atobFn !== "function") return new Uint8Array(0);
  const raw = atobFn(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Compte les pages d’un PDF local (best-effort, hors chemin Pay). */
export async function readPdfPageCount(localUri: string): Promise<number | undefined> {
  const uri = String(localUri ?? "").trim();
  if (!uri) return undefined;
  try {
    const { PDFDocument } = await import("pdf-lib");
    const b64 = await FS.readAsStringAsync(uri, {
      encoding: FS.EncodingType.Base64,
    });
    const bytes = base64ToBytes(b64);
    if (!bytes.length) return undefined;
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const n = pdf.getPageCount();
    return n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}
