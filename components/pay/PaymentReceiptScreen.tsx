/**
 * Reçu paiement — plein écran au tap d’une tx Historique.
 */
import { CheckGlyph } from "@/components/pay/PayGlyphs";
import { createPaymentReceiptStyles } from "@/components/pay/paymentReceiptStyles";
import { useTheme } from "@/contexts/ThemeContext";
import { formatCameroonPhoneDisplay } from "@/lib/format";
import { formatFcfa } from "@/lib/formatFcfa";
import i18n, { getNumberLocale, type AppLanguage } from "@/lib/i18n";
import React, { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export type PaymentReceiptData = {
  amountFcfa: number;
  counterpartyName: string;
  counterpartyPhone: string | null;
  paidAt: string;
  reference: string;
  balanceFcfa?: number | null;
  direction: "sent" | "received";
};

export type PaymentReceiptScreenProps = {
  receipt: PaymentReceiptData;
  onClose: () => void;
};

function formatReceiptDateTime(iso: string): string {
  const d = new Date(iso);
  const lang: AppLanguage = i18n.language === "fr" ? "fr" : "en";
  const locale = getNumberLocale(lang);
  const date = d.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}

function PaymentReceiptScreenInner({
  receipt,
  onClose,
}: PaymentReceiptScreenProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createPaymentReceiptStyles(colors), [colors]);
  const phoneDisplay = formatCameroonPhoneDisplay(
    receipt.counterpartyPhone ?? "",
  );
  const isReceived = receipt.direction === "received";
  const title = isReceived ? t("pay.received") : t("pay.paid");
  const subtitle = isReceived
    ? t("pay.receivedSubtitle")
    : t("pay.successSubtitle");
  const peerLabel = isReceived ? t("pay.receiptFrom") : t("pay.receiptTo");
  const showBalance =
    receipt.balanceFcfa != null && Number.isFinite(receipt.balanceFcfa);

  return (
    <SafeAreaView style={styles.successSafe} edges={["top", "left", "right"]}>
      <ScrollView
        style={styles.successScroll}
        contentContainerStyle={styles.successScrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces
      >
        <View style={styles.successTop}>
          <View
            style={styles.successIconWrap}
            accessibilityLabel={t("pay.receiptStatusOk")}
          >
            <CheckGlyph color={colors.accent} size={40} />
          </View>
          <Text style={styles.successTitle}>{title}</Text>
          <Text style={styles.successSubtitle}>{subtitle}</Text>
          <Text style={styles.successAmount}>
            {isReceived ? "+" : ""}
            {formatFcfa(receipt.amountFcfa)}
          </Text>
          <Text style={styles.successAmountCurrency}>{t("common.fcfa")}</Text>

          <View style={styles.successReceipt}>
            <View style={[styles.successRow, styles.successRowBorder]}>
              <Text style={styles.successRowLabel}>{peerLabel}</Text>
              <Text style={styles.successRowValue}>
                {receipt.counterpartyName}
              </Text>
            </View>
            {phoneDisplay ? (
              <View style={[styles.successRow, styles.successRowBorder]}>
                <Text style={styles.successRowLabel}>
                  {t("pay.receiptPhone")}
                </Text>
                <Text
                  style={[styles.successRowValue, styles.successRowValueMuted]}
                >
                  +237 {phoneDisplay}
                </Text>
              </View>
            ) : null}
            <View style={[styles.successRow, styles.successRowBorder]}>
              <Text style={styles.successRowLabel}>{t("pay.receiptDate")}</Text>
              <Text
                style={[styles.successRowValue, styles.successRowValueMuted]}
              >
                {formatReceiptDateTime(receipt.paidAt)}
              </Text>
            </View>
            <View style={[styles.successRow, styles.successRowBorder]}>
              <Text style={styles.successRowLabel}>
                {t("pay.receiptStatus")}
              </Text>
              <Text style={[styles.successRowValue, styles.successStatusOk]}>
                {t("pay.receiptStatusOk")}
              </Text>
            </View>
            {showBalance ? (
              <View style={[styles.successRow, styles.successRowBorder]}>
                <Text style={styles.successRowLabel}>
                  {t("pay.receiptBalance")}
                </Text>
                <Text style={styles.successRowValue}>
                  {formatFcfa(receipt.balanceFcfa!)} {t("common.fcfa")}
                </Text>
              </View>
            ) : null}
            {receipt.reference ? (
              <View style={styles.successRow}>
                <Text style={styles.successRowLabel}>
                  {t("pay.receiptRef")}
                </Text>
                <Text
                  style={[styles.successRowValue, styles.successRowValueMuted]}
                  numberOfLines={1}
                  selectable
                >
                  {receipt.reference}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>

      <View style={styles.successActions}>
        <Pressable
          style={({ pressed }) => [
            styles.successPrimaryBtn,
            pressed && styles.successPrimaryBtnPressed,
          ]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
        >
          <Text style={styles.successPrimaryBtnText}>{t("common.close")}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

export const PaymentReceiptScreen = memo(PaymentReceiptScreenInner);
