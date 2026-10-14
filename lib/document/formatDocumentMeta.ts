import { formatFileSize } from "@/lib/format";
import type { TFunction } from "i18next";
import { documentKindLabel } from "./kind";

export function formatDocumentMetaLine(
  t: TFunction,
  fileName: string,
  sizeBytes: number,
  contentType?: string | null,
  pageCount?: number | null,
): string {
  const kind = documentKindLabel(fileName, contentType);
  const size = formatFileSize(sizeBytes).replace(/\s*Ko\b/g, " ko").replace(/\s*Mo\b/g, " Mo");
  const pages = Math.floor(Number(pageCount) || 0);
  if (pages > 0) {
    return t("messages.documentMetaWithPages", {
      count: pages,
      size,
      kind,
    });
  }
  return t("messages.documentMetaNoPages", { size, kind });
}
