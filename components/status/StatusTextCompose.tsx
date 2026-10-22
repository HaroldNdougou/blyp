import { createStatusTextComposeStyles } from "@/components/status/statusTextComposeStyles";
import { useTheme } from "@/contexts/ThemeContext";
import { useKeyboardBottomInset } from "@/lib/keyboard/imeLift";
import type { StatusTextFontVariant } from "@/lib/status/textStatusPalette";
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  backgroundColor: string;
  value: string;
  onChangeText: (text: string) => void;
  fontVariant: StatusTextFontVariant;
  onClose: () => void;
  onCycleFont: () => void;
  onCycleBackground: () => void;
  onMention: () => void;
  onSend: () => void;
  sendDisabled: boolean;
  busy: boolean;
};

export function StatusTextCompose({
  backgroundColor,
  value,
  onChangeText,
  fontVariant,
  onClose,
  onCycleFont,
  onCycleBackground,
  onMention,
  onSend,
  sendDisabled,
  busy,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStatusTextComposeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const keyboardLift = useKeyboardBottomInset(true);

  const hasText = value.trim().length > 0;
  const dockBottom =
    keyboardLift > 0 ? keyboardLift : Math.max(insets.bottom, 8);
  const textVerticalBias = 96;
  const textBottomPad =
    24 +
    textVerticalBias +
    (keyboardLift > 0 ? keyboardLift : Math.max(insets.bottom, 8));

  const inputStyle = useMemo(
    () => [
      styles.textInput,
      {
        fontSize: fontVariant.fontSize,
        fontWeight: fontVariant.fontWeight,
        fontStyle: fontVariant.fontStyle ?? "normal",
      },
    ],
    [fontVariant, styles.textInput],
  );

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
    >
      <View style={[styles.topBar, { paddingTop: insets.top + 4 }]}>
        <Pressable
          style={styles.chromeCircle}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
        >
          <Ionicons name="close" size={24} color={colors.textInverse} />
        </Pressable>
        <View style={styles.topBarRight}>
          <Pressable
            style={styles.chromeCircle}
            onPress={onCycleFont}
            accessibilityRole="button"
            accessibilityLabel={t("status.textChangeFont")}
          >
            <Text
              style={{
                color: colors.textInverse,
                fontSize: 15,
                fontWeight: "700",
              }}
            >
              Aa
            </Text>
          </Pressable>
          <Pressable
            style={styles.chromeCircle}
            onPress={onCycleBackground}
            accessibilityRole="button"
            accessibilityLabel={t("status.textChangeColor")}
          >
            <Ionicons
              name="color-palette-outline"
              size={22}
              color={colors.textInverse}
            />
          </Pressable>
        </View>
      </View>

      <View style={[styles.textArea, { paddingBottom: textBottomPad }]}>
        <TextInput
          style={inputStyle}
          placeholder={t("status.textPlaceholder")}
          placeholderTextColor="rgba(255,255,255,0.55)"
          value={value}
          onChangeText={onChangeText}
          multiline
          maxLength={700}
          autoFocus
          textAlignVertical="center"
        />
      </View>

      <View style={[styles.bottomDock, { bottom: dockBottom }]}>
        <Pressable
          style={styles.mentionFab}
          onPress={onMention}
          accessibilityRole="button"
          accessibilityLabel={t("status.textMention")}
        >
          <Text
            style={{
              color: colors.textInverse,
              fontSize: 20,
              fontWeight: "700",
            }}
          >
            @
          </Text>
        </Pressable>
        {hasText ? (
          <View style={styles.footerBar}>
            <View style={styles.audiencePill}>
              <Ionicons
                name="eye-outline"
                size={18}
                color={colors.textSecondary}
              />
              <Text style={styles.audienceLabel} numberOfLines={1}>
                {t("status.textAudience")}
              </Text>
            </View>
            <Pressable
              style={[
                styles.sendButton,
                sendDisabled && styles.sendButtonDisabled,
              ]}
              onPress={onSend}
              disabled={sendDisabled || busy}
              accessibilityRole="button"
              accessibilityLabel={t("status.textSend")}
            >
              {busy ? (
                <ActivityIndicator color={colors.accentOn} />
              ) : (
                <Ionicons name="send" size={22} color={colors.accentOn} />
              )}
            </Pressable>
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}
