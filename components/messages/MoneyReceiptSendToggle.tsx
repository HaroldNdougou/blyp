import { useTheme } from "@/contexts/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";

type Props = {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
};

export function MoneyReceiptSendToggle({ on, onToggle, disabled }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={t("moneyReceipt.toggleA11y")}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "center",
        gap: 6,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: on ? colors.accent : colors.borderLight,
        backgroundColor: on ? colors.depositHighlightBackground : colors.surfaceMuted,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Ionicons
        name="receipt-outline"
        size={18}
        color={on ? colors.accent : colors.textMuted}
      />
      {on ? (
        <Text
          style={{
            fontSize: 13,
            fontWeight: "700",
            color: colors.accent,
          }}
        >
          {t("moneyReceipt.toggleOn")}
        </Text>
      ) : (
        <View style={{ width: 0, height: 18 }} />
      )}
    </Pressable>
  );
}
