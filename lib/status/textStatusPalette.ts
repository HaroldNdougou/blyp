import type { StatusTextPostStyle } from "@/lib/api/types";

/** Fonds pleins pour statut texte (style WhatsApp). */
export const STATUS_TEXT_BACKGROUNDS: readonly string[] = [
  "#6B5B2E",
  "#0D7A6F",
  "#5C4B8A",
  "#8B3A3A",
  "#2E5C8B",
  "#3D6B2E",
  "#6B3A5C",
  "#1A1A1A",
];

export type StatusTextFontVariant = {
  fontSize: number;
  fontWeight: "400" | "600" | "700";
  fontStyle?: "normal" | "italic";
  fontFamily?: string;
};

export const STATUS_TEXT_FONT_VARIANTS: readonly StatusTextFontVariant[] = [
  { fontSize: 28, fontWeight: "600" },
  { fontSize: 32, fontWeight: "700" },
  { fontSize: 26, fontWeight: "400", fontStyle: "italic" },
];

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index) || length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, Math.floor(index)));
}

export function normalizeStatusTextPostStyle(
  raw: StatusTextPostStyle | null | undefined,
): StatusTextPostStyle {
  return {
    bgIndex: clampIndex(raw?.bgIndex ?? 0, STATUS_TEXT_BACKGROUNDS.length),
    fontIndex: clampIndex(raw?.fontIndex ?? 0, STATUS_TEXT_FONT_VARIANTS.length),
  };
}

export function resolveStatusTextAppearance(
  style: StatusTextPostStyle | null | undefined,
): { backgroundColor: string; font: StatusTextFontVariant } {
  const normalized = normalizeStatusTextPostStyle(style);
  return {
    backgroundColor:
      STATUS_TEXT_BACKGROUNDS[normalized.bgIndex] ??
      STATUS_TEXT_BACKGROUNDS[0],
    font:
      STATUS_TEXT_FONT_VARIANTS[normalized.fontIndex] ??
      STATUS_TEXT_FONT_VARIANTS[0],
  };
}
