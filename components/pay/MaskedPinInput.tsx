/**
 * Code PIN / OTP sans flash : TextInput invisible + masque React.
 * - text : • classiques
 * - circles : ronds style iPhone (anneau vide → point plein)
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
  /** `circles` = UI type code iPhone. */
  variant?: "text" | "circles";
  /** Bordure / anneau en erreur (variant circles). */
  error?: boolean;
  style?: StyleProp<ViewStyle | TextStyle>;
};

const CIRCLE = 16;
const CIRCLE_GAP = 18;

export const MaskedPinInput = forwardRef<TextInputType, Props>(
  function MaskedPinInput(
    {
      digits,
      onDigitsChange,
      maxLength,
      maskChar = "•",
      variant = "text",
      error = false,
      style,
      placeholder,
      placeholderTextColor,
      editable = true,
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

    return (
      <View
        style={[
          variant === "circles" ? styles.circlesBox : styles.box,
          style as StyleProp<ViewStyle>,
        ]}
      >
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
        />
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
  circlesRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
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
  },
});
