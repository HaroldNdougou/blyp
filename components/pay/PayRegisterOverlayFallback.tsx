/**
 * Coquille instantanée pendant le lazy-load de PayRegisterOverlay.
 * Le 1er clic ne doit jamais rester « mort » en attendant Metro/chunk.
 */
import { createPayRegisterStyles } from "@/components/pay/payRegisterStyles";
import { useTheme } from "@/contexts/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const REG_SHEET_HEIGHT_RATIO = 0.75;

export function PayRegisterOverlayFallback({
  onClose,
}: {
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createPayRegisterStyles(colors), [colors]);
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = windowHeight * REG_SHEET_HEIGHT_RATIO;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.regModalRoot}>
        <Pressable
          style={styles.regModalBackdrop}
          onPress={onClose}
          accessibilityLabel={t("common.close")}
          accessibilityRole="button"
        />
        <View style={[styles.regModalSheet, { height: sheetHeight }]}>
          <SafeAreaView style={styles.regModalSafe} edges={["bottom", "left", "right"]}>
            <View style={styles.regModalHeader}>
              <Pressable
                onPress={onClose}
                style={styles.regModalBackHeaderBtn}
                hitSlop={12}
                accessibilityLabel={t("common.close")}
                accessibilityRole="button"
              >
                <Ionicons name="close" size={28} color={colors.text} />
              </Pressable>
              <Text style={styles.regModalHeaderTitle}>
                {t("register.steps.phone")}
              </Text>
              <View style={styles.regModalHeaderSpacer} />
            </View>
            <View
              style={{
                flex: 1,
                justifyContent: "center",
                alignItems: "center",
                paddingBottom: 40,
              }}
            >
              <ActivityIndicator color={colors.accent} size="large" />
            </View>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}
