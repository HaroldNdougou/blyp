import { createMessagesStyles } from "@/components/messages/messagesStyles";
import { PeerAvatar } from "@/components/peers/PeerAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { Conversation } from "@/lib/api/types";
import { demoAvatarUrlForPhone } from "@/lib/dev/demoProfiles";
import { contactPhotoUriForPhone } from "@/lib/contacts/contactPhotos";
import {
  consumeForwardDraft,
  peekForwardDraft,
} from "@/lib/messages/forwardDraft";
import { setForwardLandChat } from "@/lib/messages/forwardLand";
import {
  applyForwardOptimistic,
  completeForwardPlans,
  planForwardToConversations,
} from "@/lib/messages/forwardSend";
import { ApiError } from "@/lib/api/errors";
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
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ForwardMessagesScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createMessagesStyles(colors), [colors]);
  const { token, user } = useAuth();
  const ownerPhone = user?.phone ?? "";
  const myId = user?.id ?? "me";

  const draft = useMemo(() => peekForwardDraft(), []);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [sending, setSending] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    token ? sortConversationsByActivity(getConversationsSnapshot(token) ?? []) : [],
  );

  useEffect(() => {
    if (!draft) {
      router.back();
    }
  }, [draft]);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = realConversations;
    if (!q) return base;
    return base.filter((c) => {
      const name = String(c.peerName ?? "").toLowerCase();
      const phone = String(c.peerPhone ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [realConversations, search]);

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
    void completeForwardPlans(token, snapshot, plans).catch((e) => {
      const detail =
        e instanceof ApiError && e.message ? `\n\n${e.message}` : "";
      Alert.alert(t("messages.forwardFailed"), detail || undefined);
    });
  }, [token, draft, selected, sending, myId, t]);

  if (!draft) {
    return null;
  }

  const count = draft.messages.length;
  const canSend = selected.size > 0 && !sending;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.threadSelectHeader}>
        <Pressable
          style={styles.headerBtn}
          onPress={() => {
            consumeForwardDraft();
            router.back();
          }}
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
        >
          <Ionicons name="close" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.forwardHeaderTitle} numberOfLines={1}>
          {t("messages.forwardTitle")}
        </Text>
        <Pressable
          style={[
            styles.forwardSendBtn,
            !canSend && styles.forwardSendBtnDisabled,
          ]}
          onPress={() => void send()}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel={t("messages.forwardSendA11y")}
        >
          {sending ? (
            <ActivityIndicator color={colors.textInverse} size="small" />
          ) : (
            <Text style={styles.forwardSendBtnText}>{t("messages.forwardSend")}</Text>
          )}
        </Pressable>
      </View>
      <Text style={styles.forwardSubtitle}>
        {t("messages.forwardSubtitle", { count })}
      </Text>
      <View style={styles.forwardSearchWrap}>
        <Ionicons name="search" size={18} color={colors.placeholder} />
        <TextInput
          style={styles.forwardSearchInput}
          placeholder={t("messages.forwardSearchPlaceholder")}
          placeholderTextColor={colors.placeholder}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          accessibilityLabel={t("messages.forwardSearchPlaceholder")}
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const on = selected.has(item.id);
          return (
            <Pressable
              style={styles.row}
              onPress={() => toggle(item.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t("messages.forwardPickA11y", {
                name: item.peerName,
              })}
            >
              <View
                style={[styles.forwardRowCheck, on && styles.forwardRowCheckOn]}
              >
                {on ? (
                  <Ionicons name="checkmark" size={18} color={colors.textInverse} />
                ) : null}
              </View>
              <View style={styles.avatarSlot}>
                <PeerAvatar
                  name={item.peerName}
                  remoteUrl={
                    item.peerAvatarUrl ??
                    demoAvatarUrlForPhone(item.peerPhone)
                  }
                  localUri={contactPhotoUriForPhone(item.peerPhone)}
                  size={48}
                />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.peerName}
                </Text>
                {item.peerPhone ? (
                  <Text style={styles.rowPreview} numberOfLines={1}>
                    {item.peerPhone}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.forwardEmpty}>{t("messages.empty")}</Text>
        }
      />
    </SafeAreaView>
  );
}
