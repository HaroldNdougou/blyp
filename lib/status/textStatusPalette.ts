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
