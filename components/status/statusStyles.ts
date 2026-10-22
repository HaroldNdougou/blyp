import type { ThemeColors } from "@/lib/theme/colors";
import { StyleSheet } from "react-native";

const CARD_W = 108;
const CARD_H = 156;

export function createStatusStyles(c: ThemeColors) {
  return StyleSheet.create({
    strip: {
      paddingVertical: 10,
      paddingLeft: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.borderLight,
    },
    stripScroll: {
      gap: 14,
      paddingRight: 12,
      flexDirection: "row",
      alignItems: "flex-start",
    },
    stripItem: {
      width: 72,
      alignItems: "center",
    },
    stripLabel: {
      marginTop: 6,
      fontSize: 12,
      color: c.textMuted,
      textAlign: "center",
    },
    stripLabelMine: {
      color: c.text,
      fontWeight: "600",
    },
    ringOuter: {
      padding: 2.5,
      borderRadius: 999,
      borderWidth: 2.5,
    },
    ringUnseen: {
      borderColor: c.accent,
    },
    ringSeen: {
      borderColor: c.border,
    },
    ringAdd: {
      borderColor: c.borderLight,
      borderStyle: "dashed",
    },
    viewerRoot: {
      flex: 1,
      backgroundColor: c.background,
    },
    viewerMedia: {
      flex: 1,
      width: "100%",
    },
    viewerCaption: {
      position: "absolute",
      left: 16,
      right: 16,
      bottom: 48,
      fontSize: 22,
      fontWeight: "600",
      color: c.textInverse,
      textShadowColor: c.overlay,
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
    },
    progressRow: {
      flexDirection: "row",
      gap: 4,
      paddingHorizontal: 8,
      paddingTop: 8,
    },
    progressSeg: {
      flex: 1,
      height: 2,
      borderRadius: 1,
      backgroundColor: c.statusProgressTrack,
      overflow: "hidden",
    },
    createModeRow: {
      flexDirection: "row",
      marginHorizontal: 16,
      marginTop: 8,
      gap: 8,
    },
    createModeChip: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderLight,
      alignItems: "center",
    },
    createModeChipActive: {
      borderColor: c.accent,
      backgroundColor: c.tabBarActivePill,
    },
    createModeChipText: {
      fontSize: 14,
      fontWeight: "600",
      color: c.textMuted,
    },
    createModeChipTextActive: {
      color: c.accent,
    },
    viewerTextOnly: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    viewerTextOnlyLabel: {
      fontSize: 28,
      textAlign: "center",
      color: c.textInverse,
      fontWeight: "600",
    },
    progressFill: {
      height: "100%",
      backgroundColor: c.accentOn,
    },
    viewerHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      paddingVertical: 8,
      gap: 10,
    },
    viewerName: {
      flex: 1,
      fontSize: 16,
      fontWeight: "700",
      color: c.text,
    },
    createField: {
      marginHorizontal: 16,
      marginTop: 12,
      padding: 12,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderLight,
      backgroundColor: c.surfaceMuted,
      color: c.text,
      minHeight: 80,
      textAlignVertical: "top",
    },
    createPreview: {
      margin: 16,
      height: 280,
      borderRadius: 12,
      backgroundColor: c.surfaceMuted,
      overflow: "hidden",
    },
    actusRoot: {
      flex: 1,
      backgroundColor: c.background,
    },
    actusPanelRoot: {
      flex: 1,
      backgroundColor: c.background,
    },
    actusTopBar: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 8,
      paddingTop: 4,
      paddingBottom: 4,
      gap: 4,
    },
    actusBackBtn: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    actusTitle: {
      flex: 1,
      fontSize: 24,
      fontWeight: "700",
      color: c.text,
    },
    actusSectionTitle: {
      fontSize: 15,
      fontWeight: "600",
      color: c.textMuted,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 10,
    },
    actusRow: {
      paddingHorizontal: 12,
      gap: 8,
      flexDirection: "row",
      alignItems: "flex-start",
    },
    actusCardWrap: {
      width: CARD_W,
    },
    actusCard: {
      width: CARD_W,
      height: CARD_H,
      borderRadius: 14,
      overflow: "hidden",
      backgroundColor: c.surfaceMuted,
    },
    actusCardMedia: {
      ...StyleSheet.absoluteFillObject,
    },
    actusCardScrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: c.imageMetaScrim,
      opacity: 0.55,
    },
    actusCardAvatarSlot: {
      position: "absolute",
      top: 12,
      left: 0,
      right: 0,
      alignItems: "center",
    },
    actusCardAvatarSlotAdd: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 34,
      alignItems: "center",
      justifyContent: "center",
    },
    actusAvatarWithBadge: {
      position: "relative",
      alignSelf: "center",
    },
    actusAddBadge: {
      position: "absolute",
      right: -1,
      bottom: -1,
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: c.surfaceMuted,
    },
    actusAddBadgeText: {
      color: c.statusAddBadgePlus,
      fontSize: 15,
      fontWeight: "500",
      lineHeight: 15,
      textAlign: "center",
      marginTop: -1,
    },
    actusCardLabel: {
      position: "absolute",
      left: 8,
      right: 8,
      bottom: 10,
      fontSize: 13,
      fontWeight: "600",
      color: c.textInverse,
    },
    actusCardLabelPeer: {
      textAlign: "center",
    },
    actusCardTextPreview: {
      fontSize: 14,
      fontWeight: "600",
      color: c.textInverse,
      textAlign: "center",
    },
    actusEmpty: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    actusHint: {
      paddingHorizontal: 16,
      paddingTop: 20,
      fontSize: 14,
      color: c.textMuted,
    },
  });
}
