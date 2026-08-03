import { BackspaceGlyph } from "@/components/pay/PayGlyphs";
import { useTheme } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/lib/theme/colors";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

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
  onBackspace: () => void;
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

  const onPressIn = useCallback(() => {
    if (disabled) return;
    onBackspace();
    delayRef.current = setTimeout(() => {
      repeatRef.current = setInterval(onBackspace, BACKSPACE_REPEAT_INTERVAL_MS);
    }, BACKSPACE_REPEAT_DELAY_MS);
  }, [disabled, onBackspace]);

  const onPressOut = useCallback(() => {
    stopRepeat();
  }, [stopRepeat]);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.keypadKey,
        styles.keypadKeyFn,
        pressed && !disabled && styles.keypadKeyPressed,
        disabled && styles.keypadKeyDisabled,
      ]}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
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
  onBackspace: () => void;
  disabled?: boolean;
};

const ROWS: readonly (readonly string[])[] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["", "0", "back"],
];

function createKeypadStyles(c: ThemeColors) {
  return StyleSheet.create({
    keypad: {
      marginTop: 8,
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
    keypadKeyPressed: {
      backgroundColor: c.keypadPressed,
      transform: [{ scale: 0.96 }],
    },
    keypadKeyDisabled: {
      opacity: 0.45,
    },
    keypadKeySpacer: {
      width: KEY_SIZE,
      height: KEY_SIZE,
    },
    keypadKeyText: {
      fontSize: 28,
      fontWeight: "700",
      color: c.keypadText,
      fontVariant: ["tabular-nums"],
    },
  });
}

function AmountNumericKeypadInner({
  onDigit,
  onBackspace,
  disabled,
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createKeypadStyles(colors), [colors]);

  return (
    <View style={styles.keypad} collapsable={false}>
      {ROWS.map((row, ri) => (
        <View key={ri} style={styles.keypadRow}>
          {row.map((cell, ci) => {
            if (cell === "") {
              return <View key={ci} style={styles.keypadKeySpacer} />;
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
