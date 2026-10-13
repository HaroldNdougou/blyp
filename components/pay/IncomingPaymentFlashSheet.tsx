import { createIncomingFlashStyles } from "@/components/pay/incomingFlashStyles";
import { useTheme } from "@/contexts/ThemeContext";
import { formatFcfa } from "@/lib/formatFcfa";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Bottom sheet reçu — commerce (`payment`) ou P2P proximité (`transfer`). */
export function IncomingPaymentFlashSheet({
  amountFcfa,
  onDismiss,
  copy = "payment",
}: {
  amountFcfa: number;
  onDismiss: () => void;
  copy?: "payment" | "transfer";
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createIncomingFlashStyles(colors), [colors]);
  const amount = formatFcfa(amountFcfa);
  const titleKey =
    copy === "transfer" ? "pay.transferReceived" : "pay.received";

  return (
    <View
      style={styles.flashOverlay}
      accessibilityViewIsModal
      accessibilityLabel={t("pay.receivedFlashA11y", { amount })}
    >
      <Pressable
        style={styles.flashBackdrop}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={t("common.close")}
      />
      <Pressable
        style={[
          styles.flashSheet,
          { paddingBottom: Math.max(insets.bottom, 16) + 10 },
        ]}
        onPress={onDismiss}
      >
        <Text style={styles.flashTitle}>{t(titleKey)}</Text>
        <Text
          style={styles.flashAmount}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.35}
          allowFontScaling={false}
        >
          +{amount}
        </Text>
        <Text style={styles.flashCurrency}>{t("common.fcfa")}</Text>
      </Pressable>
    </View>
  );
}
