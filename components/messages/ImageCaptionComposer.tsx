import type { ThemeColors } from "@/lib/theme/colors";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

export type PendingImageAsset = {
  uri: string;
  width: number;
  height: number;
  contentType: string;
};

type ComposerStyles = {
  composerInput: StyleProp<TextStyle>;
  sendBtn: StyleProp<ViewStyle>;
};

type Props = {
  assets: PendingImageAsset[];
  colors: ThemeColors;
  styles: ComposerStyles;
  onCancel: () => void;
  onSend: (caption: string) => void;
};

const THUMB = 44;

/** Barre légende + miniature (style WhatsApp), dans le composer du fil. */
export function ImageCaptionComposer({
  assets,
  colors,
  styles,
  onCancel,
  onSend,
}: Props) {
  const { t } = useTranslation();
  const [caption, setCaption] = useState("");
  const inputRef = useRef<TextInput>(null);
  const local = useMemo(() => createLocalStyles(colors), [colors]);

  useEffect(() => {
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(focusTimer);
  }, []);

  const first = assets[0];
  const extra = assets.length > 1 ? assets.length - 1 : 0;

  const handleSend = () => {
    onSend(caption.trim());
    setCaption("");
  };

  if (!first) return null;

  return (
    <View style={local.row}>
      <View style={local.thumbWrap}>
        <Image
          source={{ uri: first.uri }}
          style={local.thumb}
          contentFit="cover"
        />
        {extra > 0 ? (
          <View style={local.countBadge}>
            <Text style={local.countText}>+{extra}</Text>
          </View>
        ) : null}
        <Pressable
          style={local.thumbDismiss}
          onPress={onCancel}
          hitSlop={6}
          accessibilityLabel={t("common.cancel")}
        >
          <Ionicons name="close" size={14} color={colors.textInverse} />
        </Pressable>
      </View>
      <TextInput
        ref={inputRef}
        style={[styles.composerInput, local.captionInput]}
        placeholder={t("messages.imageCaptionPlaceholder")}
        placeholderTextColor={colors.placeholder}
        value={caption}
        onChangeText={setCaption}
        multiline
        maxLength={2000}
      />
      <Pressable
        style={styles.sendBtn}
        onPress={handleSend}
        accessibilityLabel={t("messages.send")}
      >
        <Ionicons name="send" size={18} color={colors.accentOn} />
      </Pressable>
    </View>
  );
}

function createLocalStyles(c: ThemeColors) {
  return StyleSheet.create({
    row: {
      flex: 1,
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 6,
      minHeight: 42,
    },
    thumbWrap: {
      width: THUMB,
      height: THUMB,
      marginBottom: 2,
      marginLeft: 4,
    },
    thumb: {
      width: THUMB,
      height: THUMB,
      borderRadius: 8,
      backgroundColor: c.borderLight,
    },
    thumbDismiss: {
      position: "absolute",
      top: -4,
      right: -4,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: c.overlay,
      alignItems: "center",
      justifyContent: "center",
    },
    countBadge: {
      position: "absolute",
      bottom: 2,
      right: 2,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 6,
      backgroundColor: c.overlay,
    },
    countText: {
      fontSize: 10,
      fontWeight: "700",
      color: c.textInverse,
    },
    captionInput: {
      flex: 1,
      minHeight: 40,
      maxHeight: 100,
      paddingVertical: 8,
    },
  });
}
