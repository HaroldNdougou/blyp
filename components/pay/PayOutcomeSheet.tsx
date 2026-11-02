import { CheckGlyph } from "@/components/pay/PayGlyphs";
import { createPayOutcomeSheetStyles } from "@/components/pay/payOutcomeSheetStyles";
import { useTheme } from "@/contexts/ThemeContext";
import { formatFcfa } from "@/lib/formatFcfa";
import React, { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";

export type PayOutcomeSheetData =
  | {
      kind: "success";
      amountFcfa: number;
      recipientName: string;
      copy?: "payment" | "transfer";
    }
  | {
      kind: "error";
      title: string;
      message: string;
      recipientName?: string;
    };

type Props = {
  outcome: PayOutcomeSheetData;
  onDismiss: () => void;
};

function PayOutcomeSheetInner({ outcome, onDismiss }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createPayOutcomeSheetStyles(colors), [colors]);

  const recipientBlock = (name: string) => (
    <View style={styles.recipientBlock}>
      <Text style={styles.recipientLabel}>{t("pay.receiptTo")}</Text>
      <Text
        style={styles.recipientName}
        numberOfLines={3}
        accessibilityRole="header"
      >
        {name}
      </Text>
    </View>
  );

  if (outcome.kind === "success") {
    return (
      <View style={styles.overlay} accessibilityViewIsModal>
        <Pressable
          style={styles.backdrop}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
        />
        <View style={styles.card}>
          <View
            style={styles.iconWrap}
            accessibilityLabel={t("pay.receiptStatusOk")}
          >
            <CheckGlyph color={colors.accent} size={28} />
          </View>
          <Text style={styles.title}>
            {t(outcome.copy === "transfer" ? "pay.transferred" : "pay.paid")}
          </Text>
          <Text style={styles.amount}>
            {formatFcfa(outcome.amountFcfa)} {t("common.fcfa")}
          </Text>
          {recipientBlock(outcome.recipientName)}
          <Pressable
            style={({ pressed }) => [
              styles.okBtn,
              pressed && styles.okBtnPressed,
            ]}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel={t("common.ok")}
          >
            <Text style={styles.okBtnText}>{t("common.ok")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      <Pressable
        style={styles.backdrop}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={t("common.close")}
      />
      <View style={styles.card}>
        <Text style={styles.titleError}>{outcome.title}</Text>
        {outcome.recipientName ? recipientBlock(outcome.recipientName) : null}
        <Text style={styles.message}>{outcome.message}</Text>
        <Pressable
          style={({ pressed }) => [styles.okBtn, pressed && styles.okBtnPressed]}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={t("common.confirm")}
        >
          <Text style={styles.okBtnText}>{t("common.confirm")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export const PayOutcomeSheet = memo(PayOutcomeSheetInner);
