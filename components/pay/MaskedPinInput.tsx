/**
 * Code PIN / OTP sans flash : TextInput invisible + masque React.
 * `circles` : ronds style iPhone.
 * `lines` : traits + chiffres visibles (type WhatsApp).
 * `text` : • classiques (legacy).
 */
import { useTheme } from "@/contexts/ThemeContext";
import React, { forwardRef } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextInput as TextInputType,
  type TextStyle,
  type ViewStyle,
} from "react-native";

type Props = Omit<
  TextInputProps,
  "value" | "onChangeText" | "secureTextEntry" | "keyboardType" | "maxLength"
> & {
  digits: string;
  onDigitsChange: (digits: string) => void;
  maxLength: number;
  maskChar?: string;
  /** Défaut : cercles accent Blyp. */
  variant?: "text" | "circles" | "lines";
  /** Bordure / anneau en erreur (circles / lines). */
  error?: boolean;
  style?: StyleProp<ViewStyle | TextStyle>;
};

const CIRCLE = 16;
const CIRCLE_GAP = 18;
const LINE_CELL_W = 48;
const LINE_CELL_GAP = 20;
const LINE_STROKE = 2;

export const MaskedPinInput = forwardRef<TextInputType, Props>(
  function MaskedPinInput(
    {
      digits,
      onDigitsChange,
      maxLength,
      maskChar = "•",
      variant = "circles",
      error = false,
      style,
      placeholder,
      placeholderTextColor,
      editable = true,
      onTouchStart,
      ...inputProps
    },
    ref,
  ) {
    const { colors } = useTheme();
    const safeDigits = digits.replace(/\D/g, "").slice(0, maxLength);
    const filledCount = safeDigits.length;
    const emptyMask =
      placeholder ??
      Array.from({ length: maxLength }, () => maskChar).join(" ");

    /** Accent Blyp : lisible en clair et en sombre (évite blanc sur fond clair). */
    const ringColor = error ? colors.destructive : colors.accent;
    const fillColor = error ? colors.destructive : colors.accent;
    const lineIdle = error ? colors.destructive : colors.inputBorder;
    const lineActive = error ? colors.destructive : colors.accent;
    const lineFilled = error ? colors.destructive : colors.text;

    const boxStyle =
      variant === "circles"
        ? styles.circlesBox
        : variant === "lines"
          ? styles.linesBox
          : styles.box;

    return (
      <View
        style={[boxStyle, style as StyleProp<ViewStyle>]}
        onTouchStart={onTouchStart}
      >
        <TextInput
          {...inputProps}
          ref={ref}
          value={safeDigits}
          onChangeText={(text) => {
            onDigitsChange(text.replace(/\D/g, "").slice(0, maxLength));
          }}
          style={styles.hiddenInput}
          caretHidden
          secureTextEntry={false}
          keyboardType="number-pad"
          maxLength={maxLength}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          editable={editable}
          contextMenuHidden
          underlineColorAndroid="transparent"
          onTouchStart={onTouchStart}
        />
        {variant === "circles" ? (
          <View style={styles.circlesRow} pointerEvents="none">
            {Array.from({ length: maxLength }, (_, i) => {
              const on = i < filledCount;
              return (
                <View
                  key={i}
                  style={[
                    styles.circle,
                    {
                      borderColor: ringColor,
                      backgroundColor: on ? fillColor : "transparent",
                    },
                  ]}
                />
              );
            })}
          </View>
        ) : variant === "lines" ? (
          <View style={styles.linesRow} pointerEvents="none">
            {Array.from({ length: maxLength }, (_, i) => {
              const filled = i < filledCount;
              const active =
                editable && i === filledCount && filledCount < maxLength;
              const stroke = active ? lineActive : filled ? lineFilled : lineIdle;
              return (
                <View key={i} style={styles.lineCell}>
                  <Text
                    style={[
                      styles.lineDigit,
                      {
                        color: filled ? colors.text : colors.placeholder,
                      },
                    ]}
                  >
                    {filled ? safeDigits[i] : " "}
                  </Text>
                  <View
                    style={[
                      styles.lineStroke,
                      {
                        backgroundColor: stroke,
                        height: active ? LINE_STROKE + 1 : LINE_STROKE,
                      },
                    ]}
                  />
                </View>
              );
            })}
          </View>
        ) : (
          <Text
            style={[
              styles.mask,
              {
                color:
                  filledCount > 0
                    ? colors.text
                    : (placeholderTextColor ?? colors.placeholder),
              },
            ]}
            pointerEvents="none"
            numberOfLines={1}
            ellipsizeMode="clip"
          >
            {filledCount > 0 ? maskChar.repeat(filledCount) : emptyMask}
          </Text>
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  box: {
    justifyContent: "center",
    overflow: "hidden",
  },
  circlesBox: {
    justifyContent: "center",
    alignItems: "center",
    minHeight: 52,
    overflow: "visible",
  },
  linesBox: {
    justifyContent: "center",
    alignItems: "center",
    minHeight: 64,
    overflow: "visible",
  },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    borderWidth: 2,
    marginHorizontal: CIRCLE_GAP / 2,
  },
  mask: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 8,
    textAlign: "center",
  },
  hiddenInput: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0,
    color: "transparent",
    backgroundColor: "transparent",
    zIndex: 1,
  },
  circlesRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
    elevation: 2,
  },
  linesRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    zIndex: 2,
    elevation: 2,
  },
  lineCell: {
    width: LINE_CELL_W,
    marginHorizontal: LINE_CELL_GAP / 2,
    alignItems: "center",
  },
  lineDigit: {
    fontSize: 28,
    fontWeight: "600",
    lineHeight: 34,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
    marginBottom: 8,
  },
  lineStroke: {
    width: "100%",
    borderRadius: 1,
  },
});
