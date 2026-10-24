import { StatusTextCompose } from "@/components/status/StatusTextCompose";
import { createStatusStyles } from "@/components/status/statusStyles";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { StatusPost, StatusTextPostStyle } from "@/lib/api/types";
import { getStatusMyUserId, findStatusPostById } from "@/lib/status/statusCache";
import { updateMyStatusPostOnServer } from "@/lib/status/updateStatusPostClient";
import {
  STATUS_TEXT_BACKGROUNDS,
  STATUS_TEXT_FONT_VARIANTS,
  normalizeStatusTextPostStyle,
} from "@/lib/status/textStatusPalette";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect } from "@react-navigation/native";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export function StatusEditScreen() {
  const { id: rawId } = useLocalSearchParams<{ id?: string }>();
  const postId = decodeURIComponent(String(rawId ?? ""));
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStatusStyles(colors), [colors]);
  const { token } = useAuth();
  const myId = getStatusMyUserId();

  const initial = useMemo(
    () => findStatusPostById(postId),
    [postId],
  );

  const [post, setPost] = useState<StatusPost | undefined>(initial);
  const [text, setText] = useState(() => String(initial?.text ?? ""));
  const [caption, setCaption] = useState(() => String(initial?.text ?? ""));
  const [bgIndex, setBgIndex] = useState(
    () => initial?.textStyle?.bgIndex ?? 0,
  );
  const [fontIndex, setFontIndex] = useState(
    () => initial?.textStyle?.fontIndex ?? 0,
  );
  const [busy, setBusy] = useState(false);
  const captionInputRef = useRef<TextInput>(null);

  useFocusEffect(
    useCallback(() => {
      if (post?.kind !== "image") return;
      const id = setTimeout(() => captionInputRef.current?.focus(), 100);
      return () => clearTimeout(id);
    }, [post?.kind]),
  );

  useEffect(() => {
    if (!post && initial) setPost(initial);
  }, [initial, post]);

  useEffect(() => {
    if (!postId || !post) {
      router.back();
    } else if (myId && post.userId !== myId) {
      router.back();
    }
  }, [postId, post, myId]);

  const fontVariant = STATUS_TEXT_FONT_VARIANTS[fontIndex]!;
  const backgroundColor = STATUS_TEXT_BACKGROUNDS[bgIndex]!;

  const saveText = useCallback(async () => {
    if (!token || !myId || !post || busy) return;
    const body = String(text ?? "").trim();
    if (!body) {
      Alert.alert(t("status.editEmptyTextTitle"), t("status.editEmptyTextMessage"));
      return;
    }
    const textStyle: StatusTextPostStyle = normalizeStatusTextPostStyle({
      bgIndex,
      fontIndex,
    });
    setBusy(true);
    try {
      await updateMyStatusPostOnServer(token, myId, post.id, {
        text: body,
        textStyle,
      });
      router.back();
    } catch {
      Alert.alert(t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }, [token, myId, post, busy, text, bgIndex, fontIndex, t]);

  const saveCaption = useCallback(async () => {
    if (!token || !myId || !post || busy) return;
    setBusy(true);
    try {
      await updateMyStatusPostOnServer(token, myId, post.id, {
        text: caption.trim() || null,
      });
      router.back();
    } catch {
      Alert.alert(t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }, [token, myId, post, busy, caption, t]);

  if (!post) return null;

  if (post.kind === "text") {
    return (
      <View style={{ flex: 1, backgroundColor }}>
        <StatusTextCompose
          backgroundColor={backgroundColor}
          bgIndex={bgIndex}
          onSelectBgIndex={setBgIndex}
          value={text}
          onChangeText={setText}
          fontIndex={fontIndex}
          onSelectFontIndex={setFontIndex}
          fontVariant={fontVariant}
          onClose={() => router.back()}
          onMention={() =>
            Alert.alert(t("status.comingSoonTitle"), t("status.comingSoonMessage"))
          }
          onSend={() => void saveText()}
          sendDisabled={!text.trim() || busy}
          busy={busy}
        />
      </View>
    );
  }

  return (
    <SafeAreaView
      style={[styles.viewerRoot, { backgroundColor: colors.statusViewerBackground }]}
    >
      <View style={styles.viewerHeader}>
        <Pressable
          onPress={() => router.back()}
          style={styles.viewerHeaderIconBtn}
          accessibilityLabel={t("common.back")}
        >
          <Ionicons name="chevron-back" size={28} color={colors.textInverse} />
        </Pressable>
        <Text style={[styles.viewerName, { flex: 1 }]} numberOfLines={1}>
          {t("status.editTitle")}
        </Text>
        <Pressable
          onPress={() => void saveCaption()}
          disabled={busy}
          style={styles.viewerHeaderIconBtn}
          accessibilityLabel={t("status.editSaveA11y")}
        >
          {busy ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <Ionicons name="checkmark" size={26} color={colors.accent} />
          )}
        </Pressable>
      </View>
      {post.mediaUrl ? (
        <Image
          source={{ uri: post.mediaUrl }}
          style={styles.viewerMedia}
          contentFit="contain"
        />
      ) : null}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.editCaptionBar}
      >
        <TextInput
          ref={captionInputRef}
          style={[
            styles.editCaptionInput,
            { color: colors.textInverse, borderColor: colors.borderLight },
          ]}
          placeholder={t("status.captionPlaceholder")}
          placeholderTextColor={colors.placeholder}
          value={caption}
          onChangeText={setCaption}
          multiline
          autoFocus
          showSoftInputOnFocus
          accessibilityLabel={t("status.captionPlaceholder")}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
