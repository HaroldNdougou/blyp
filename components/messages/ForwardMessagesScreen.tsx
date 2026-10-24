import { createMessagesStyles } from "@/components/messages/messagesStyles";
import { PeerAvatar } from "@/components/peers/PeerAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { ChatMessage, Conversation } from "@/lib/api/types";
import { demoAvatarUrlForPhone } from "@/lib/dev/demoProfiles";
import { contactPhotoUriForPhone } from "@/lib/contacts/contactPhotos";
import {
  consumeForwardDraft,
  peekForwardDraft,
} from "@/lib/messages/forwardDraft";
import { setForwardLandChat } from "@/lib/messages/forwardLand";
import { buildForwardPickerSections } from "@/lib/messages/forwardPickerSections";
import {
  applyForwardOptimistic,
  completeForwardPlans,
  planForwardToConversations,
} from "@/lib/messages/forwardSend";
import { ApiError } from "@/lib/api/errors";
import {
  startRegularRecipientsEngine,
  subscribeRegularRecipients,
} from "@/lib/pay/regularRecipients";
import {
  getConversationsSnapshot,
  hydrateMessagesCache,
  isDemoConversationId,
  sortConversationsByActivity,
} from "@/lib/messagesCache";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SectionList,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

function previewIconForMessage(
  msg: ChatMessage | undefined,
): keyof typeof Ionicons.glyphMap {
  if (!msg) return "document-text-outline";
  if (msg.type === "image") return "image-outline";
  if (msg.type === "voice") return "mic-outline";
  if (msg.type === "document") return "document-outline";
  return "document-text-outline";
}

function rowSubtitle(c: Conversation): string {
  const preview = String(c.lastMessagePreview ?? "").trim();
  if (preview) return preview;
  return String(c.peerPhone ?? "").trim();
}

export default function ForwardMessagesScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createMessagesStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const ownerPhone = user?.phone ?? "";
  const myId = user?.id ?? "me";

  const draft = useMemo(() => peekForwardDraft(), []);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [sending, setSending] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    token ? sortConversationsByActivity(getConversationsSnapshot(token) ?? []) : [],
  );
  const [, recipTick] = useState(0);
  void recipTick;

  useEffect(() => {
    if (!draft) {
      router.back();
    }
  }, [draft]);

  useEffect(() => {
    if (!ownerPhone) return;
    return startRegularRecipientsEngine(ownerPhone);
  }, [ownerPhone]);

  useEffect(() => subscribeRegularRecipients(() => setRecipTick((n) => n + 1)), []);

  useEffect(() => {
    if (!token || !ownerPhone) return;
    void hydrateMessagesCache(ownerPhone, token).then(() => {
      setConversations(
        sortConversationsByActivity(getConversationsSnapshot(token) ?? []),
      );
    });
  }, [token, ownerPhone]);

  const realConversations = useMemo(
    () => conversations.filter((c) => !isDemoConversationId(c.id)),
    [conversations],
  );

  const { frequent, recent } = useMemo(
    () => buildForwardPickerSections(realConversations, search),
    [realConversations, search],
  );

  const sections = useMemo(() => {
    const out: { title: string; data: Conversation[] }[] = [];
    if (frequent.length > 0) {
      out.push({
        title: t("messages.forwardSectionFrequent"),
        data: frequent,
      });
    }
    if (recent.length > 0) {
      out.push({
        title: t("messages.forwardSectionRecent"),
        data: recent,
      });
    }
    return out;
  }, [frequent, recent, t]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const send = useCallback(() => {
    if (!token || !draft || selected.size === 0 || sending) return;
    if (isDemoConversationId(draft.sourceConversationId)) {
      Alert.alert(t("messages.forwardFailed"));
      return;
    }
    const targets = [...selected].filter((id) => !isDemoConversationId(id));
    if (!targets.length) return;
    setSending(true);
    const snapshot = {
      sourceConversationId: draft.sourceConversationId,
      messages: draft.messages,
    };
    const plans = planForwardToConversations(myId, snapshot, targets);
    applyForwardOptimistic(token, plans);
    consumeForwardDraft();
    const landChatId = targets[targets.length - 1]!;
    setForwardLandChat(landChatId);
    router.replace({
      pathname: "/chat/[id]",
      params: { id: landChatId },
    });
    void completeForwardPlans(token, snapshot, plans)
      .catch((e) => {
        const detail =
          e instanceof ApiError && e.message ? `\n\n${e.message}` : "";
        Alert.alert(t("messages.forwardFailed"), detail || undefined);
      })
      .finally(() => setSending(false));
    void caption;
  }, [token, draft, selected, sending, myId, t, caption]);

  const close = useCallback(() => {
    consumeForwardDraft();
    router.back();
  }, []);

  const renderRow = useCallback(
    ({ item }: { item: Conversation }) => {
      const on = selected.has(item.id);
      return (
        <Pressable
          style={styles.forwardRow}
          onPress={() => toggle(item.id)}
          accessibilityRole="button"
          accessibilityState={{ selected: on }}
          accessibilityLabel={t("messages.forwardPickA11y", {
            name: item.peerName,
          })}
        >
          <PeerAvatar
            name={item.peerName}
            remoteUrl={
              item.peerAvatarUrl ?? demoAvatarUrlForPhone(item.peerPhone)
            }
            localUri={contactPhotoUriForPhone(item.peerPhone)}
            size={48}
          />
          <View style={styles.forwardRowBody}>
            <Text style={styles.forwardRowTitle} numberOfLines={1}>
              {item.peerName}
            </Text>
            <Text style={styles.forwardRowSubtitle} numberOfLines={1}>
              {rowSubtitle(item)}
            </Text>
          </View>
          <View style={[styles.forwardRowRadio, on && styles.forwardRowRadioOn]}>
            {on ? (
              <Ionicons name="checkmark" size={16} color={colors.textInverse} />
            ) : null}
          </View>
        </Pressable>
      );
    },
    [selected, styles, colors.textInverse, t, toggle],
  );

  if (!draft) {
    return null;
  }

  const canSend = selected.size > 0 && !sending;
  const firstMsg = draft.messages[0];
  const previewIcon = previewIconForMessage(firstMsg);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.forwardHeader}>
        <Pressable
          style={styles.headerBtn}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.forwardHeaderTitle} numberOfLines={1}>
          {t("messages.forwardToTitle")}
        </Text>
        <Pressable
          style={styles.headerBtn}
          onPress={() => router.push("/new-chat")}
          accessibilityRole="button"
          accessibilityLabel={t("messages.forwardNewChatA11y")}
        >
          <Ionicons name="person-add-outline" size={22} color={colors.text} />
        </Pressable>
        <Pressable
          style={styles.headerBtn}
          onPress={() => setSearchOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={t("messages.forwardToggleSearchA11y")}
        >
          <Ionicons name="search" size={22} color={colors.text} />
        </Pressable>
      </View>
      {searchOpen ? (
        <View style={styles.forwardSearchWrap}>
          <Ionicons name="search" size={18} color={colors.placeholder} />
          <TextInput
            style={styles.forwardSearchInput}
            placeholder={t("messages.forwardSearchPlaceholder")}
            placeholderTextColor={colors.placeholder}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoFocus
            accessibilityLabel={t("messages.forwardSearchPlaceholder")}
          />
        </View>
      ) : null}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top + 8}
      >
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderRow}
          renderSectionHeader={({ section: { title } }) => (
            <Text style={styles.forwardSectionHeader}>{title}</Text>
          )}
          keyboardShouldPersistTaps="handled"
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: 12 }}
          ListEmptyComponent={
            <Text style={styles.forwardEmpty}>{t("messages.empty")}</Text>
          }
        />
        <View
          style={[
            styles.forwardBottomBar,
            { paddingBottom: Math.max(insets.bottom, 10) },
          ]}
        >
          <View style={styles.forwardPreviewThumb}>
            <Ionicons name={previewIcon} size={22} color={colors.textMuted} />
          </View>
          <View style={styles.forwardCaptionWrap}>
            <TextInput
              style={styles.forwardCaptionInput}
              placeholder={t("messages.forwardAddMessagePlaceholder")}
              placeholderTextColor={colors.placeholder}
              value={caption}
              onChangeText={setCaption}
              multiline
              accessibilityLabel={t("messages.forwardAddMessagePlaceholder")}
              onSubmitEditing={() => {
                if (canSend) send();
              }}
            />
            {canSend ? (
              <Pressable
                style={styles.forwardCaptionSend}
                onPress={() => send()}
                accessibilityRole="button"
                accessibilityLabel={t("messages.forwardSendA11y")}
              >
                {sending ? (
                  <ActivityIndicator color={colors.accent} size="small" />
                ) : (
                  <Ionicons name="send" size={22} color={colors.accent} />
                )}
              </Pressable>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
