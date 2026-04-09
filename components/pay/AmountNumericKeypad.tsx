import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/** Délai avant rafale ; intervalle entre chaque effacement (ms). */
const BACKSPACE_REPEAT_DELAY_MS = 360;
const BACKSPACE_REPEAT_INTERVAL_MS = 42;

function KeypadBackspaceKey({
  onBackspace,
  disabled,
}: {
  onBackspace: () => void;
  disabled?: boolean;
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
      accessibilityLabel="Effacer"
    >
      <Ionicons name="backspace-outline" size={26} color="#555" />
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

function AmountNumericKeypadInner({
  onDigit,
  onBackspace,
  disabled,
}: Props) {
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
                accessibilityLabel={`Chiffre ${cell}`}
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

const styles = StyleSheet.create({
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
    backgroundColor: "#F3F3F3",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E8E8E8",
  },
  keypadKeyFn: {
    backgroundColor: "#EEE",
  },
  keypadKeyPressed: {
    backgroundColor: "#E0E0E0",
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
    color: "#222",
    fontVariant: ["tabular-nums"],
  },
});
