import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { getAccessToken } from "@/lib/auth/authSession";
import { formatConversationWhen } from "@/lib/format";
import { formatFcfa } from "@/lib/formatFcfa";
import {
  conversationsEqual,
  getConversationsSnapshot,
  getMessagesSnapshot,
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
  PeerAvatarLightbox,
  type PeerAvatarLightboxTarget,
} from "@/components/peers/PeerAvatarLightbox";
import {
  DeletedMessageTick,
  MessageTicks,
} from "@/components/messages/MessageTicks";
import { Ionicons } from "@expo/vector-icons";
import { displayListPreviewForMessage } from "@/lib/messages/conversationListPreview";
import {
  lastDeletedMessageInThread,
  lastMessageInThread,
  messageFromSelf,
} from "@/lib/messages/deletedListPreview";
import { createMessagesStyles } from "@/components/messages/messagesStyles";
import { accessTokenSubject } from "@/lib/auth/accessTokenSubject";
import { DocumentListGlyph } from "@/components/messages/DocumentListGlyph";
import { documentNameFromListPreview } from "@/lib/document/kind";
import { previewTickForConversation } from "@/lib/messages/previewTicks";
import {
  markConversationsListPulled,
  shouldPullConversationsList,
} from "@/lib/messages/conversationsListGate";
import {
  markChatOpenOnNavigate,
  prefetchChatThreadOnPressIn,
} from "@/lib/messages/prefetchChatThread";
import { ActusPanel } from "@/components/status/ActusPanel";
import { CountBadge } from "@/components/ui/CountBadge";
import { StatusRing } from "@/components/status/StatusRing";
import {
  applyStatusFeedSnapshot,
  peerStatusRingVariantForConversation,
  peerStatusUserIdForConversation,
  countUnseenPeerStatuses,
  statusFeedHasPeerPosts,
  statusViewStartIndex,
  subscribeStatusFeed,
} from "@/lib/status/statusCache";
import {
  applyDemoStatusFeedNow,
  syncStatusFeedFromNetwork,
} from "@/lib/status/statusSync";
import {
  DEV_BACKGROUND_BOOT_MS,
  DEV_METRO_LITE,
  runAfterDevBackgroundBoot,
} from "@/lib/perf/devMetroLite";
import { runAggressiveWarm } from "@/lib/perf/aggressiveWarm";
import { perfMarkEnd, perfMarkStart } from "@/lib/perf/marks";
import { useMarkRootShellReady } from "@/lib/rootShellReady";
import type { ThemeColors } from "@/lib/theme/colors";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  InteractionManager,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

type ConversationRowProps = {
  item: Conversation;
  styles: ReturnType<typeof createMessagesStyles>;
  colors: ThemeColors;
  myId: string;
  unread: number;
  typing: boolean;
  previewTick: "sending" | "sent" | "delivered" | "read" | null;
  previewDeleted: boolean;
  previewText: string;
  previewDocumentIcon: boolean;
  onOpen: (id: string) => void;
  onPressIn: (id: string) => void;
  onAvatarPress: (item: Conversation, ring: "unseen" | "seen" | "none") => void;
  unreadLabel: string;
  peerStatusRing: "unseen" | "seen" | "none";
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
  onAvatarPress,
  unreadLabel,
  peerStatusRing,
}: ConversationRowProps) {
  const { t } = useTranslation();
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
      <Pressable
        onPress={() => onAvatarPress(item, peerStatusRing)}
        accessibilityLabel={
          peerStatusRing === "none"
            ? t("messages.peerPhotoOpenA11y", { name: item.peerName })
            : t("status.openPeerA11y", { name: item.peerName })
        }
        accessibilityRole="button"
      >
        <StatusRing
          colors={colors}
          variant={peerStatusRing}
          style={styles.avatarSlot}
        >
          <PeerAvatar
            name={item.peerName}
            phone={item.peerPhone}
            remoteUrl={
              item.peerAvatarUrl ?? demoAvatarUrlForPhone(item.peerPhone)
            }
            localUri={contactPhotoUriForPhone(item.peerPhone)}
            size={48}
            recyclingKey={item.id}
          />
        </StatusRing>
      </Pressable>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.peerName}
        </Text>
        <View style={styles.rowPreviewLine}>
          {previewDeleted ? (
            <DeletedMessageTick compact color={colors.tickSent} />
          ) : previewTick === "sending" ? (
            <View
              style={{
                width: 16,
                height: 15,
                marginRight: 4,
                alignItems: "center",
                justifyContent: "center",
              }}
              accessibilityLabel={t("messages.sendingA11y")}
              accessibilityRole="image"
            >
              <Ionicons
                name="time-outline"
                size={14}
                color={colors.tickSent}
                style={{ opacity: 0.72 }}
              />
            </View>
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
  const { token, user, isLoading: authLoading } = useAuth();
  useMarkRootShellReady();
  const ownerPhone = user?.phone ?? "";
  const cachedInit = token ? getConversationsSnapshot(token) : null;
  const [items, setItems] = useState<Conversation[]>(cachedInit ?? []);
  const [loading, setLoading] = useState(!cachedInit);
  const [unreadTick, setUnreadTick] = useState(0);
  const [typingTick, setTypingTick] = useState(0);
  const [receiptTick, setReceiptTick] = useState(0);
  const [statusTick, setStatusTick] = useState(0);
  const [inboxPage, setInboxPage] = useState(0);
  const inboxPagerRef = useRef<ScrollView>(null);
  const { width: pageWidth } = useWindowDimensions();
  const inboxScrollX = useSharedValue(0);
  const inboxTabRowWidth = useSharedValue(0);
  const inboxPageWidth = useSharedValue(pageWidth);

  useEffect(() => {
    inboxPageWidth.value = pageWidth;
  }, [pageWidth, inboxPageWidth]);

  const onInboxTabRowLayout = useCallback(
    (w: number) => {
      if (w > 0) inboxTabRowWidth.value = w;
    },
    [inboxTabRowWidth],
  );

  const inboxIndicatorStyle = useAnimatedStyle(() => {
    const segment = inboxTabRowWidth.value * 0.5;
    const indicatorW = segment * 0.36;
    const raw =
      inboxPageWidth.value > 0
        ? inboxScrollX.value / inboxPageWidth.value
        : 0;
    const progress = Math.min(1, Math.max(0, raw));
    return {
      width: indicatorW,
      transform: [
        { translateX: progress * segment + (segment - indicatorW) * 0.5 },
      ],
    };
  });

  const onInboxPagerScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      inboxScrollX.value = e.contentOffset.x;
    },
  });
  const [threadTick, setThreadTick] = useState(0);
  const [avatarLightbox, setAvatarLightbox] =
    useState<PeerAvatarLightboxTarget | null>(null);
  const myId = useMemo(() => accessTokenSubject(token), [token]);

  const openAvatarLightbox = useCallback((c: Conversation) => {
    setAvatarLightbox({
      name: c.peerName,
      phone: c.peerPhone,
      remoteUrl: c.peerAvatarUrl ?? demoAvatarUrlForPhone(c.peerPhone),
      localUri: contactPhotoUriForPhone(c.peerPhone),
      conversationId: c.id,
    });
  }, []);

  const onConversationAvatarPress = useCallback(
    (c: Conversation, ring: "unseen" | "seen" | "none") => {
      if (ring !== "none") {
        const statusUserId =
          peerStatusUserIdForConversation(c.peerUserId, c.peerPhone) ??
          String(c.peerUserId ?? "").trim();
        if (statusUserId) {
          router.push({
            pathname: "/status/view",
            params: {
              userId: statusUserId,
              index: String(statusViewStartIndex(statusUserId)),
            },
          });
          return;
        }
      }
      openAvatarLightbox(c);
    },
    [openAvatarLightbox],
  );

  useEffect(() => {
    if (authLoading) return;
    runAggressiveWarm({ token, phone: user?.phone });
  }, [authLoading, token, user?.phone]);

  useEffect(() => subscribeUnread(() => setUnreadTick((n) => n + 1)), []);
  useEffect(() => subscribeStatusFeed(() => setStatusTick((n) => n + 1)), []);
  useEffect(
    () => subscribeConversationReceipt(() => setReceiptTick((n) => n + 1)),
    [],
  );
  useEffect(
    () => subscribeConversationTyping(() => setTypingTick((n) => n + 1)),
    [],
  );
  useEffect(() => {
    if (!token) return;
    return subscribeMessageDeleted(() => {
      setThreadTick((n) => n + 1);
      const snap = getConversationsSnapshot(token);
      if (snap) {
        setItems((prev) => (conversationsEqual(prev, snap) ? prev : snap));
      }
    });
  }, [token]);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const bump = () => {
      if (alive) setThreadTick((n) => n + 1);
    };
    const unsubs: (() => void)[] = [];
    const wireOutboxes = () => {
      void (async () => {
        const [v, i, m] = await Promise.all([
          import("@/lib/voice/outbox"),
          import("@/lib/image/outbox"),
          import("@/lib/messages/moneyOutbox"),
        ]);
        if (!alive) return;
        unsubs.push(v.subscribeVoiceOutbox(() => bump()));
        unsubs.push(i.subscribeImageOutbox(() => bump()));
        unsubs.push(
          m.subscribeMoneyOutbox(() => {
            bump();
            const snap = getConversationsSnapshot(token);
            if (snap) {
              setItems((prev) => (conversationsEqual(prev, snap) ? prev : snap));
            }
          }),
        );
      })();
    };
    let delayTimer: ReturnType<typeof setTimeout> | undefined;
    if (DEV_BACKGROUND_BOOT_MS > 0) {
      delayTimer = setTimeout(wireOutboxes, DEV_BACKGROUND_BOOT_MS);
    } else {
      wireOutboxes();
    }
    return () => {
      alive = false;
      if (delayTimer) clearTimeout(delayTimer);
      unsubs.forEach((u) => u());
    };
  }, [token]);

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
      if (!DEV_METRO_LITE) {
        InteractionManager.runAfterInteractions(() => {
          void import("@/lib/messages/chatEmojiCatalog").then((m) => {
            m.loadChatEmojiCategories?.();
          });
        });
      }
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
            if (!shouldPullConversationsList()) {
              if (!cancelled) endMark();
              return;
            }
            if (DEV_METRO_LITE && getConversationsSnapshot(token)) {
              if (!cancelled) endMark();
              return;
            }
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
            markConversationsListPulled();
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
      const threadLast = lastMessageInThread(token, c.id);
      if (threadLast) {
        if (threadLast.deletedForAll) {
          return messageFromSelf(threadLast, myId)
            ? t("messages.deletedForAllMine")
            : t("messages.deletedForAllTheirs");
        }
        const fromThread = displayListPreviewForMessage(threadLast, t, c);
        if (fromThread) return fromThread;
      } else {
        const tomb = lastDeletedMessageInThread(token, c.id);
        if (tomb) {
          return messageFromSelf(tomb, myId)
            ? t("messages.deletedForAllMine")
            : t("messages.deletedForAllTheirs");
        }
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

  const goInboxPage = useCallback(
    (index: number) => {
      const next = index === 1 ? 1 : 0;
      setInboxPage(next);
      inboxPagerRef.current?.scrollTo({
        x: next * pageWidth,
        animated: true,
      });
    },
    [pageWidth],
  );

  const onInboxPagerEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const next = Math.round(x / Math.max(pageWidth, 1));
      setInboxPage(next === 1 ? 1 : 0);
    },
    [pageWidth],
  );

  const openChat = useCallback(
    (id: string) => {
      const cid = String(id ?? "").trim();
      if (!cid) return;
      markChatOpenOnNavigate();
      router.push(`/chat/${encodeURIComponent(cid)}` as const);
    },
    [token, ownerPhone],
  );

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
      if (DEV_METRO_LITE) return;
      void import("@/lib/image/pickFromLibrary").then((m) =>
        m.warmImageLibraryPermission(),
      );
    }, []),
  );

  useEffect(() => {
    if (!token || !myId) return;
    const name =
      [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
      t("status.myStatus");
    applyDemoStatusFeedNow(myId, {
      displayName: name,
      peerPhone: user?.phone ?? null,
      avatarUrl: user?.avatarUrl ?? null,
    });
    if (statusFeedHasPeerPosts()) return;
    const loadStatus = () => {
      void import("@/lib/api/client")
        .then((api) => api.listStatusFeed(token))
        .then((res) => applyStatusFeedSnapshot(res.items, res.myUserId))
        .catch(() => {});
    };
    if (DEV_BACKGROUND_BOOT_MS > 0) {
      runAfterDevBackgroundBoot(loadStatus);
    } else {
      loadStatus();
    }
  }, [token, myId, user, t]);

  useFocusEffect(
    useCallback(() => {
      if (!token || !myId) return;
      const name =
        [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
        t("status.myStatus");
      applyDemoStatusFeedNow(myId, {
        displayName: name,
        peerPhone: user?.phone ?? null,
        avatarUrl: user?.avatarUrl ?? null,
      });
      syncStatusFeedFromNetwork(token, {
        force: !statusFeedHasPeerPosts(),
      });
    }, [token, myId, user, t]),
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
      <View style={styles.inboxChrome}>
        <View
          style={styles.inboxTabRow}
          onLayout={(e) => onInboxTabRowLayout(e.nativeEvent.layout.width)}
        >
          <Pressable
            style={styles.inboxTab}
            onPress={() => goInboxPage(0)}
            accessibilityRole="tab"
            accessibilityState={{ selected: inboxPage === 0 }}
            accessibilityLabel={t("messages.title")}
          >
            <Ionicons
              name="chatbubbles-outline"
              size={18}
              color={inboxPage === 0 ? colors.text : colors.textMuted}
              style={styles.inboxTabIcon}
            />
            <Text
              style={
                inboxPage === 0
                  ? styles.inboxTabLabelActive
                  : styles.inboxTabLabel
              }
            >
              {t("messages.title")}
            </Text>
            <View style={styles.inboxTabIndicatorSlot} />
          </Pressable>
          <Pressable
            style={styles.inboxTab}
            onPress={() => goInboxPage(1)}
            accessibilityRole="tab"
            accessibilityState={{ selected: inboxPage === 1 }}
            accessibilityLabel={t("actus.title")}
          >
            <Ionicons
              name="albums-outline"
              size={18}
              color={inboxPage === 1 ? colors.text : colors.textMuted}
              style={styles.inboxTabIcon}
            />
            <View style={styles.inboxTabBadgeWrap}>
              <Text
                style={
                  inboxPage === 1
                    ? styles.inboxTabLabelActive
                    : styles.inboxTabLabel
                }
              >
                {t("actus.title")}
              </Text>
              <CountBadge
                count={countUnseenPeerStatuses()}
                style={{ position: "absolute", top: -6, right: -14 }}
              />
            </View>
            <View style={styles.inboxTabIndicatorSlot} />
          </Pressable>
        </View>
        <View style={styles.inboxTabIndicatorTrack} pointerEvents="none">
          <Animated.View
            style={[styles.inboxTabIndicatorSliding, inboxIndicatorStyle]}
          />
        </View>
      </View>

      <AnimatedScrollView
        ref={inboxPagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onInboxPagerScroll}
        onMomentumScrollEnd={onInboxPagerEnd}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        <View style={{ width: pageWidth, flex: 1 }}>
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
            <FlashList
              extraData={`${unreadTick}|${typingTick}|${receiptTick}|${threadTick}|${statusTick}`}
              data={items}
              keyExtractor={(c) => c.id}
              drawDistance={280}
              showsVerticalScrollIndicator={false}
              style={{ flex: 1 }}
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
                    onAvatarPress={onConversationAvatarPress}
                    unreadLabel={t("messages.unreadCount", { count: unread })}
                    peerStatusRing={peerStatusRingVariantForConversation(
                      item.peerUserId,
                      item.peerPhone,
                    )}
                  />
                );
              }}
            />
          )}
        </View>
        <View style={{ width: pageWidth, flex: 1 }}>
          <ActusPanel isActive={inboxPage === 1} />
        </View>
      </AnimatedScrollView>
      {inboxPage === 0 ? (
        <Pressable
          style={styles.inboxNewChatBtn}
          onPress={() => router.push("/new-chat")}
          accessibilityLabel={t("messages.newChat")}
        >
          <Ionicons name="create" size={22} color={colors.accentOn} />
        </Pressable>
      ) : null}
      <PeerAvatarLightbox
        target={avatarLightbox}
        onClose={() => setAvatarLightbox(null)}
        onOpenChat={openChat}
      />
    </SafeAreaView>
  );
}
