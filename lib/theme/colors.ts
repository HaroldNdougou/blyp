/** Tokens couleur Blyp — base clair/sombre (extensible rose/gold/skins plus tard). */

export type ColorScheme = "light" | "dark";

export type ThemeColors = {
  background: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textFaint: string;
  textInverse: string;
  border: string;
  borderLight: string;
  accent: string;
  accentDark: string;
  accentOn: string;
  destructive: string;
  destructiveSoft: string;
  destructiveBorder: string;
  overlay: string;
  modal: string;
  inputBackground: string;
  inputBorder: string;
  inputErrorBackground: string;
  inputErrorBorder: string;
  placeholder: string;
  tabBar: string;
  tabBarBorder: string;
  tabBarActivePill: string;
  tabInactive: string;
  keypadBackground: string;
  keypadBackgroundFn: string;
  keypadBorder: string;
  keypadPressed: string;
  keypadIcon: string;
  keypadText: string;
  avatarBackground: string;
  avatarText: string;
  successAmount: string;
  sentAmount: string;
  disabled: string;
  disabledButton: string;
  shadow: string;
  signOutBackground: string;
  signOutBorder: string;
  depositHighlightBackground: string;
  depositHighlightBorder: string;
  bubbleMine: string;
  bubbleTheirs: string;
  bubbleMineText: string;
  bubbleTheirsText: string;
  moneyBubbleBackground: string;
  moneyBubbleBorder: string;
  moneyAmountSent: string;
  moneyAmountPending: string;
  moneyAmountClaimed: string;
  moneyAmountExpired: string;
  /** Mot « Récupérer » sur une bulle money en attente. */
  moneyClaimAction: string;
  moneyHighlightBackground: string;
  moneyHighlightBorder: string;
  /** Pastilles montants rapides (picker emoji Argent). */
  chatMoneyPillBackground: string;
  chatMoneyPillBorder: string;
  chatMoneyPillText: string;
  chatMoneyPillPressedBackground: string;
  chatMoneyPillPressedText: string;
  /** Appui long — bande pleine largeur (style WhatsApp). */
  messageSelectRowBackground: string;
  tickSent: string;
  tickRead: string;
  /** Dégradé bas des photos (heure / coches). */
  imageMetaScrim: string;
  /** Aperçu page document (style WhatsApp, reste clair en mode sombre). */
  documentPreviewPage: string;
  documentPreviewLine: string;
  switchTrackOff: string;
  switchTrackOn: string;
  switchThumbOff: string;
  switchThumbOn: string;
  /** Cachet reçu Blyp (tampon rouge / bleu). */
  moneyReceiptStampRed: string;
  moneyReceiptStampBlue: string;
  /** Bannière réseau globale (hors ligne / instable). */
  networkBannerBg: string;
  networkBannerUnstableBg: string;
  networkBannerText: string;
  /** Lecteur statuts (fond plein écran type stories). */
  statusViewerBackground: string;
  /** Menu ⋮ sur le lecteur statut (contacts). */
  statusViewerMenu: string;
  statusProgressTrack: string;
  /** Glyphe + sur la carte « Ajouter un statut » (toujours noir). */
  statusAddBadgePlus: string;
  /** Barre basse composition statut texte (semi-transparente). */
  statusTextFooterBar: string;
};

const accent = "#5dc705";
const accentDark = "#4bb004";

export const lightColors: ThemeColors = {
  background: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceMuted: "#F5F5F5",
  text: "#222222",
  textSecondary: "#666666",
  textMuted: "#888888",
  textFaint: "#AAAAAA",
  textInverse: "#FFFFFF",
  border: "#EEEEEE",
  borderLight: "#F0F0F0",
  accent,
  accentDark,
  accentOn: "#FFFFFF",
  destructive: "#C62828",
  destructiveSoft: "#FFF8F8",
  destructiveBorder: "#FFCDD2",
  overlay: "rgba(0,0,0,0.5)",
  modal: "#FFFFFF",
  inputBackground: "#F8F8F8",
  inputBorder: "#EEEEEE",
  inputErrorBackground: "#FFF5F5",
  inputErrorBorder: "rgba(198, 40, 40, 0.45)",
  placeholder: "#CCCCCC",
  tabBar: "#FFFFFF",
  tabBarBorder: "#F0F0F0",
  tabBarActivePill: "rgba(93, 199, 5, 0.11)",
  tabInactive: "#8E8E93",
  keypadBackground: "#F3F3F3",
  keypadBackgroundFn: "#EEEEEE",
  keypadBorder: "#E8E8E8",
  keypadPressed: "#E0E0E0",
  keypadIcon: "#555555",
  keypadText: "#222222",
  avatarBackground: "#F0F4F2",
  avatarText: "#4CAF50",
  successAmount: "#4CAF50",
  sentAmount: "#000000",
  disabled: "#CCCCCC",
  disabledButton: "#CCCCCC",
  shadow: "#000000",
  signOutBackground: "#FFF8F8",
  signOutBorder: "#FFCDD2",
  depositHighlightBackground: "#F4FFF0",
  depositHighlightBorder: "#E0F5D5",
  bubbleMine: "#DCF8C6",
  bubbleTheirs: "#F0F0F0",
  bubbleMineText: "#111111",
  bubbleTheirsText: "#111111",
  moneyBubbleBackground: "#F4FFF0",
  moneyBubbleBorder: "#E0F5D5",
  moneyAmountSent: "#111111",
  moneyAmountPending: accent,
  moneyAmountClaimed: "#8E24AA",
  moneyAmountExpired: "#8E8E93",
  moneyClaimAction: "#1E88E5",
  moneyHighlightBackground: "#E8F8D8",
  moneyHighlightBorder: accent,
  chatMoneyPillBackground: "#FFF8E1",
  chatMoneyPillBorder: "#F5D547",
  chatMoneyPillText: "#5C4A00",
  chatMoneyPillPressedBackground: "#FFCA28",
  chatMoneyPillPressedText: "#3E2723",
  messageSelectRowBackground: "rgba(93, 199, 5, 0.30)",
  tickSent: "#8E8E93",
  tickRead: "#53BDEB",
  imageMetaScrim: "rgba(0,0,0,0.38)",
  documentPreviewPage: "#E9EDEF",
  documentPreviewLine: "#8696A0",
  switchTrackOff: "#D1D1D6",
  switchTrackOn: "#A8E07A",
  switchThumbOff: "#FFFFFF",
  switchThumbOn: "#FFFFFF",
  moneyReceiptStampRed: "#C62828",
  moneyReceiptStampBlue: "#1565C0",
  networkBannerBg: "#B71C1C",
  networkBannerUnstableBg: "#E65100",
  networkBannerText: "#FFFFFF",
  statusViewerBackground: "#000000",
  statusViewerMenu: "#323739",
  statusProgressTrack: "rgba(255,255,255,0.35)",
  statusAddBadgePlus: "#000000",
  statusTextFooterBar: "rgba(0,0,0,0.24)",
};

export const darkColors: ThemeColors = {
  background: "#0B0B0C",
  surface: "#141416",
  surfaceMuted: "#1C1C1E",
  text: "#F5F5F7",
  textSecondary: "#AEAEB2",
  textMuted: "#8E8E93",
  textFaint: "#636366",
  textInverse: "#FFFFFF",
  border: "#2C2C2E",
  borderLight: "#252528",
  accent,
  accentDark,
  accentOn: "#FFFFFF",
  destructive: "#FF6B6B",
  destructiveSoft: "#2A1518",
  destructiveBorder: "#5C2B32",
  overlay: "rgba(0,0,0,0.72)",
  modal: "#1C1C1E",
  inputBackground: "#2C2C2E",
  inputBorder: "#3A3A3C",
  inputErrorBackground: "#2A1518",
  inputErrorBorder: "rgba(255, 107, 107, 0.45)",
  placeholder: "#636366",
  tabBar: "#141416",
  tabBarBorder: "#2C2C2E",
  tabBarActivePill: "rgba(93, 199, 5, 0.16)",
  tabInactive: "#8E8E93",
  keypadBackground: "#2C2C2E",
  keypadBackgroundFn: "#252528",
  keypadBorder: "#3A3A3C",
  keypadPressed: "#3A3A3C",
  keypadIcon: "#AEAEB2",
  keypadText: "#F5F5F7",
  avatarBackground: "#1E2A22",
  avatarText: "#5dc705",
  successAmount: "#5dc705",
  sentAmount: "#F5F5F7",
  disabled: "#48484A",
  disabledButton: "#48484A",
  shadow: "#000000",
  signOutBackground: "#2A1518",
  signOutBorder: "#5C2B32",
  depositHighlightBackground: "#152016",
  depositHighlightBorder: "#2A4030",
  bubbleMine: "#005C4B",
  bubbleTheirs: "#2C2C2E",
  bubbleMineText: "#F5F5F7",
  bubbleTheirsText: "#F5F5F7",
  moneyBubbleBackground: "#152016",
  moneyBubbleBorder: "#2A4030",
  moneyAmountSent: "#F5F5F7",
  moneyAmountPending: accent,
  moneyAmountClaimed: "#CE93D8",
  moneyAmountExpired: "#8E8E93",
  moneyClaimAction: "#64B5F6",
  moneyHighlightBackground: "#1A2E18",
  moneyHighlightBorder: accent,
  chatMoneyPillBackground: "#3D3520",
  chatMoneyPillBorder: "#8D6E00",
  chatMoneyPillText: "#FFE082",
  chatMoneyPillPressedBackground: "#FFC107",
  chatMoneyPillPressedText: "#1C1400",
  messageSelectRowBackground: "rgba(93, 199, 5, 0.36)",
  tickSent: "#8E8E93",
  tickRead: "#53BDEB",
  imageMetaScrim: "rgba(0,0,0,0.45)",
  documentPreviewPage: "#E9EDEF",
  documentPreviewLine: "#8696A0",
  switchTrackOff: "#636366",
  switchTrackOn: "#4BB004",
  switchThumbOff: "#F5F5F7",
  switchThumbOn: "#FFFFFF",
  moneyReceiptStampRed: "#EF5350",
  moneyReceiptStampBlue: "#42A5F5",
  networkBannerBg: "#D32F2F",
  networkBannerUnstableBg: "#F57C00",
  networkBannerText: "#FFFFFF",
  statusViewerBackground: "#000000",
  statusViewerMenu: "#323739",
  statusProgressTrack: "rgba(255,255,255,0.35)",
  statusAddBadgePlus: "#000000",
  statusTextFooterBar: "rgba(0,0,0,0.32)",
};

export function getThemeColors(scheme: ColorScheme | null | undefined): ThemeColors {
  return scheme === "dark" ? darkColors : lightColors;
}

export function getStatusBarStyle(
  scheme: ColorScheme | null | undefined,
): "light" | "dark" | "auto" {
  return scheme === "dark" ? "light" : "dark";
}
