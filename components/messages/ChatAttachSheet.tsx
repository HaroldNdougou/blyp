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

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end" },
    backdrop: {
      flex: 1,
      backgroundColor: c.overlay,
    },
    sheet: {
      backgroundColor: c.modal,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: 12,
      paddingTop: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderLight,
    },
    handle: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.border,
      marginBottom: 12,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingVertical: 14,
      paddingHorizontal: 8,
    },
    rowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.borderLight,
    },
    icon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceMuted,
    },
    label: {
      fontSize: 16,
      fontWeight: "600",
      color: c.text,
      flex: 1,
    },
    cancel: {
      marginTop: 8,
      paddingVertical: 14,
      alignItems: "center",
    },
    cancelText: {
      fontSize: 16,
      fontWeight: "700",
      color: c.textMuted,
    },
  });
}

type Props = {
  visible: boolean;
  onClose: () => void;
  onPickPhoto: () => void;
  onPickDocument: () => void;
};

export function ChatAttachSheet({
  visible,
  onClose,
  onPickPhoto,
  onPickDocument,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

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
          accessibilityLabel={t("common.cancel")}
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.handle} />
          <Pressable
            style={styles.row}
            onPress={() => {
              onClose();
              onPickPhoto();
            }}
            accessibilityRole="button"
            accessibilityLabel={t("messages.attachPhoto")}
          >
            <View style={styles.icon}>
              <Ionicons name="image-outline" size={24} color={colors.accent} />
            </View>
            <Text style={styles.label}>{t("messages.attachPhoto")}</Text>
          </Pressable>
          <Pressable
            style={[styles.row, styles.rowBorder]}
            onPress={() => {
              onClose();
              onPickDocument();
            }}
            accessibilityRole="button"
            accessibilityLabel={t("messages.attachDocument")}
          >
            <View style={styles.icon}>
              <Ionicons
                name="document-attach-outline"
                size={24}
                color={colors.accent}
              />
            </View>
            <Text style={styles.label}>{t("messages.attachDocument")}</Text>
          </Pressable>
          <Pressable
            style={styles.cancel}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("common.cancel")}
          >
            <Text style={styles.cancelText}>{t("common.cancel")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
