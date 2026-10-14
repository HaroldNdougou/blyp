import type { PickedDocument } from "@/lib/document/pick";
import { isPdfDocument, isRasterDocumentPreview } from "@/lib/document/kind";
import { readPdfPageCount } from "@/lib/document/pdfPageCount";
import { generatePdfThumbUri } from "@/lib/document/pdfThumb";

/** Vignette + pages (expéditeur uniquement, avant upload S3). */
export async function prepareDocumentSendArtifacts(
  file: PickedDocument,
  pendingKey: string,
): Promise<{ thumbLocalUri: string | null; pageCount?: number }> {
  if (isRasterDocumentPreview(file.name, file.mimeType)) {
    return { thumbLocalUri: file.uri };
  }
  if (!isPdfDocument(file.name, file.mimeType)) {
    return { thumbLocalUri: null };
  }
  const pageCount = await readPdfPageCount(file.uri);
  const thumbLocalUri = await generatePdfThumbUri(
    `pending:${pendingKey}`,
    file.uri,
  );
  return { thumbLocalUri, pageCount };
}
