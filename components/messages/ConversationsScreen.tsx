import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { getAccessToken } from "@/lib/auth/authSession";
import { formatConversationWhen } from "@/lib/format";
import { formatFcfa } from "@/lib/formatFcfa";
import {
  conversationsEqual,
  getConversationsSnapshot,
  hydrateMessagesCache,
  setConversationsSnapshot,
} from "@/lib/messagesCache";
import {
  getTypingSnapshot,
  subscribeConversationTyping,
  subscribeConversationReceipt,
  subscribeIncomingMessage,
  subscribeMessageDeleted,
} from "@/lib/messages/live";
import { parseReactionListPreview } from "@/lib/messages/reactionSync";
import { getUnread, subscribeUnread } from "@/lib/messages/unread";
import type { Conversation } from "@/lib/api/types";
import { demoAvatarUrlForPhone } from "@/lib/dev/demoProfiles";
import { contactPhotoUriForPhone } from "@/lib/contacts/contactPhotos";
import { PeerAvatar } from "@/components/peers/PeerAvatar";
import {
  DeletedMessageTick,
  MessageTicks,
} from "@/components/messages/MessageTicks";
import {
  lastDeletedMessageInThread,
  messageFromSelf,
} from "@/lib/messages/deletedListPreview";
import { createMessagesStyles } from "@/components/messages/messagesStyles";
import { accessTokenSubject } from "@/lib/auth/accessTokenSubject";
import { DocumentListGlyph } from "@/components/messages/DocumentListGlyph";
import { documentNameFromListPreview } from "@/lib/document/kind";
import { previewTickForConversation } from "@/lib/messages/previewTicks";
import { prefetchChatThreadOnPressIn } from "@/lib/messages/prefetchChatThread";
import { perfMarkEnd, perfMarkStart } from "@/lib/perf/marks";
import type { ThemeColors } from "@/lib/theme/colors";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  InteractionManager,
  Pressable,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type ConversationRowProps = {
  item: Conversation;
  styles: ReturnType<typeof createMessagesStyles>;
  colors: ThemeColors;
  myId: string;
  unread: number;
  typing: boolean;
  previewTick: "sent" | "delivered" | "read" | null;
  previewDeleted: boolean;
  previewText: string;
  previewDocumentIcon: boolean;
  onOpen: (id: string) => void;
  onPressIn: (id: string) => void;
  unreadLabel: string;
};

const ConversationRow = React.memo(function ConversationRow({
  item,
  styles,
  colors,
  unread,
  typing,
  previewTick,
  previewDeleted,
  previewText,
  previewDocumentIcon,
  onOpen,
  onPressIn,
  unreadLabel,
}: ConversationRowProps) {
  const previewStyle = typing
    ? styles.rowPreviewTyping
    : unread > 0
      ? styles.rowPreviewUnread
      : styles.rowPreview;

  return (
    <Pressable
      style={styles.row}
      android_ripple={{ color: colors.borderLight }}
      onPressIn={() => onPressIn(item.id)}
      onPress={() => onOpen(item.id)}
    >
      <PeerAvatar
        name={item.peerName}
        phone={item.peerPhone}
        remoteUrl={
          item.peerAvatarUrl ?? demoAvatarUrlForPhone(item.peerPhone)
        }
        localUri={contactPhotoUriForPhone(item.peerPhone)}
        size={48}
        style={styles.avatarSlot}
        recyclingKey={item.id}
      />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.peerName}
        </Text>
        <View style={styles.rowPreviewLine}>
          {previewDeleted ? (
            <DeletedMessageTick compact color={colors.tickSent} />
          ) : previewTick ? (
            <MessageTicks
              compact
              color={
                previewTick === "read" ? colors.tickRead : colors.tickSent
              }
              double={
                previewTick === "delivered" || previewTick === "read"
              }
            />
          ) : null}
          {previewDocumentIcon && !previewDeleted ? (
            <DocumentListGlyph
              color={unread > 0 ? colors.text : colors.textMuted}
              style={styles.rowDocumentGlyph}
            />
          ) : null}
          <Text
            style={[
              previewStyle,
              styles.rowPreviewText,
              previewDeleted && { fontStyle: "italic" },
            ]}
            numberOfLines={1}
          >
            {previewText}
          </Text>
        </View>
      </View>
      <View style={styles.rowAside}>
        {item.lastMessageAt ? (
          <Text style={styles.rowTime}>
            {formatConversationWhen(item.lastMessageAt)}
          </Text>
        ) : null}
        {unread > 0 ? (
          <View
            style={[styles.unreadBadge, styles.unreadBadgeSpaced]}
            accessibilityLabel={unreadLabel}
          >
            <Text style={styles.unreadBadgeText}>
              {unread > 99 ? "99+" : String(unread)}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

export default function ConversationsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createMessagesStyles(colors), [colors]);
  const { token, user } = useAuth();
  const ownerPhone = user?.phone ?? "";
  const cachedInit = token ? getConversationsSnapshot(token) : null;
  const [items, setItems] = useState<Conversation[]>(cachedInit ?? []);
  const [loading, setLoading] = useState(!cachedInit);
  const [unreadTick, setUnreadTick] = useState(0);
  const [typingTick, setTypingTick] = useState(0);
  const [receiptTick, setReceiptTick] = useState(0);
  const [threadTick, setThreadTick] = useState(0);
  const myId = useMemo(() => accessTokenSubject(token), [token]);

  useEffect(() => subscribeUnread(() => setUnreadTick((n) => n + 1)), []);
  useEffect(
    () => subscribeConversationReceipt(() => setReceiptTick((n) => n + 1)),
    [],
  );
  useEffect(
    () => subscribeConversationTyping(() => setTypingTick((n) => n + 1)),
    [],
  );
  useEffect(
    () => subscribeMessageDeleted(() => setThreadTick((n) => n + 1)),
    [],
  );

  useEffect(() => {
    if (!token) return;
    return subscribeIncomingMessage(() => {
      const snap = getConversationsSnapshot(token);
      if (snap) {
        setItems((prev) => (conversationsEqual(prev, snap) ? prev : snap));
      }
      InteractionManager.runAfterInteractions(() => {
        void (async () => {
          try {
            const { ensureSessionFresh, listConversations } = await import(
              "@/lib/api/client"
            );
            await ensureSessionFresh();
            const access = getAccessToken();
            if (!access) return;
            const { items: next } = await listConversations(access);
            setConversationsSnapshot(access, next);
            const stored = getConversationsSnapshot(access) ?? next;
            setItems((prev) =>
              conversationsEqual(prev, stored) ? prev : stored,
            );
          } catch {
            /* garde la liste déjà affichée */
          }
        })();
      });
    });
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      perfMarkStart("tab_messages");
      const endMark = () => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => perfMarkEnd("tab_messages"));
        });
      };
      void import("@/lib/messages/chatEmojiCatalog").then((m) =>
        m.loadChatEmojiCategories(),
      );
      if (!token) {
        setItems([]);
        setLoading(false);
        endMark();
        return;
      }
      let cancelled = false;
      const applyLocal = (list: Conversation[] | null) => {
        if (!list) return false;
        setItems((prev) => (conversationsEqual(prev, list) ? prev : list));
        setLoading(false);
        endMark();
        return true;
      };
      if (!applyLocal(getConversationsSnapshot(token))) {
        void (async () => {
          if (ownerPhone) {
            await hydrateMessagesCache(ownerPhone, token);
            if (cancelled) return;
            if (applyLocal(getConversationsSnapshot(token))) return;
          }
          if (!cancelled) setLoading(true);
        })();
      }
      const syncNet = () => {
        void (async () => {
          try {
            const { ensureSessionFresh, listConversations } = await import(
              "@/lib/api/client"
            );
            await ensureSessionFresh();
            const access = getAccessToken();
            if (!access || cancelled) return;
            const { items: next } = await listConversations(access);
            if (cancelled) return;
            setConversationsSnapshot(access, next);
            const stored = getConversationsSnapshot(access) ?? next;
            setItems((prev) =>
              conversationsEqual(prev, stored) ? prev : stored,
            );
          } catch {
            // hors-ligne : on garde la copie locale
          } finally {
            if (!cancelled) {
              setLoading(false);
              endMark();
            }
          }
        })();
      };
      InteractionManager.runAfterInteractions(syncNet);
      return () => {
        cancelled = true;
      };
    }, [token, ownerPhone]),
  );

  const previewFor = useCallback(
    (c: Conversation) => {
    const typing = getTypingSnapshot(c.id);
    if (typing) {
      const name =
        (c.peerName || "").trim().split(/\s+/)[0] || t("messages.someone");
      return t("messages.typing", { name });
    }
    if (token) {
      const tomb = lastDeletedMessageInThread(token, c.id);
      if (tomb) {
        return messageFromSelf(tomb, myId)
          ? t("messages.deletedForAllMine")
          : t("messages.deletedForAllTheirs");
      }
    }
    if (c.lastMessageType === "voice") {
      return t("messages.voicePreview");
    }
    if (c.lastMessageType === "image") {
      const p = String(c.lastMessagePreview ?? "").trim();
      if (p && p !== "IMAGE" && p !== "📷") return p;
      return t("messages.imagePreview");
    }
    if (c.lastMessageType === "document") {
      const p = String(c.lastMessagePreview ?? "").trim();
      if (p && !p.startsWith("📄")) return p;
      const name = documentNameFromListPreview(p);
      if (name) return name;
      return t("messages.documentPreview");
    }
    if (c.lastMessageType === "reaction") {
      const { mine, emoji } = parseReactionListPreview(c.lastMessagePreview);
      if (!emoji) return t("messages.reactionPreviewBare");
      if (mine) return t("messages.reactionPreviewYou", { emoji });
      return t("messages.reactionPreview", { emoji });
    }
    if (c.lastMessageType === "money") {
      const p = String(c.lastMessagePreview ?? "").trim();
      if (p && /[A-Za-zÀ-ÿ]/.test(p)) return p;
      const n = parseInt(p.replace(/\D/g, ""), 10);
      if (Number.isFinite(n) && n > 0) {
        return t("messages.moneyPreview", { amount: formatFcfa(n) });
      }
      if (p) return p;
    }
    return c.lastMessagePreview || t("messages.emptyHint");
  },
    [t, token, myId],
  );

  const openChat = useCallback((id: string) => {
    router.push(`/chat/${encodeURIComponent(id)}` as const);
  }, []);

  const warmChatOnPressIn = useCallback(
    (id: string) => {
      if (!token || !ownerPhone) return;
      prefetchChatThreadOnPressIn({
        conversationId: id,
        phone: ownerPhone,
        token,
      });
    },
    [token, ownerPhone],
  );

  useFocusEffect(
    useCallback(() => {
      void import("@/lib/image/pickFromLibrary").then((m) =>
        m.warmImageLibraryPermission(),
      );
    }, []),
  );

  if (!token) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <View style={styles.header}>
          <Text style={styles.title}>{t("messages.title")}</Text>
        </View>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>{t("messages.signInRequired")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("messages.title")}</Text>
        <Pressable
          style={styles.headerBtn}
          onPress={() => router.push("/new-chat")}
          accessibilityLabel={t("messages.newChat")}
        >
          <Ionicons name="create-outline" size={24} color={colors.accent} />
        </Pressable>
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>{t("messages.empty")}</Text>
          <Text style={styles.emptyHint}>{t("messages.emptyHint")}</Text>
        </View>
      ) : (
        <FlatList
          extraData={`${unreadTick}|${typingTick}|${receiptTick}|${threadTick}`}
          data={items}
          keyExtractor={(c) => c.id}
          initialNumToRender={12}
          windowSize={7}
          renderItem={({ item }) => {
            const unread = getUnread(item.id);
            const typing = Boolean(getTypingSnapshot(item.id));
            const previewDeleted =
              Boolean(token && lastDeletedMessageInThread(token, item.id));
            const previewTick =
              !typing && !previewDeleted && token
                ? previewTickForConversation(item, token, myId)
                : null;
            return (
              <ConversationRow
                item={item}
                styles={styles}
                colors={colors}
                myId={myId}
                unread={unread}
                typing={typing}
                previewTick={previewTick}
                previewDeleted={previewDeleted}
                previewText={previewFor(item)}
                previewDocumentIcon={
                  !typing &&
                  item.lastMessageType === "document" &&
                  !(
                    token && lastDeletedMessageInThread(token, item.id)
                  )
                }
                onOpen={openChat}
                onPressIn={warmChatOnPressIn}
                unreadLabel={t("messages.unreadCount", { count: unread })}
              />
            );
          }}
        />
      )}

    </SafeAreaView>
  );
}
