/**
 * Montant + pad : état local pour que chaque chiffre
 * ne re-rende pas tout PayHomeScreen (latence perçue sur Redmi / mid-range).
 * Confirmer = ↑ vert dans la case sous le 3.
 */
import { AmountNumericKeypad } from "@/components/pay/AmountNumericKeypad";
import { MAX_AMOUNT_DIGITS, parseAmountFcfa } from "@/lib/amountLimits";
import { formatFcfa } from "@/lib/formatFcfa";
import { computePayFeeFcfa } from "@/lib/pay/fees";
import i18n from "@/lib/i18n";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Montants FCFA courants — tap = remplace la saisie. */
const QUICK_AMOUNTS_FCFA = [100, 350, 500, 600] as const;

type Styles = {
  inputSection: StyleProp<ViewStyle>;
  inputLabel: StyleProp<TextStyle>;
  inputWrapper: StyleProp<ViewStyle>;
  amountRow: StyleProp<ViewStyle>;
  amountDisplayWrap: StyleProp<ViewStyle>;
  amountDisplay: StyleProp<TextStyle>;
  currency: StyleProp<TextStyle>;
  payContentSpacer: StyleProp<ViewStyle>;
  payKeypadSpacer: StyleProp<ViewStyle>;
  payKeypadBlock: StyleProp<ViewStyle>;
  quickAmountsRow: StyleProp<ViewStyle>;
  quickAmountChip: StyleProp<ViewStyle>;
  quickAmountChipSelected: StyleProp<ViewStyle>;
  quickAmountChipPressed: StyleProp<ViewStyle>;
  quickAmountChipDisabled: StyleProp<ViewStyle>;
  quickAmountChipText: StyleProp<TextStyle>;
  quickAmountChipTextSelected: StyleProp<TextStyle>;
  topUpSuccessBanner: StyleProp<TextStyle>;
  payBalanceRow: StyleProp<ViewStyle>;
  payBalanceText: StyleProp<TextStyle>;
  payFeeLine: StyleProp<TextStyle>;
};

type Props = {
  styles: Styles;
  /** Change → remet le montant à vide (ex. logout). */
  resetKey: string;
  keypadDisabled?: boolean;
  payBusy?: boolean;
  onPay: (amountFcfa: number) => void;
  /** Montant courant (null si vide / invalide) — pour recharge + sans modal. */
  onAmountFcfaChange?: (amountFcfa: number | null) => void;
  /** Message vert au-dessus du pad quand la recharge est créditée. */
  topUpSuccessMessage?: string | null;
  /** Solde affiché juste au-dessus du clavier (null = masqué). */
  balanceFcfa?: number | null;
};

/**
 * Format hot-path sans `toLocaleString` (ICU trop lourd au clic sur Redmi).
 * FR : espaces ; EN : virgules.
 */
function formatDigitsHot(digits: string): string {
  if (!digits) return "0";
  const sep = i18n.language === "fr" ? "\u202f" : ",";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

const QUICK_LABELS = QUICK_AMOUNTS_FCFA.map((v) => formatFcfa(v));

function PayAmountEntryInner({
  styles,
  resetKey,
  keypadDisabled,
  payBusy,
  onPay,
  onAmountFcfaChange,
  topUpSuccessMessage,
  balanceFcfa,
}: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [amount, setAmount] = useState("");
  /** Vert chip seulement après tap rapide — pas si le montant est tapé au pad. */
  const [quickSelected, setQuickSelected] = useState<number | null>(null);
  const amountRef = useRef(amount);
  const onAmountFcfaChangeRef = useRef(onAmountFcfaChange);
  onAmountFcfaChangeRef.current = onAmountFcfaChange;
  amountRef.current = amount;

  useEffect(() => {
    setAmount("");
    setQuickSelected(null);
  }, [resetKey]);

  const amountFcfa = parseAmountFcfa(amount);

  useEffect(() => {
    onAmountFcfaChangeRef.current?.(amountFcfa);
  }, [amountFcfa]);

  const onDigit = useCallback((digit: string) => {
    setQuickSelected((q) => (q == null ? q : null));
    setAmount((prev) => {
      const d = digit.replace(/\D/g, "");
      if (!d) return prev;
      if (prev.length >= MAX_AMOUNT_DIGITS) return prev;
      if (prev === "" && d === "0") return prev;
      if (prev === "0") return d;
      const next = prev + d;
      amountRef.current = next;
      return next;
    });
  }, []);

  /**
   * Lit / écrit `amountRef` en sync — obligatoire pour la rafale ⌫
   * (setInterval hors event React → updater setState peut être différé).
   */
  const onBackspace = useCallback((): boolean => {
    setQuickSelected((q) => (q == null ? q : null));
    const prev = amountRef.current;
    if (!prev) return true;
    const next = prev.slice(0, -1);
    amountRef.current = next;
    setAmount(next);
    return next.length === 0;
  }, []);

  const canPay = amountFcfa != null && !payBusy;
  const feeFcfa =
    amountFcfa != null && amountFcfa > 0 ? computePayFeeFcfa(amountFcfa) : null;
  const displayText = formatDigitsHot(amount);
  const chipsDisabled = Boolean(keypadDisabled || payBusy);

  const tryPay = useCallback(
    (raw: number | string) => {
      if (keypadDisabled || payBusy) return;
      const n = parseAmountFcfa(String(raw));
      if (n == null) return;
      onPay(n);
    },
    [keypadDisabled, payBusy, onPay],
  );

  /**
   * Identité stable : le pad memo ne se re-rend pas à chaque chiffre
   * (avant : onConfirm changeait car amountFcfa changeait).
   */
  const onConfirm = useCallback(() => {
    tryPay(amountRef.current);
  }, [tryPay]);

  /** Sélection visuelle immédiate ; paiement au relâchement (après paint du vert). */
  const selectQuickAmount = useCallback((value: number) => {
    setQuickSelected(value);
    setAmount(String(value));
  }, []);

  const confirmQuickAmount = useCallback(
    (value: number) => {
      tryPay(value);
    },
    [tryPay],
  );

  return (
    <>
      <View style={styles.payContentSpacer} />

      <View style={styles.inputSection}>
        <Text style={styles.inputLabel}>{t("pay.amountLabel")}</Text>
        <View style={styles.inputWrapper}>
          <View style={styles.amountRow}>
            <View style={styles.amountDisplayWrap}>
              <Text
                style={styles.amountDisplay}
                numberOfLines={1}
                accessibilityRole="text"
                accessibilityLabel={t("a11y.amountLabel", {
                  amount: displayText,
                })}
              >
                {displayText}
              </Text>
            </View>
            <Text style={styles.currency}>F</Text>
          </View>
          {feeFcfa != null && feeFcfa > 0 ? (
            <Text
              style={styles.payFeeLine}
              accessibilityRole="text"
              accessibilityLabel={t("pay.feeLine", {
                amount: formatFcfa(feeFcfa),
              })}
            >
              {t("pay.feeLine", { amount: formatFcfa(feeFcfa) })}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.payKeypadSpacer} />

      <View
        style={[
          styles.payKeypadBlock,
          { paddingBottom: Math.max(insets.bottom, 8) },
        ]}
      >
        {topUpSuccessMessage ? (
          <Text
            style={styles.topUpSuccessBanner}
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
          >
            {topUpSuccessMessage}
          </Text>
        ) : null}
        {balanceFcfa != null ? (
          <View style={styles.payBalanceRow}>
            <Text
              style={styles.payBalanceText}
              accessibilityRole="text"
              accessibilityLabel={t("pay.balanceShort", {
                amount: formatFcfa(balanceFcfa),
              })}
            >
              {t("pay.balanceShort", { amount: formatFcfa(balanceFcfa) })}
            </Text>
          </View>
        ) : null}
        <AmountNumericKeypad
          onDigit={onDigit}
          onBackspace={onBackspace}
          onConfirm={onConfirm}
          confirmEnabled={canPay}
          confirmBusy={Boolean(payBusy)}
          disabled={keypadDisabled}
        />
        <View style={styles.quickAmountsRow}>
          {QUICK_AMOUNTS_FCFA.map((value, i) => {
            const selected = quickSelected === value;
            const label = QUICK_LABELS[i];
            return (
              <Pressable
                key={value}
                style={({ pressed }) => [
                  styles.quickAmountChip,
                  chipsDisabled && !selected && styles.quickAmountChipDisabled,
                  selected && styles.quickAmountChipSelected,
                  pressed && !chipsDisabled && styles.quickAmountChipPressed,
                ]}
                onPressIn={() => {
                  if (!chipsDisabled) selectQuickAmount(value);
                }}
                onPress={() => {
                  if (!chipsDisabled) confirmQuickAmount(value);
                }}
                disabled={chipsDisabled}
                accessibilityRole="button"
                accessibilityLabel={t("a11y.quickAmount", { amount: label })}
                accessibilityState={{ selected, disabled: chipsDisabled }}
              >
                <Text
                  style={[
                    styles.quickAmountChipText,
                    selected && styles.quickAmountChipTextSelected,
                  ]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </>
  );
}

export const PayAmountEntry = memo(PayAmountEntryInner);
