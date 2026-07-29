import { StyleSheet } from "react-native";
import type { ThemeColors } from "@/lib/theme/colors";

export function createPayRegisterStyles(c: ThemeColors) {
  return StyleSheet.create({
    /** Modal inscription — feuille ~75 % hauteur depuis le bas, comme `app/deposit.tsx`. */
    regModalRoot: {
      flex: 1,
      backgroundColor: "transparent",
    },
    regModalBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: c.overlay,
    },
    regModalSheet: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: c.modal,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      overflow: "hidden",
    },
    regModalKeyboard: {
      flex: 1,
    },
    regModalSafe: {
      flex: 1,
    },
    regModalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: c.borderLight,
    },
    /** Espace réservé (même largeur que la flèche retour) pour garder le titre centré. */
    regModalHeaderLeading: {
      width: 44,
      height: 44,
    },
    regModalBackHeaderBtn: {
      width: 44,
      height: 44,
      justifyContent: "center",
      alignItems: "flex-start",
    },
    regModalBackHeaderBtnPressed: { opacity: 0.6 },
    regModalHeaderTitle: {
      fontSize: 17,
      fontWeight: "700",
      color: c.text,
    },
    regModalHeaderSpacer: { width: 44 },
    regModalScroll: {
      paddingHorizontal: 25,
      paddingTop: 10,
      paddingBottom: 28,
    },
    regModalSlideClip: {
      width: "100%",
      overflow: "hidden",
    },
    regModalSlideRow: {
      flexDirection: "row",
    },
    regModalSlidePage: {
      flexShrink: 0,
    },
    regModalLead: {
      fontSize: 13,
      color: c.textSecondary,
      lineHeight: 19,
      marginBottom: 22,
    },
    regModalLabel: {
      fontSize: 12,
      fontWeight: "600",
      color: c.textMuted,
      marginBottom: 10,
      letterSpacing: 0.8,
      textAlign: "center",
    },
    regModalPhoneWrap: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.inputBackground,
      borderRadius: 20,
      paddingLeft: 12,
      paddingRight: 6,
      borderWidth: 1,
      borderColor: c.inputBorder,
      marginBottom: 20,
      minHeight: 56,
    },
    regModalFlag: {
      fontSize: 15,
      lineHeight: 19,
      marginRight: 5,
    },
    regModalPrefix: {
      fontSize: 13,
      fontWeight: "700",
      color: c.text,
      marginRight: 6,
      letterSpacing: -0.2,
    },
    regModalPhoneInput: {
      flex: 1,
      fontSize: 16,
      fontWeight: "600",
      color: c.text,
      paddingVertical: 12,
      paddingHorizontal: 0,
      minWidth: 0,
    },
    regModalWalletLogo: {
      marginLeft: "auto",
      flexShrink: 0,
      alignSelf: "center",
      resizeMode: "contain",
    },
    /** Boîte plus carrée : évite le vide latéral avec le logo Orange (fond noir / icône centrée). */
    regModalWalletLogoOrange: {
      width: 26,
      height: 26,
      marginRight: 4,
    },
    /** Logo MTN plus horizontal. */
    regModalWalletLogoMtn: {
      width: 56,
      height: 24,
    },
    regModalPrimaryBtn: {
      backgroundColor: c.accent,
      height: 56,
      borderRadius: 28,
      justifyContent: "center",
      alignItems: "center",
    },
    regModalPrimaryBtnPressed: {
      opacity: 0.92,
      transform: [{ scale: 0.99 }],
    },
    regModalPrimaryBtnDisabled: {
      backgroundColor: c.disabledButton,
    },
    regModalPrimaryBtnText: {
      color: c.textInverse,
      fontSize: 16,
      fontWeight: "700",
    },
    regModalOtpHint: {
      fontSize: 14,
      fontWeight: "600",
      color: c.textSecondary,
      textAlign: "center",
      marginBottom: 16,
    },
    regModalOtpInput: {
      width: "100%",
      height: 56,
      fontSize: 22,
      fontWeight: "700",
      letterSpacing: 8,
      textAlign: "center",
      color: c.text,
      backgroundColor: c.inputBackground,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: c.inputBorder,
      marginBottom: 20,
      paddingHorizontal: 12,
    },
    regModalProfileInput: {
      width: "100%",
      minHeight: 48,
      fontSize: 17,
      fontWeight: "600",
      color: c.text,
      backgroundColor: c.inputBackground,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.inputBorder,
      marginBottom: 14,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    regModalResendHint: {
      fontSize: 14,
      fontWeight: "600",
      color: c.textSecondary,
      textAlign: "center",
      marginTop: 4,
      marginBottom: 4,
    },
    regModalResendHintEm: {
      color: c.text,
      fontVariant: ["tabular-nums"],
    },
    regModalResendBtn: {
      alignSelf: "center",
      marginTop: 4,
      marginBottom: 4,
      paddingVertical: 12,
      paddingHorizontal: 16,
      minHeight: 44,
      justifyContent: "center",
    },
    regModalResendBtnPressed: {
      opacity: 0.65,
    },
    regModalResendBtnDisabled: {
      opacity: 0.45,
    },
    regModalResendBtnText: {
      fontSize: 15,
      fontWeight: "700",
      color: c.accent,
      textDecorationLine: "underline",
    },
    regModalResendLimit: {
      fontSize: 13,
      fontWeight: "600",
      color: c.textMuted,
      textAlign: "center",
      marginTop: 6,
      marginBottom: 4,
      lineHeight: 18,
    },
    regModalBackLink: {
      alignSelf: "center",
      marginTop: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    regModalBackLinkText: {
      fontSize: 14,
      fontWeight: "600",
      color: c.accent,
      textDecorationLine: "underline",
    },
  });
}
