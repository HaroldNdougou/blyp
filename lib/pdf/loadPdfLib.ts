/** Charge pdf-lib en sync — évite `import()` Metro (unknown module sur chunks async). */
export type PdfLibModule = typeof import("pdf-lib");

let cached: PdfLibModule | null = null;

export function loadPdfLib(): PdfLibModule {
  if (!cached) {
    cached = require("pdf-lib") as PdfLibModule;
  }
  return cached;
}
