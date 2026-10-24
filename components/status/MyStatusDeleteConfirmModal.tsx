import { createStatusStyles } from "@/components/status/statusStyles";
import { useTheme } from "@/contexts/ThemeContext";
import { modalPresentation } from "@/lib/perf/instantMotion";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, Text, View } from "react-native";

type Props = {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function MyStatusDeleteConfirmModal({
  visible,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStatusStyles(colors), [colors]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={modalPresentation}
      onRequestClose={onCancel}
    >
      <Pressable style={styles.myStatusMenuBackdrop} onPress={onCancel}>
        <View style={styles.myStatusConfirmWrap} pointerEvents="box-none">
          <Pressable
            style={styles.myStatusConfirmCard}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.myStatusConfirmHeader}>
              <Text style={styles.myStatusConfirmTitle}>
                {t("status.deleteOneTitle")}
              </Text>
              <Text style={styles.myStatusConfirmMessage}>
                {t("status.deleteOneMessage")}
              </Text>
            </View>
            <View style={styles.myStatusConfirmDivider} />
            <View style={styles.myStatusConfirmActionsRow}>
              <Pressable
                style={styles.myStatusConfirmActionBtn}
                onPress={onCancel}
                accessibilityRole="button"
              >
                <Text style={styles.myStatusConfirmCancelText}>
                  {t("common.cancel")}
                </Text>
              </Pressable>
              <View style={styles.myStatusConfirmActionDivider} />
              <Pressable
                style={styles.myStatusConfirmActionBtn}
                onPress={onConfirm}
                accessibilityRole="button"
              >
                <Text style={styles.myStatusConfirmDeleteText}>
                  {t("status.menuDelete")}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
