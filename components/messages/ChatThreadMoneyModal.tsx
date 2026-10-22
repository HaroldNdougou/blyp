import { AmountNumericKeypad } from "@/components/pay/AmountNumericKeypad";
import { MaskedPinInput } from "@/components/pay/MaskedPinInput";
import { MoneyReceiptSendToggle } from "@/components/messages/MoneyReceiptSendToggle";
import type { ThemeColors } from "@/lib/theme/colors";
import { parseAmountFcfa } from "@/lib/amountLimits";
import { formatFcfa } from "@/lib/formatFcfa";
import type { createMessagesStyles } from "@/components/messages/messagesStyles";
import { modalPresentation } from "@/lib/perf/instantMotion";
import React, { type RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  type TextInput,
  View,
} from "react-native";
import type { EdgeInsets } from "react-native-safe-area-context";

type Styles = ReturnType<typeof createMessagesStyles>;

export type ChatThreadMoneyModalProps = {
  visible: boolean;
  moneyStep: "amount" | "pin";
  colors: ThemeColors;
  styles: Styles;
  insets: EdgeInsets;
  pinSheetLift: number;
  amount: string;
  setAmount: React.Dispatch<React.SetStateAction<string>>;
  amountOk: boolean;
  sending: boolean;
  moneyReceiptRequired: boolean;
  setMoneyReceiptRequired: React.Dispatch<React.SetStateAction<boolean>>;
  onToggleReceiptRequired: () => void;
  pinDigits: string;
  setPinDigits: React.Dispatch<React.SetStateAction<string>>;
  pinError: string | null;
  setPinError: React.Dispatch<React.SetStateAction<string | null>>;
  pinInputKey: number;
  pinInputRef: RefObject<TextInput | null>;
  onCloseFromBackdrop: () => void;
  onRequestClose: () => void;
  onSendMoney: (pin: string) => void;
  onBeginPinOrBio: () => void;
  onConfirmAmountToCaption: () => void;
  onPrimaryPress: () => void;
};

export default function ChatThreadMoneyModal({
  visible,
  moneyStep,
  colors,
  styles,
  insets,
  pinSheetLift,
  amount,
  setAmount,
  amountOk,
  sending,
  moneyReceiptRequired,
  onToggleReceiptRequired,
  pinDigits,
  setPinDigits,
  pinError,
  setPinError,
  pinInputKey,
  pinInputRef,
  onCloseFromBackdrop,
  onRequestClose,
  onSendMoney,
  onBeginPinOrBio,
  onConfirmAmountToCaption,
  onPrimaryPress,
}: ChatThreadMoneyModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      visible={visible}
      transparent
      animationType={modalPresentation}
      onRequestClose={onRequestClose}
    >
      <Pressable style={styles.sheetBackdrop} onPress={onCloseFromBackdrop} />
      <View
        style={[
          styles.sheet,
          {
            paddingBottom: Math.max(insets.bottom, 16) + 12,
            bottom: moneyStep === "pin" ? pinSheetLift : 0,
          },
        ]}
      >
        <Text style={styles.sheetTitle}>
          {moneyStep === "pin" ? t("messages.pinTitle") : t("messages.sendMoney")}
        </Text>
        {moneyStep === "pin" ? (
          <View style={{ alignItems: "center", marginBottom: 16 }}>
            <MoneyReceiptSendToggle
              on={moneyReceiptRequired}
              disabled={sending}
              onToggle={onToggleReceiptRequired}
            />
            <Text
              style={{
                textAlign: "center",
                color: colors.textMuted,
                marginBottom: 16,
                marginTop: 8,
              }}
            >
              {t("messages.pinHint")}
            </Text>
            <MaskedPinInput
              key={pinInputKey}
              ref={pinInputRef}
              digits={pinDigits}
              error={Boolean(pinError)}
              onDigitsChange={(d) => {
                if (sending) return;
                if (pinError) setPinError(null);
                setPinDigits(d);
                if (d.length === 4) onSendMoney(d);
              }}
              onTouchStart={() => {
                if (pinError) setPinError(null);
              }}
              maxLength={4}
              autoFocus
              showSoftInputOnFocus
              editable
              accessibilityLabel={t("messages.pinTitle")}
            />
            {pinError ? (
              <Text
                style={styles.pinError}
                accessibilityLiveRegion="polite"
              >
                {pinError}
              </Text>
            ) : null}
            <Pressable
              onPress={onBeginPinOrBio}
              accessibilityRole="button"
              accessibilityLabel={t("messages.moneyBiometricUnlock")}
              style={{ marginTop: 14, paddingVertical: 8 }}
            >
              <Text
                style={{
                  color: colors.accent,
                  fontSize: 15,
                  fontWeight: "600",
                  textAlign: "center",
                }}
              >
                {t("messages.moneyBiometricUnlock")}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <MoneyReceiptSendToggle
              on={moneyReceiptRequired}
              disabled={sending}
              onToggle={onToggleReceiptRequired}
            />
            <Text
              style={{
                textAlign: "center",
                fontSize: 36,
                fontWeight: "800",
                color: colors.text,
                marginBottom: 8,
                marginTop: 4,
              }}
            >
              {amount === "" ? "0" : formatFcfa(parseAmountFcfa(amount) ?? 0)}{" "}
              <Text style={{ fontSize: 18, color: colors.textMuted }}>
                {t("common.fcfa")}
              </Text>
            </Text>
            <AmountNumericKeypad
              onDigit={(d) =>
                setAmount((prev) => {
                  if (prev.length >= 6) return prev;
                  if (prev === "" && d === "0") return prev;
                  return prev + d;
                })
              }
              onBackspace={() => {
                setAmount((p) => p.slice(0, -1));
                return amount.length <= 1;
              }}
              onConfirm={() => {
                if (!amountOk || sending) return;
                onConfirmAmountToCaption();
              }}
              confirmEnabled={amountOk && !sending}
              confirmVariant="outline"
              disabled={sending}
            />
          </>
        )}
        <Pressable
          style={[
            styles.primaryBtn,
            (moneyStep === "pin"
              ? pinDigits.length !== 4 || sending
              : !amountOk || sending) && styles.primaryBtnDisabled,
          ]}
          disabled={
            moneyStep === "pin"
              ? pinDigits.length !== 4 || sending
              : !amountOk || sending
          }
          onPress={onPrimaryPress}
        >
          {sending ? (
            <ActivityIndicator color={colors.accentOn} />
          ) : (
            <Text style={styles.primaryBtnText}>{t("messages.send")}</Text>
          )}
        </Pressable>
      </View>
    </Modal>
  );
}
