import { useTheme } from "@/contexts/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

type Props = {
  styles: Record<string, object>;
};

/** Pastille discrète sur bulle money — reçu exigé par l’émetteur. */
export function MoneyReceiptRequiredBadge({ styles }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <View
      style={styles.moneyReceiptRequiredBadge}
      accessibilityLabel={t("moneyReceipt.badgeA11y")}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Ionicons name="receipt-outline" size={13} color={colors.accent} />
    </View>
  );
}
