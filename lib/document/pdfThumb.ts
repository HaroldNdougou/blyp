import FS from "@/lib/voice/fileSystem";

const THUMB_DIR = `${FS.cacheDirectory}blyp-doc-thumb/`;

function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 140);
}

async function ensureThumbDir(): Promise<void> {
  const info = await FS.getInfoAsync(THUMB_DIR);
  if (!info.exists) {
    await FS.makeDirectoryAsync(THUMB_DIR, { intermediates: true });
  }
}

export async function peekPdfThumbUri(cacheKey: string): Promise<string | null> {
  const dest = `${THUMB_DIR}${safeKey(cacheKey)}-p0.jpg`;
  const info = await FS.getInfoAsync(dest);
  return info.exists ? dest : null;
}

/**
 * Vignette JPEG page 1 (PdfRenderer / PDFKit) — cache disque stable par clé.
 */
export async function generatePdfThumbUri(
  cacheKey: string,
  pdfUri: string,
): Promise<string | null> {
  const key = String(cacheKey ?? "").trim();
  const uri = String(pdfUri ?? "").trim();
  if (!key || !uri) return null;
  const existing = await peekPdfThumbUri(key);
  if (existing) return existing;
  try {
    await ensureThumbDir();
    const PdfThumbnail = (await import("react-native-pdf-thumbnail")).default;
    const result = await PdfThumbnail.generate(uri, 0, {
      maxWidth: 520,
      maxHeight: 360,
      quality: 88,
    });
    const dest = `${THUMB_DIR}${safeKey(key)}-p0.jpg`;
    await FS.copyAsync({ from: result.uri, to: dest });
    return dest;
  } catch {
    return null;
  }
}

/** Préchauffe la vignette (envoi optimiste) sans bloquer l’UI. */
export function warmPdfThumb(cacheKey: string, pdfUri: string): void {
  void generatePdfThumbUri(cacheKey, pdfUri);
}
