import { createStatusTextComposeStyles } from "@/components/status/statusTextComposeStyles";
import { useTheme } from "@/contexts/ThemeContext";
import { useKeyboardBottomInset } from "@/lib/keyboard/imeLift";
import {
  STATUS_TEXT_BACKGROUNDS,
  STATUS_TEXT_FONT_VARIANTS,
  statusTextFontPreviewStyle,
  type StatusTextFontVariant,
} from "@/lib/status/textStatusPalette";
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  backgroundColor: string;
  bgIndex: number;
  onSelectBgIndex: (index: number) => void;
  value: string;
  onChangeText: (text: string) => void;
  fontIndex: number;
  onSelectFontIndex: (index: number) => void;
  fontVariant: StatusTextFontVariant;
  onClose: () => void;
  onMention: () => void;
  onSend: () => void;
  sendDisabled: boolean;
  busy: boolean;
};

export function StatusTextCompose({
  backgroundColor,
  bgIndex,
  onSelectBgIndex,
  value,
  onChangeText,
  fontIndex,
  onSelectFontIndex,
  fontVariant,
  onClose,
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
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const styleRibbonOpen = fontPickerOpen || colorPickerOpen;

  const hasText = value.trim().length > 0;
  const dockBottom =
    keyboardLift > 0 ? keyboardLift : Math.max(insets.bottom, 8);
  const footerBarReserve = 72;
  const bottomReserve =
    dockBottom + (styleRibbonOpen ? 54 : 0) + footerBarReserve + 12;

  const inputStyle = useMemo(
    () => [
      styles.textInput,
      {
        fontSize: fontVariant.fontSize,
        fontWeight: fontVariant.fontWeight,
        fontStyle: fontVariant.fontStyle ?? "normal",
        fontFamily: fontVariant.fontFamily,
      },
    ],
    [fontVariant, styles.textInput],
  );

  const safeFontIndex =
    ((fontIndex % STATUS_TEXT_FONT_VARIANTS.length) +
      STATUS_TEXT_FONT_VARIANTS.length) %
    STATUS_TEXT_FONT_VARIANTS.length;
  const safeBgIndex =
    ((bgIndex % STATUS_TEXT_BACKGROUNDS.length) +
      STATUS_TEXT_BACKGROUNDS.length) %
    STATUS_TEXT_BACKGROUNDS.length;

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
            style={[
              styles.chromeCircle,
              fontPickerOpen && styles.chromeCircleActive,
            ]}
            onPress={() => {
              setFontPickerOpen((open) => !open);
              setColorPickerOpen(false);
            }}
            accessibilityRole="button"
            accessibilityLabel={t("status.textChangeFont")}
            accessibilityState={{ expanded: fontPickerOpen }}
          >
            <Text
              style={{
                color: fontPickerOpen
                  ? colors.statusAddBadgePlus
                  : colors.textInverse,
                fontSize: 15,
                fontWeight: "700",
              }}
            >
              Aa
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.chromeCircle,
              colorPickerOpen && styles.chromeCircleActive,
            ]}
            onPress={() => {
              setColorPickerOpen((open) => !open);
              setFontPickerOpen(false);
            }}
            accessibilityRole="button"
            accessibilityLabel={t("status.textChangeColor")}
            accessibilityState={{ expanded: colorPickerOpen }}
          >
            <Ionicons
              name="color-palette-outline"
              size={22}
              color={
                colorPickerOpen ? colors.statusAddBadgePlus : colors.textInverse
              }
            />
          </Pressable>
        </View>
      </View>

      <View
        style={[styles.textArea, { paddingBottom: bottomReserve }]}
        pointerEvents="box-none"
      >
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
        {fontPickerOpen ? (
          <View style={styles.fontRibbon}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.fontRibbonScroll}
            >
              {STATUS_TEXT_FONT_VARIANTS.map((variant, i) => {
                const selected = i === safeFontIndex;
                return (
                  <Pressable
                    key={i}
                    style={[
                      styles.fontChip,
                      selected && styles.fontChipSelected,
                    ]}
                    onPress={() => onSelectFontIndex(i)}
                    accessibilityRole="button"
                    accessibilityLabel={t("status.textChangeFont")}
                    accessibilityState={{ selected }}
                  >
                    <Text
                      style={statusTextFontPreviewStyle(
                        variant,
                        selected,
                        colors.textInverse,
                        colors.statusAddBadgePlus,
                      )}
                      includeFontPadding={false}
                    >
                      Aa
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}
        {colorPickerOpen ? (
          <View style={styles.fontRibbon}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.fontRibbonScroll}
            >
              {STATUS_TEXT_BACKGROUNDS.map((fill, i) => {
                const selected = i === safeBgIndex;
                return (
                  <Pressable
                    key={i}
                    style={[
                      styles.colorChip,
                      { backgroundColor: fill },
                      selected && styles.colorChipSelected,
                    ]}
                    onPress={() => onSelectBgIndex(i)}
                    accessibilityRole="button"
                    accessibilityLabel={t("status.textChangeColor")}
                    accessibilityState={{ selected }}
                  >
                    {selected ? (
                      <Ionicons
                        name="checkmark"
                        size={22}
                        color={colors.textInverse}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}
        {hasText ? (
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
        ) : null}
        <View style={styles.footerBarSlot} pointerEvents={hasText ? "auto" : "none"}>
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
      </View>
    </KeyboardAvoidingView>
  );
}
