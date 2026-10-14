import { useTheme } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/lib/theme/colors";
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function createMessageDeleteSheetStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      justifyContent: "flex-end",
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: c.overlay,
    },
    sheet: {
      backgroundColor: c.modal,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingTop: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderLight,
      borderBottomWidth: 0,
    },
    handle: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.border,
      marginBottom: 16,
    },
    iconWrap: {
      alignSelf: "center",
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: c.destructiveSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.destructiveBorder,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 14,
    },
    actions: {
      marginTop: 22,
      borderRadius: 14,
      overflow: "hidden",
      backgroundColor: c.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderLight,
    },
    actionRow: {
      paddingVertical: 14,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    actionRowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.borderLight,
    },
    actionIcon: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.modal,
    },
    actionTexts: {
      flex: 1,
      minWidth: 0,
    },
    actionTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: c.destructive,
    },
    cancelBtn: {
      marginTop: 12,
      alignSelf: "stretch",
      borderRadius: 14,
      paddingVertical: 15,
      paddingHorizontal: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderLight,
    },
    cancelText: {
      fontSize: 16,
      fontWeight: "700",
      color: c.text,
      flexShrink: 0,
      includeFontPadding: false,
    },
  });
}

type Props = {
  visible: boolean;
  count: number;
  showEveryone: boolean;
  onClose: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
};

export function MessageDeleteSheet({
  visible,
  count,
  showEveryone,
  onClose,
  onDeleteForMe,
  onDeleteForEveryone,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(
    () => createMessageDeleteSheetStyles(colors),
    [colors],
  );
  const sheetA11yLabel =
    count > 1
      ? t("messages.deleteTitleMany", { count })
      : t("messages.deleteTitle");

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root} accessibilityViewIsModal>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("messages.deleteCancel")}
        />
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, 16) + 8 },
          ]}
          accessibilityLabel={sheetA11yLabel}
        >
          <View style={styles.handle} />
          <View style={styles.iconWrap}>
            <Ionicons
              name="trash-outline"
              size={26}
              color={colors.destructive}
            />
          </View>
          <View style={styles.actions}>
            <Pressable
              style={styles.actionRow}
              onPress={onDeleteForMe}
              android_ripple={{ color: colors.borderLight }}
              accessibilityRole="button"
              accessibilityLabel={t("messages.deleteForMe")}
            >
              <View style={styles.actionIcon}>
                <Ionicons
                  name="person-outline"
                  size={20}
                  color={colors.destructive}
                />
              </View>
              <View style={styles.actionTexts}>
                <Text style={styles.actionTitle}>
                  {t("messages.deleteForMe")}
                </Text>
              </View>
            </Pressable>
            {showEveryone ? (
              <Pressable
                style={[styles.actionRow, styles.actionRowBorder]}
                onPress={onDeleteForEveryone}
                android_ripple={{ color: colors.borderLight }}
                accessibilityRole="button"
                accessibilityLabel={t("messages.deleteForEveryone")}
              >
                <View style={styles.actionIcon}>
                  <Ionicons
                    name="people-outline"
                    size={20}
                    color={colors.destructive}
                  />
                </View>
                <View style={styles.actionTexts}>
                  <Text style={styles.actionTitle}>
                    {t("messages.deleteForEveryone")}
                  </Text>
                </View>
              </Pressable>
            ) : null}
          </View>

          <Pressable
            style={styles.cancelBtn}
            onPress={onClose}
            android_ripple={{ color: colors.borderLight }}
            accessibilityRole="button"
            accessibilityLabel={t("messages.deleteCancel")}
          >
            <Text style={styles.cancelText}>{t("messages.deleteCancel")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
