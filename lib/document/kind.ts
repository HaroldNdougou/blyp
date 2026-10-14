/** Libellé court type WhatsApp (PDF, DOC, …). */
export function documentKindLabel(
  fileName: string,
  contentType?: string | null,
): string {
  const ct = String(contentType ?? "").trim().toLowerCase();
  if (ct === "application/pdf" || ct.includes("pdf")) return "PDF";
  if (ct.includes("wordprocessing") || ct.includes("msword")) return "DOC";
  if (ct.includes("spreadsheet") || ct.includes("ms-excel")) return "XLS";
  if (ct.includes("presentation") || ct.includes("ms-powerpoint")) return "PPT";
  if (ct === "application/zip" || ct.includes("zip")) return "ZIP";
  if (ct.startsWith("text/")) return "TXT";
  const lower = String(fileName ?? "").trim().toLowerCase();
  const m = lower.match(/\.([a-z0-9]{1,8})$/);
  if (m) return m[1].toUpperCase();
  return "FILE";
}

export function isPdfDocument(
  fileName: string,
  contentType?: string | null,
): boolean {
  const ct = String(contentType ?? "").trim().toLowerCase();
  if (ct === "application/pdf" || ct.includes("pdf")) return true;
  return String(fileName ?? "").trim().toLowerCase().endsWith(".pdf");
}

export function isRasterDocumentPreview(
  fileName: string,
  contentType?: string | null,
): boolean {
  const ct = String(contentType ?? "").trim().toLowerCase();
  if (ct.startsWith("image/")) return true;
  const lower = String(fileName ?? "").trim().toLowerCase();
  return /\.(jpe?g|png|gif|webp|heic|bmp)$/.test(lower);
}

/** Nom affiché dans la liste (sans préfixe 📄 serveur). */
export function documentNameFromListPreview(preview: string): string | null {
  const p = String(preview ?? "").trim();
  if (!p) return null;
  const stripped = p.replace(/^📄\s*/, "").trim();
  if (stripped !== p.trim() && stripped) return stripped;
  if (p === "DOCUMENT" || p === "Document") return null;
  return p;
}
