import { BackspaceGlyph } from "@/components/pay/PayGlyphs";
import { useTheme } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/lib/theme/colors";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

/** Délai avant rafale ; intervalle entre chaque effacement (ms). */
const BACKSPACE_REPEAT_DELAY_MS = 360;
const BACKSPACE_REPEAT_INTERVAL_MS = 42;

type KeypadStyles = ReturnType<typeof createKeypadStyles>;

function KeypadBackspaceKey({
  onBackspace,
  disabled,
  styles,
  iconColor,
  backspaceLabel,
}: {
  /** `true` = champ vide → arrêter la rafale. */
  onBackspace: () => boolean;
  disabled?: boolean;
  styles: KeypadStyles;
  iconColor: string;
  backspaceLabel: string;
}) {
  const repeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopRepeat = useCallback(() => {
    if (delayRef.current != null) {
      clearTimeout(delayRef.current);
      delayRef.current = null;
    }
    if (repeatRef.current != null) {
      clearInterval(repeatRef.current);
      repeatRef.current = null;
    }
  }, []);

  useEffect(() => () => stopRepeat(), [stopRepeat]);

  const tick = useCallback(() => {
    if (onBackspace()) stopRepeat();
  }, [onBackspace, stopRepeat]);

  const onPressIn = useCallback(() => {
    if (disabled) return;
    stopRepeat();
    if (onBackspace()) return;
    delayRef.current = setTimeout(() => {
      repeatRef.current = setInterval(tick, BACKSPACE_REPEAT_INTERVAL_MS);
    }, BACKSPACE_REPEAT_DELAY_MS);
  }, [disabled, onBackspace, stopRepeat, tick]);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.keypadKey,
        styles.keypadKeyFn,
        pressed && !disabled && styles.keypadKeyPressed,
        disabled && styles.keypadKeyDisabled,
      ]}
      onPressIn={onPressIn}
      onPressOut={stopRepeat}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={backspaceLabel}
    >
      <BackspaceGlyph color={iconColor} />
    </Pressable>
  );
}

type Props = {
  onDigit: (digit: string) => void;
  /** `true` si plus aucun chiffre. */
  onBackspace: () => boolean;
  /** Case vide sous le 7 → confirmer le paiement. */
  onConfirm?: () => void;
  confirmEnabled?: boolean;
  confirmBusy?: boolean;
  disabled?: boolean;
};

const ROWS: readonly (readonly string[])[] = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
  ["back", "0", "pay"],
];

function createKeypadStyles(c: ThemeColors) {
  return StyleSheet.create({
    keypad: {
      marginTop: 0,
      paddingHorizontal: 8,
      alignSelf: "center",
    },
    keypadRow: {
      flexDirection: "row",
      justifyContent: "center",
      marginBottom: GAP,
      gap: GAP,
    },
    keypadKey: {
      width: KEY_SIZE,
      height: KEY_SIZE,
      borderRadius: KEY_SIZE / 2,
      backgroundColor: c.keypadBackground,
      justifyContent: "center",
      alignItems: "center",
      borderWidth: 1,
      borderColor: c.keypadBorder,
    },
    keypadKeyFn: {
      backgroundColor: c.keypadBackgroundFn,
    },
    keypadKeyPay: {
      backgroundColor: c.accent,
      borderColor: c.accent,
    },
    keypadKeyPayPressed: {
      backgroundColor: c.accentDark,
      borderColor: c.accentDark,
    },
    keypadKeyPayDisabled: {
      backgroundColor: c.disabledButton,
      borderColor: c.disabledButton,
      opacity: 1,
    },
    keypadKeyPressed: {
      backgroundColor: c.keypadPressed,
    },
    keypadKeyDisabled: {
      opacity: 0.45,
    },
    keypadKeyText: {
      fontSize: 28,
      fontWeight: "700",
      color: c.keypadText,
      fontVariant: ["tabular-nums"],
    },
    /** Flèche ↑ Text — zéro Ionicons, même poids qu’un chiffre. */
    keypadPayArrow: {
      fontSize: 28,
      fontWeight: "700",
      color: c.accentOn,
      marginTop: -2,
    },
  });
}

function AmountNumericKeypadInner({
  onDigit,
  onBackspace,
  onConfirm,
  confirmEnabled = false,
  confirmBusy = false,
  disabled,
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createKeypadStyles(colors), [colors]);
  const payReady = Boolean(onConfirm) && confirmEnabled && !confirmBusy && !disabled;

  return (
    <View style={styles.keypad} collapsable={false}>
      {ROWS.map((row, ri) => (
        <View key={ri} style={styles.keypadRow}>
          {row.map((cell, ci) => {
            if (cell === "pay") {
              return (
                <Pressable
                  key={ci}
                  style={({ pressed }) => [
                    styles.keypadKey,
                    payReady ? styles.keypadKeyPay : styles.keypadKeyPayDisabled,
                    pressed && payReady && styles.keypadKeyPayPressed,
                  ]}
                  onPressIn={() => {
                    if (payReady) onConfirm?.();
                  }}
                  disabled={!payReady}
                  accessibilityRole="button"
                  accessibilityLabel={t("pay.payNow")}
                  accessibilityState={{ disabled: !payReady, busy: confirmBusy }}
                >
                  {confirmBusy ? (
                    <ActivityIndicator color={colors.accentOn} size="small" />
                  ) : (
                    <Text style={styles.keypadPayArrow}>↑</Text>
                  )}
                </Pressable>
              );
            }
            if (cell === "back") {
              return (
                <KeypadBackspaceKey
                  key={ci}
                  onBackspace={onBackspace}
                  disabled={disabled}
                  styles={styles}
                  iconColor={colors.keypadIcon}
                  backspaceLabel={t("a11y.backspace")}
                />
              );
            }
            return (
              <Pressable
                key={ci}
                style={({ pressed }) => [
                  styles.keypadKey,
                  pressed && !disabled && styles.keypadKeyPressed,
                  disabled && styles.keypadKeyDisabled,
                ]}
                onPressIn={() => {
                  if (!disabled) onDigit(cell);
                }}
                disabled={disabled}
                delayPressIn={0}
                unstable_pressDelay={0}
                accessibilityRole="button"
                accessibilityLabel={t("a11y.digit", { digit: cell })}
              >
                <Text style={styles.keypadKeyText}>{cell}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** memo : le parent se met à jour à chaque chiffre ; les touches ne re-rendent pas inutilement. */
export const AmountNumericKeypad = React.memo(AmountNumericKeypadInner);

const KEY_SIZE = 72;
const GAP = 10;
