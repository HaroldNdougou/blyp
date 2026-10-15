import { CHAT_EMOJI_PANEL_HEIGHT } from "@/lib/messages/chatEmojiConstants";
import type { ThemeColors } from "@/lib/theme/colors";
import { demoAvatarUrlForPhone } from "@/lib/dev/demoProfiles";
import { contactPhotoUriForPhone } from "@/lib/contacts/contactPhotos";
import { PeerAvatar } from "@/components/peers/PeerAvatar";
import { createMessagesStyles } from "@/components/messages/messagesStyles";
import {
  ReactionBadge,
  ReactionPicker,
} from "@/components/messages/MessageReactions";
import { ComposerReplyBar } from "@/components/messages/MessageReplyQuote";
import {
  ChatMessageListRow,
  type ChatMessageRowHandlers,
} from "@/components/messages/ChatMessageListRow";
import { isOutboundMessagePending } from "@/lib/messages/outboundPending";
import { packReceiptGeneration } from "@/lib/messages/receiptGeneration";
import {
  getMessageReplyTo,
  replyToFromMessage,
  withNormalizedReplyTo,
} from "@/lib/messages/replyPreview";
import { ChatAttachSheet } from "@/components/messages/ChatAttachSheet";
import { ImageBubble } from "@/components/messages/ImageBubble";
import {
  ImageCaptionComposer,
  type PendingImageAsset,
} from "@/components/messages/ImageCaptionComposer";
import { VoiceBubble } from "@/components/messages/VoiceBubble";
import { formatVoiceClock } from "@/lib/voice/record";
import {
  copyVoiceIntoCache,
  ensureVoiceCached,
  peekVoiceCache,
  voiceUriExists,
} from "@/lib/voice/cache";
import { copyImageIntoCache } from "@/lib/image/cache";
import {
  ensureImageLibraryPermission,
  pickImagesFromLibrary,
  warmImageLibraryPermission,
} from "@/lib/image/pickFromLibrary";
import { kickImageOutbox, subscribeImageOutbox } from "@/lib/image/outbox";
import { kickVoiceOutbox, subscribeVoiceOutbox } from "@/lib/voice/outbox";
import { AmountNumericKeypad } from "@/components/pay/AmountNumericKeypad";
import { MaskedPinInput } from "@/components/pay/MaskedPinInput";
import { useAuth } from "@/contexts/AuthContext";
import { accessTokenSubject } from "@/lib/auth/accessTokenSubject";
import { useTheme } from "@/contexts/ThemeContext";
import { parseAmountFcfa } from "@/lib/amountLimits";
import { ApiError, isTransactionPinInvalidError } from "@/lib/api/errors";
import type { ChatMessage, Conversation } from "@/lib/api/types";
import { formatFcfa } from "@/lib/formatFcfa";
import { formatMessageDayLabel } from "@/lib/format";
import {
  clearChatThreadListModel,
  ensureChatThreadListModel,
} from "@/lib/messages/chatThreadListModel";
import { perfMarkEnd } from "@/lib/perf/marks";
import {
  applyServerMessagesSnapshot,
  ensureMessagesSnapshotFromDb,
  getConversationsSnapshot,
  getMessagesSnapshot,
  getReceiptsSnapshot,
  mergeNewerOrPending,
  messagesEqual,
  setConversationsSnapshot,
  sortConversationsByActivity,
  mergeMoneyTransfer,
  setMessagesSnapshot,
  setReceiptsSnapshot,
} from "@/lib/messagesCache";
import {
  getTypingSnapshot,
  setActiveConversation,
  subscribeConversationReceipt,
  subscribeConversationTyping,
  subscribeIncomingMessage,
  subscribeMessageDeleted,
  subscribeMessageReaction,
  subscribeMoneyClaimed,
  subscribeMoneyUpdated,
} from "@/lib/messages/live";
import { Ionicons } from "@expo/vector-icons";
import {
  encodeReactionListPreview,
  encodeReactionSync,
  foldReactionSyncMessages,
} from "@/lib/messages/reactionSync";
import { pushRecentChatEmoji } from "@/lib/messages/recentChatEmojis";
import { resolveTranslateTargetLanguage } from "@/lib/i18n/translateLocale";
import {
  ensureThreadTranslations,
  getCachedMessageTranslation,
  translatablePeerText,
  warmMessageTranslationsFromSqlite,
} from "@/lib/messages/messageTranslation";
import {
  listChatMessages,
  prefetchChatMessaging,
  sendChatTextMessage,
} from "@/lib/messages/chatSend";
import { playChatSound } from "@/lib/messages/chatSounds";
import {
  router,
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
} from "expo-router";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Dimensions,
  FlatList,
  InteractionManager,
  type ViewToken,
  Keyboard,
  type KeyboardEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

const PULL_COOLDOWN_AFTER_SEND_MS = 2200;
const DELETE_FOR_ALL_MS = 60 * 60 * 1000;

type ChatEmojiPickerProps = {
  colors: ThemeColors;
  onPick: (emoji: string) => void;
  backgroundColor: string;
  borderColor: string;
};

/** FlatList inversée : offset ~0 = bas du fil (messages récents). */
const CHAT_AT_BOTTOM_Y = 56;

function newClientId() {
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function firstNameOf(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return s.split(/\s+/)[0] ?? "";
}

function transferIdFromChatUrl(url: string, conversationId: string): string {
  if (!url || !conversationId) return "";
  const encoded = encodeURIComponent(conversationId);
  if (
    !url.includes(`/chat/${conversationId}`) &&
    !url.includes(`/chat/${encoded}`)
  ) {
    return "";
  }
  const m = url.match(/[?&]transferId=([^&]+)/);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]).trim();
  } catch {
    return m[1].trim();
  }
}

/**
 * Lift au-dessus du clavier (style WhatsApp).
 * Sur MIUI/Redmi, endCoordinates.height ignore souvent la barre
 * suggestions / icônes au-dessus des touches.
 */
function imeLiftPx(e: KeyboardEvent): number {
  const screenH = Dimensions.get("screen").height;
  const winH = Dimensions.get("window").height;
  const { height, screenY } = e.endCoordinates;
  if (height <= 0) return 0;

  const fromScreen = screenH - screenY;
  const fromWindow = winH - screenY;
  const frameLift = Math.max(fromScreen, fromWindow);

  let lift =
    screenY > 40 && frameLift >= height - 8
      ? Math.max(height, frameLift)
      : height;

  if (Platform.OS === "android") {
    if (frameLift <= height + 12) {
      lift += 96;
    }
  }

  return Math.round(Math.min(lift, screenH * 0.75));
}

export default function ChatThreadScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createMessagesStyles(colors), [colors]);
  const { token, user, refreshUser, updateBalance } = useAuth();
  const params = useLocalSearchParams<{ id?: string; transferId?: string }>();
  const conversationId = decodeURIComponent(
    typeof params.id === "string" ? params.id : "",
  );
  const focusTransferId = Array.isArray(params.transferId)
    ? String(params.transferId[0] ?? "").trim()
    : String(params.transferId ?? "").trim();

  const myId = accessTokenSubject(token);
  const myPhone = user?.phone ?? "";

  const convInit =
    token && conversationId
      ? getConversationsSnapshot(token)?.find((c) => c.id === conversationId)
      : undefined;
  const cachedInit =
    token && conversationId
      ? getMessagesSnapshot(token, conversationId)
      : null;
  const [peerName, setPeerName] = useState(
    convInit?.peerName?.trim() || "…",
  );
  const [peerPhone, setPeerPhone] = useState<string | null>(
    convInit?.peerPhone ?? null,
  );
  const [peerAvatarUrl, setPeerAvatarUrl] = useState<string | null>(
    convInit?.peerAvatarUrl ?? null,
  );
  const [peerOnBlyp, setPeerOnBlyp] = useState(
    convInit ? Boolean(convInit.peerUserId) : true,
  );
  const [messages, setMessages] = useState<ChatMessage[]>(cachedInit ?? []);
  const [peerTranslations, setPeerTranslations] = useState<
    Record<string, string>
  >({});
  const translateTargetLang = useMemo(
    () => resolveTranslateTargetLanguage(),
    [],
  );
  const [loading, setLoading] = useState(!cachedInit);
  const [text, setText] = useState("");
  const composerTextRef = useRef("");
  composerTextRef.current = text;
  const sendingRef = useRef(false);
  const lastLocalSendAtRef = useRef(0);
  const [emojiPickerMounted, setEmojiPickerMounted] = useState(false);
  const [EmojiPickerView, setEmojiPickerView] = useState<
    React.ComponentType<ChatEmojiPickerProps> | null
  >(null);
  const emojiPickerLoadRef = useRef(false);
  const [sending, setSending] = useState(false);
  const [moneyOpen, setMoneyOpen] = useState(false);
  const [moneyStep, setMoneyStep] = useState<"amount" | "pin">("amount");
  const [pendingMoneyAmount, setPendingMoneyAmount] = useState<number | null>(
    null,
  );
  const pendingMoneyAmountRef = useRef<number | null>(null);
  const pendingMoneyCaptionRef = useRef("");
  const [pinDigits, setPinDigits] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinInputKey, setPinInputKey] = useState(0);
  const [amount, setAmount] = useState("");
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [recallTransferId, setRecallTransferId] = useState<string | null>(null);
  const [recUi, setRecUi] = useState<"idle" | "recording" | "paused">("idle");
  const [recMs, setRecMs] = useState(0);
  /** Stop du clip en cours — pas l’upload (WhatsApp : rec suivant tout de suite). */
  const [recBusy, setRecBusy] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const selectionMode = selectedMessageIds.length > 0;
  const primarySelectId = selectedMessageIds[0] ?? null;
  const [replyDraft, setReplyDraft] = useState<ChatMessage | null>(null);
  const replyDraftRef = useRef<ChatMessage | null>(null);
  replyDraftRef.current = replyDraft;

  const closeReactPicker = useCallback(() => {
    setSelectedMessageIds([]);
    setReactPickerPos(null);
  }, []);

  const toggleMessageSelection = useCallback((messageId: string) => {
    setSelectedMessageIds((prev) => {
      const has = prev.includes(messageId);
      const next = has
        ? prev.filter((id) => id !== messageId)
        : [...prev, messageId];
      if (next.length === 0) {
        setReactPickerPos(null);
      }
      return next;
    });
  }, []);

  const listLayerRef = useRef<View>(null);
  const selectionTouchOnMessageRef = useRef(false);
  const notifyMessageRowTouch = useCallback(() => {
    selectionTouchOnMessageRef.current = true;
  }, []);

  const handleListTouchEndCapture = useCallback(() => {
    if (!selectionMode) return;
    if (!selectionTouchOnMessageRef.current) {
      closeReactPicker();
    }
    selectionTouchOnMessageRef.current = false;
  }, [selectionMode, closeReactPicker]);
  const reactAnchorRef = useRef<View | null>(null);
  const [reactPickerPos, setReactPickerPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const measureReactPickerPos = useCallback(() => {
    const anchor = reactAnchorRef.current;
    const layer = listLayerRef.current;
    if (!anchor || !layer) return;
    const run = () => {
      layer.measureInWindow((lx, ly, lw) => {
        anchor.measureInWindow((ax, ay, aw) => {
          const pickerW = Math.min(304, Math.max(200, lw - 16));
          let left = ax - lx + aw / 2 - pickerW / 2;
          left = Math.max(8, Math.min(left, lw - pickerW - 8));
          const top = ay - ly - 54;
          setReactPickerPos({
            top: Math.max(4, top),
            left,
            width: pickerW,
          });
        });
      });
    };
    run();
    requestAnimationFrame(run);
  }, []);

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  /** Panneau emoji visible seulement après fermeture du clavier (évite double lift + flicker). */
  const [emojiPanelVisible, setEmojiPanelVisible] = useState(false);
  const emojiOpenRef = useRef(false);
  const emojiPanelVisibleRef = useRef(false);
  emojiOpenRef.current = emojiOpen;
  emojiPanelVisibleRef.current = emojiPanelVisible;
  const composerRef = useRef<TextInput>(null);

  useLayoutEffect(() => {
    if (selectedMessageIds.length !== 1) {
      if (selectedMessageIds.length === 0) setReactPickerPos(null);
      return;
    }
    measureReactPickerPos();
  }, [selectedMessageIds, measureReactPickerPos, keyboardHeight, emojiOpen]);

  const [highlightedTransferId, setHighlightedTransferId] = useState<
    string | null
  >(null);
  const consumedFocusRef = useRef<string | null>(null);
  const scrolledHighlightRef = useRef<string | null>(null);
  const recRef = useRef<import("@/lib/voice/record").VoiceRecorder | null>(
    null,
  );
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const recTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prefetchVoicesRef = useRef<(list: ChatMessage[]) => void>(() => {});
  const [peerLastReadAt, setPeerLastReadAt] = useState<string | null>(
    () => getReceiptsSnapshot(conversationId)?.peerLastReadAt ?? null,
  );
  const [peerLastDeliveredAt, setPeerLastDeliveredAt] = useState<string | null>(
    () => getReceiptsSnapshot(conversationId)?.peerLastDeliveredAt ?? null,
  );
  const [peerTypingName, setPeerTypingName] = useState(
    () => getTypingSnapshot(conversationId)?.fromName ?? "",
  );
  const typingPulseAtRef = useRef(0);
  const typingIdleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Étape PIN : garde la dernière hauteur clavier (pas de chute si l’IME clignote). */
  const pinLiftRef = useRef(0);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const atLatestRef = useRef(true);
  const threadIdsHydratedRef = useRef(false);
  const knownMsgIdsRef = useRef(new Set<string>());
  const pendingNewMsgIdsRef = useRef(new Set<string>());
  const newArrivalHighlightTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [newBelowCount, setNewBelowCount] = useState(0);
  const [pinListOnInsert, setPinListOnInsert] = useState(false);
  const [newArrivalHighlightIds, setNewArrivalHighlightIds] = useState(
    () => new Set<string>(),
  );
  const pinInputRef = useRef<TextInput>(null);
  const pinFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const threadListModel = useMemo(
    () => ensureChatThreadListModel(conversationId, messages),
    [conversationId, messages],
  );
  const newestFirst = threadListModel.newestFirst;

  useEffect(() => {
    if (!conversationId) return;
    if (loading && messages.length === 0) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        perfMarkEnd("chat_open");
      });
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [conversationId, loading, messages.length]);

  useEffect(() => {
    return () => {
      if (conversationId) clearChatThreadListModel(conversationId);
    };
  }, [conversationId]);

  const scrollToMessageId = useCallback(
    (messageId: string) => {
      const idx = newestFirst.findIndex((m) => m.id === messageId);
      if (idx < 0) return;
      requestAnimationFrame(() => {
        try {
          listRef.current?.scrollToIndex({
            index: idx,
            animated: true,
            viewPosition: 0.45,
          });
        } catch {
          /* onScrollToIndexFailed */
        }
      });
    },
    [newestFirst],
  );

  const startReplyTo = useCallback(
    (msg: ChatMessage) => {
      if (msg.id.startsWith("c-")) return;
      closeReactPicker();
      void import("expo-haptics")
        .then((H) => H.impactAsync(H.ImpactFeedbackStyle.Light))
        .catch(() => {});
      setReplyDraft(msg);
      requestAnimationFrame(() => composerRef.current?.focus());
    },
    [closeReactPicker],
  );

  const [stickyDate, setStickyDate] = useState<string | null>(null);
  const [stickyDateOn, setStickyDateOn] = useState(false);
  const stickyHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealStickyDate = useCallback(() => {
    if (stickyHideRef.current) {
      clearTimeout(stickyHideRef.current);
      stickyHideRef.current = null;
    }
    setStickyDateOn(true);
  }, []);
  const hideStickyDateSoon = useCallback(() => {
    if (stickyHideRef.current) clearTimeout(stickyHideRef.current);
    stickyHideRef.current = setTimeout(() => {
      stickyHideRef.current = null;
      setStickyDateOn(false);
    }, 900);
  }, []);
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length === 0) return;
      let top = viewableItems[0];
      for (const v of viewableItems) {
        if ((v.index ?? 0) > (top.index ?? 0)) top = v;
      }
      const iso = (top.item as ChatMessage | undefined)?.createdAt;
      if (!iso) return;
      const label = formatMessageDayLabel(iso);
      if (label) setStickyDate(label);
    },
  ).current;
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 12,
    minimumViewTime: 40,
  }).current;

  const scrollToLatest = useCallback(
    (animated = false) => {
      const run = () => {
        const list = listRef.current;
        if (!list) return;
        /** Fil inversé : offset 0 = messages récents (bas). */
        list.scrollToOffset({ offset: 0, animated });
        if (newestFirst.length === 0) return;
        try {
          list.scrollToIndex({
            index: 0,
            animated,
            viewPosition: 0,
          });
        } catch {
          list.scrollToOffset({ offset: 0, animated });
        }
      };
      run();
      requestAnimationFrame(run);
      requestAnimationFrame(() => requestAnimationFrame(run));
      if (animated) {
        setTimeout(run, 120);
        setTimeout(run, 320);
      }
    },
    [newestFirst.length],
  );

  const scrollAnchoredConvRef = useRef<string | null>(null);
  useEffect(() => {
    scrollAnchoredConvRef.current = null;
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || loading) return;
    if (newestFirst.length === 0) return;
    if (scrollAnchoredConvRef.current === conversationId) return;
    scrollAnchoredConvRef.current = conversationId;
    scrollToLatest(false);
    const t = setTimeout(() => scrollToLatest(false), 80);
    return () => clearTimeout(t);
  }, [conversationId, loading, newestFirst.length, scrollToLatest]);

  const onThreadListContentSizeChange = useCallback(() => {
    if (atLatestRef.current) {
      scrollToLatest(false);
      return;
    }
    if (scrollAnchoredConvRef.current !== conversationId) {
      scrollToLatest(false);
    }
  }, [conversationId, scrollToLatest]);

  const onListScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const atBottom = y <= CHAT_AT_BOTTOM_Y;
      setPinListOnInsert(!atBottom);
      if (atBottom) {
        atLatestRef.current = true;
        pendingNewMsgIdsRef.current.clear();
        setNewBelowCount(0);
      } else {
        atLatestRef.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    consumedFocusRef.current = null;
    scrolledHighlightRef.current = null;
    setHighlightedTransferId(null);
    atLatestRef.current = true;
    threadIdsHydratedRef.current = false;
    knownMsgIdsRef.current = new Set();
    pendingNewMsgIdsRef.current.clear();
    setNewBelowCount(0);
    setPinListOnInsert(false);
    setNewArrivalHighlightIds(new Set());
    setSelectedMessageIds([]);
    setReactPickerPos(null);
    if (newArrivalHighlightTimerRef.current) {
      clearTimeout(newArrivalHighlightTimerRef.current);
      newArrivalHighlightTimerRef.current = null;
    }
  }, [conversationId]);

  useEffect(() => {
    if (!focusTransferId) return;
    if (consumedFocusRef.current === focusTransferId) return;
    const found = newestFirst.some(
      (m) => m.moneyTransfer?.transferId === focusTransferId,
    );
    if (!found) return;
    consumedFocusRef.current = focusTransferId;
    setHighlightedTransferId(focusTransferId);
  }, [focusTransferId, newestFirst]);

  useEffect(() => {
    if (Platform.OS === "web" || !conversationId) return;
    const applyUrl = (url: string) => {
      const tid = transferIdFromChatUrl(url, conversationId);
      if (!tid) return;
      consumedFocusRef.current = tid;
      setHighlightedTransferId(tid);
    };
    const sub = Linking.addEventListener("url", ({ url }) => applyUrl(url));
    return () => sub.remove();
  }, [conversationId]);

  const dismissHighlight = useCallback(() => {
    setHighlightedTransferId(null);
  }, []);

  useEffect(() => {
    if (!highlightedTransferId) {
      scrolledHighlightRef.current = null;
      return;
    }
    if (scrolledHighlightRef.current === highlightedTransferId) return;
    const idx = newestFirst.findIndex(
      (m) => m.moneyTransfer?.transferId === highlightedTransferId,
    );
    if (idx < 0) return;
    scrolledHighlightRef.current = highlightedTransferId;
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToIndex({
          index: idx,
          animated: true,
          viewPosition: 0.35,
        });
      } catch {
        /* onScrollToIndexFailed */
      }
    });
  }, [highlightedTransferId, newestFirst]);

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = (e: KeyboardEvent) => {
      if (emojiOpenRef.current || emojiPanelVisibleRef.current) return;
      setEmojiOpen(false);
      setEmojiPanelVisible(false);
      setKeyboardHeight(imeLiftPx(e));
      scrollToLatest(true);
    };
    const onHide = () => {
      if (emojiOpenRef.current) {
        setKeyboardHeight(0);
        if (!emojiPanelVisibleRef.current) {
          setEmojiPanelVisible(true);
        }
        return;
      }
      setKeyboardHeight(0);
    };
    const onFrame = (e: KeyboardEvent) => {
      if (emojiOpenRef.current) return;
      if (e.endCoordinates.height <= 0) {
        setKeyboardHeight(0);
        return;
      }
      setKeyboardHeight(imeLiftPx(e));
    };
    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);
    const subFrame = Keyboard.addListener("keyboardDidChangeFrame", onFrame);
    return () => {
      subShow.remove();
      subHide.remove();
      subFrame.remove();
    };
  }, [scrollToLatest]);

  useEffect(() => {
    if (!conversationId) return;
    return () => {
      if (recTickRef.current) clearInterval(recTickRef.current);
      if (stickyHideRef.current) clearTimeout(stickyHideRef.current);
      if (pinFocusTimerRef.current) clearTimeout(pinFocusTimerRef.current);
      void recRef.current?.discard();
      recRef.current = null;
      void import("@/lib/voice/play").then((m) => m.stopVoice());
    };
  }, [conversationId]);

  useFocusEffect(
    useCallback(() => {
      if (!conversationId) return;
      const markRead = () => {
        if (!token) return;
        void import("@/lib/api/client")
          .then((m) => m.markConversationRead(token, conversationId))
          .catch(() => {
            /* hors-ligne / 401 */
          });
      };
      const activate = () => {
        setActiveConversation(conversationId);
        markRead();
      };
      const suspend = () => {
        setActiveConversation(null);
      };
      activate();
      const sub = AppState.addEventListener("change", (s) => {
        if (s === "active") activate();
        else suspend();
      });
      return () => {
        sub.remove();
        suspend();
        setEmojiPickerMounted(false);
        setEmojiPanelVisible(false);
        setEmojiOpen(false);
      };
    }, [conversationId, token]),
  );

  useEffect(() => {
    if (!conversationId) return;
    return subscribeVoiceOutbox((cid, items) => {
      if (cid !== conversationId) return;
      setMessages((prev) => (messagesEqual(prev, items) ? prev : items));
    });
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    return subscribeImageOutbox((cid, items) => {
      if (cid !== conversationId) return;
      setMessages((prev) => (messagesEqual(prev, items) ? prev : items));
    });
  }, [conversationId]);

  useEffect(() => {
    if (!token) return;
    const task = InteractionManager.runAfterInteractions(() => {
      kickVoiceOutbox(token);
      kickImageOutbox(token);
    });
    return () => task.cancel?.();
  }, [token, conversationId]);

  useEffect(() => {
    if (!token || !conversationId || messages.length === 0) return;
    const ids = messages.map((m) => m.id);
    void warmMessageTranslationsFromSqlite(token, ids, translateTargetLang).then(
      () => {
        const patch: Record<string, string> = {};
        for (const msg of messages) {
          const source = translatablePeerText(msg, myId);
          if (!source) continue;
          const tr = getCachedMessageTranslation(msg.id, translateTargetLang);
          if (tr && tr.trim() !== source.trim()) patch[msg.id] = tr;
        }
        if (Object.keys(patch).length === 0) return;
        setPeerTranslations((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [id, text] of Object.entries(patch)) {
            if (next[id] !== text) {
              next[id] = text;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
    );
  }, [token, conversationId, messages, myId, translateTargetLang]);

  useEffect(() => {
    if (!token || !conversationId) return;
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      void ensureThreadTranslations(
        token,
        conversationId,
        messages,
        myId,
        (patch) => {
          if (cancelled) return;
          setPeerTranslations((prev) => {
            let changed = false;
            const next = { ...prev };
            for (const [id, text] of Object.entries(patch)) {
              if (next[id] !== text) {
                next[id] = text;
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        },
      );
    });
    return () => {
      cancelled = true;
      task.cancel?.();
    };
  }, [token, conversationId, messages, myId]);

  useEffect(() => {
    if (!conversationId) return;
    return subscribeConversationReceipt((patch) => {
      if (patch.conversationId !== conversationId) return;
      const snap = getReceiptsSnapshot(conversationId);
      const nextRead = snap?.peerLastReadAt ?? null;
      const nextDelivered = snap?.peerLastDeliveredAt ?? null;
      setPeerLastReadAt((prev) => (prev === nextRead ? prev : nextRead));
      setPeerLastDeliveredAt((prev) =>
        prev === nextDelivered ? prev : nextDelivered,
      );
    });
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    return subscribeMoneyClaimed((patch) => {
      if (patch.conversationId !== conversationId) return;
      setMessages((prev) => {
        let hit = false;
        const next = prev.map((msg) => {
          const tr = msg.moneyTransfer;
          if (!tr || tr.transferId !== patch.transferId) return msg;
          if (
            tr.status === "claimed" &&
            (tr.claimedByFirstName || "") === patch.claimedByFirstName
          ) {
            return msg;
          }
          hit = true;
          return {
            ...msg,
            moneyTransfer: {
              ...tr,
              status: "claimed" as const,
              claimedAt: tr.claimedAt ?? patch.claimedAt,
              claimedByFirstName:
                patch.claimedByFirstName || tr.claimedByFirstName || null,
            },
          };
        });
        if (!hit) return prev;
        if (token) setMessagesSnapshot(token, conversationId, next);
        return next;
      });
    });
  }, [token, conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    return subscribeMoneyUpdated((patch) => {
      if (patch.conversationId !== conversationId) return;
      setMessages((prev) => {
        let hit = false;
        const next = prev.map((msg) => {
          const tr = msg.moneyTransfer;
          if (!tr || tr.transferId !== patch.transferId) return msg;
          hit = true;
          const status = String(patch.status || tr.status).toLowerCase();
          return {
            ...msg,
            moneyTransfer: {
              ...tr,
              status: (status || tr.status) as typeof tr.status,
              claimedByFirstName:
                patch.claimedByFirstName || tr.claimedByFirstName || null,
              claimedByUserId:
                patch.claimedByUserId || tr.claimedByUserId || null,
              thanksFirstName:
                patch.thanksFirstName || tr.thanksFirstName || null,
              thanksUserId: patch.thanksUserId || tr.thanksUserId || null,
            },
          };
        });
        if (!hit) return prev;
        if (token) setMessagesSnapshot(token, conversationId, next);
        return next;
      });
    });
  }, [token, conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    return subscribeConversationTyping((patch) => {
      if (patch.conversationId !== conversationId) return;
      setPeerTypingName(patch.on ? patch.fromName : "");
    });
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    return subscribeMessageReaction((patch) => {
      if (patch.conversationId !== conversationId) return;
      setMessages((prev) => {
        let hit = false;
        const next = prev.map((msg) => {
          if (msg.id !== patch.messageId) return msg;
          hit = true;
          return { ...msg, reactions: patch.reactions };
        });
        if (!hit) return prev;
        if (token) setMessagesSnapshot(token, conversationId, next);
        return next;
      });
    });
  }, [token, conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    return subscribeMessageDeleted((patch) => {
      if (patch.conversationId !== conversationId) return;
      setMessages((prev) => {
        if (patch.deletedForAll) {
          let hit = false;
          const next = prev.map((msg) => {
            if (msg.id !== patch.messageId) return msg;
            hit = true;
            return {
              ...msg,
              type: "text",
              body: null,
              voice: null,
              image: null,
              moneyTransfer: null,
              reactions: [],
              replyTo: null,
              deletedForAll: true,
            };
          });
          if (!hit) return prev;
          if (token) setMessagesSnapshot(token, conversationId, next);
          return next;
        }
        const next = prev.filter((m) => m.id !== patch.messageId);
        if (next.length === prev.length) return prev;
        if (token) setMessagesSnapshot(token, conversationId, next);
        return next;
      });
    });
  }, [token, conversationId]);

  const pullThread = useCallback(async () => {
    if (!token || !conversationId) return;
    if (Date.now() - lastLocalSendAtRef.current < PULL_COOLDOWN_AFTER_SEND_MS) {
      return;
    }
    try {
      const { items, peerLastReadAt: r, peerLastDeliveredAt: d } =
        await listChatMessages(token, conversationId);
      const folded = foldReactionSyncMessages(items);
      applyServerMessagesSnapshot(token, conversationId, folded);
      setReceiptsSnapshot(conversationId, {
        peerLastReadAt: r ?? null,
        peerLastDeliveredAt: d ?? null,
      });
      setPeerLastReadAt((prev) => (prev === (r ?? null) ? prev : r ?? null));
      setPeerLastDeliveredAt((prev) =>
        prev === (d ?? null) ? prev : d ?? null,
      );
      const stored = getMessagesSnapshot(token, conversationId) ?? folded;
      setMessages((prev) => {
        const next = mergeNewerOrPending(prev, stored);
        return messagesEqual(prev, next) ? prev : next;
      });
      prefetchVoicesRef.current(stored);
    } catch {
      /* garde le fil */
    }
  }, [token, conversationId]);

  const bumpConversationPreview = useCallback(
    (
      preview: string,
      type: "text" | "money" | "voice" | "image" | "reaction",
      at?: string,
    ) => {
      if (!token) return;
      const prev = getConversationsSnapshot(token) ?? [];
      const when = String(at ?? "").trim() || new Date().toISOString();
      const next: Conversation[] = prev.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              lastMessagePreview: preview,
              lastMessageType: type,
              lastMessageAt: when,
              updatedAt: when,
              lastMessageFromSelf: true,
            }
          : c,
      );
      setConversationsSnapshot(token, sortConversationsByActivity(next));
    },
    [token, conversationId],
  );

  const applyReaction = useCallback(
    async (msg: ChatMessage, emoji: string) => {
      const uid = myId || user?.id || "";
      closeReactPicker();
      if (!token || !uid || msg.id.startsWith("c-")) return;
      const prev = msg.reactions ?? [];
      const mine = prev.find((r) => r.userId === uid);
      const optimistic =
        mine?.emoji === emoji
          ? prev.filter((r) => r.userId !== uid)
          : [...prev.filter((r) => r.userId !== uid), { userId: uid, emoji }];
      setMessages((list) => {
        const next = list.map((m) =>
          m.id === msg.id ? { ...m, reactions: optimistic } : m,
        );
        setMessagesSnapshot(token, conversationId, next);
        return next;
      });
      const nextEmoji = mine?.emoji === emoji ? "" : emoji;
      if (nextEmoji) {
        bumpConversationPreview(
          encodeReactionListPreview(nextEmoji, true),
          "reaction",
        );
      }
      try {
        const { sendTextMessage, reactToMessage } = await import(
          "@/lib/api/client"
        );
        await sendTextMessage(
          token,
          conversationId,
          encodeReactionSync(msg.id, nextEmoji),
          newClientId(),
        );
        try {
          const res = await reactToMessage(
            token,
            conversationId,
            msg.id,
            emoji,
          );
          if (Array.isArray(res?.reactions)) {
            setMessages((list) => {
              const next = list.map((m) =>
                m.id === msg.id ? { ...m, reactions: res.reactions } : m,
              );
              setMessagesSnapshot(token, conversationId, next);
              return next;
            });
          }
        } catch {
          /* le texte-sync est déjà parti */
        }
      } catch {
        /* garde l’optimiste */
      }
    },
    [token, conversationId, myId, user?.id, bumpConversationPreview, closeReactPicker],
  );

  useEffect(() => {
    if (!token || !conversationId) return;
    return subscribeIncomingMessage((id) => {
      if (id !== conversationId) return;
      const cached = getMessagesSnapshot(token, conversationId);
      if (cached) {
        setMessages((prev) => {
          const next = mergeNewerOrPending(prev, cached);
          return messagesEqual(prev, next) ? prev : next;
        });
        setLoading(false);
      }
      if (Date.now() - lastLocalSendAtRef.current < PULL_COOLDOWN_AFTER_SEND_MS) {
        return;
      }
      InteractionManager.runAfterInteractions(() => {
        void pullThread();
      });
    });
  }, [token, conversationId, pullThread]);

  useEffect(() => {
    if (!token || !conversationId) return;
    const convs = getConversationsSnapshot(token);
    const conv = convs?.find((c) => c.id === conversationId);
    if (conv) {
      setPeerName(conv.peerName);
      setPeerPhone(conv.peerPhone);
      setPeerAvatarUrl(conv.peerAvatarUrl ?? null);
      setPeerOnBlyp(Boolean(conv.peerUserId));
    }
    const cached = getMessagesSnapshot(token, conversationId);
    if (cached) {
      setMessages((prev) => (messagesEqual(prev, cached) ? prev : cached));
      setLoading(false);
      prefetchVoicesRef.current(cached);
    }

    let cancelled = false;
    const runPull = () => {
    void (async () => {
      try {
          await pullThread();
      } catch {
        /* keep cache */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    };
    if (cached && cached.length > 0) {
      const task = InteractionManager.runAfterInteractions(runPull);
    return () => {
      cancelled = true;
        task.cancel?.();
      };
    }
    runPull();
    return () => {
      cancelled = true;
    };
  }, [token, conversationId, pullThread]);

  if (moneyStep !== "pin" || !moneyOpen) pinLiftRef.current = 0;
  else if (keyboardHeight > 0) pinLiftRef.current = keyboardHeight;
  const pinSheetLift = pinLiftRef.current;

  const isMine = useCallback(
    (msg: ChatMessage) => {
      if (myId && msg.senderUserId === myId) return true;
      if (msg.clientId && msg.id === msg.clientId) return true;
      return false;
    },
    [myId],
  );

  useEffect(() => {
    const folded = foldReactionSyncMessages(messages);
    const ids = new Set(folded.map((m) => m.id));
    if (!threadIdsHydratedRef.current) {
      threadIdsHydratedRef.current = true;
      knownMsgIdsRef.current = ids;
      return;
    }
    let peerAdded = 0;
    for (const m of folded) {
      if (knownMsgIdsRef.current.has(m.id)) continue;
      if (!isMine(m)) {
        peerAdded += 1;
        if (!atLatestRef.current) {
          pendingNewMsgIdsRef.current.add(m.id);
        }
      }
    }
    knownMsgIdsRef.current = ids;
    if (peerAdded <= 0) return;

    void import("@/lib/messages/chatSounds").then((mod) => {
      mod.playChatSound("incomingInChat");
    });

    if (atLatestRef.current) {
      return;
    }
    setNewBelowCount((n) => n + peerAdded);
  }, [messages, isMine]);

  const jumpToNewBelow = useCallback(() => {
    const savedCount = newBelowCount;
    let ids = new Set(pendingNewMsgIdsRef.current);
    if (ids.size === 0 && savedCount > 0) {
      let picked = 0;
      for (const m of newestFirst) {
        if (isMine(m)) continue;
        ids.add(m.id);
        picked += 1;
        if (picked >= savedCount) break;
      }
    }
    pendingNewMsgIdsRef.current.clear();
    atLatestRef.current = true;
    setPinListOnInsert(false);
    setNewBelowCount(0);
    if (ids.size > 0) {
      if (newArrivalHighlightTimerRef.current) {
        clearTimeout(newArrivalHighlightTimerRef.current);
      }
      setNewArrivalHighlightIds(ids);
      newArrivalHighlightTimerRef.current = setTimeout(() => {
        newArrivalHighlightTimerRef.current = null;
        setNewArrivalHighlightIds(new Set());
      }, 2400);
    }
    setTimeout(() => scrollToLatest(true), 48);
  }, [newBelowCount, newestFirst, isMine, scrollToLatest]);

  /** Fil direct : la bulle money de l’autre = je suis le destinataire. */
  const isMoneyRecipient = (msg: ChatMessage) =>
    Boolean(msg.moneyTransfer) && !isMine(msg);

  const canClaim = useCallback((msg: ChatMessage) => {
    const tr = msg.moneyTransfer;
    if (!tr || tr.status !== "pending") return false;
    return !isOutboundMessagePending(msg);
  }, []);

  const canThank = (msg: ChatMessage) => {
    const tr = msg.moneyTransfer;
    if (!tr || msg.type !== "money") return false;
    if (tr.thanksUserId) return false;
    return isMoneyRecipient(msg);
  };

  const stopTyping = useCallback(() => {
    if (typingIdleRef.current) {
      clearInterval(typingIdleRef.current);
      typingIdleRef.current = null;
    }
    if (!token || !conversationId || typingPulseAtRef.current === 0) return;
    typingPulseAtRef.current = 0;
    void import("@/lib/api/client")
      .then((api) => api.sendConversationTyping(token, conversationId, false))
      .catch(() => {});
  }, [token, conversationId]);

  const sendTypingOn = useCallback(() => {
    if (!token || !conversationId) return;
    const now = Date.now();
    if (now - typingPulseAtRef.current < 2000 && typingPulseAtRef.current !== 0) {
      return;
    }
    typingPulseAtRef.current = now;
    void import("@/lib/api/client")
      .then((api) => api.sendConversationTyping(token, conversationId, true))
      .catch(() => {});
  }, [token, conversationId]);

  /** « écrit... » : à la frappe, puis tant que le champ contient du texte. */
  const onComposerChange = useCallback(
    (next: string) => {
      composerTextRef.current = next;
      setText(next);
      if (next.trim()) {
        sendTypingOn();
        if (!typingIdleRef.current) {
          typingIdleRef.current = setInterval(sendTypingOn, 2500);
        }
      } else if (typingIdleRef.current) {
        clearInterval(typingIdleRef.current);
        typingIdleRef.current = null;
      }
    },
    [sendTypingOn],
  );

  const onEmojiPick = useCallback(
    (emoji: string) => {
      pushRecentChatEmoji(emoji);
      onComposerChange(composerTextRef.current + emoji);
    },
    [onComposerChange],
  );

  const closeEmojiPanel = useCallback(() => {
    emojiOpenRef.current = false;
    emojiPanelVisibleRef.current = false;
    setEmojiOpen(false);
    setEmojiPanelVisible(false);
  }, []);

  const warmEmojiPicker = useCallback(() => {
    if (emojiPickerLoadRef.current) return;
    emojiPickerLoadRef.current = true;
    void import("@/lib/messages/chatEmojiCatalog").then((m) =>
      m.loadChatEmojiCategories(),
    );
    void import("@/components/messages/ChatEmojiPicker").then((m) => {
      setEmojiPickerView(() => m.ChatEmojiPicker);
    });
  }, []);

  const toggleEmojiKeyboard = useCallback(() => {
    if (emojiOpen || emojiPanelVisible) {
      closeEmojiPanel();
      requestAnimationFrame(() => composerRef.current?.focus());
      return;
    }
    closeReactPicker();
    warmEmojiPicker();
    emojiOpenRef.current = true;
    emojiPanelVisibleRef.current = true;
    setEmojiPickerMounted(true);
    setEmojiOpen(true);
    setEmojiPanelVisible(true);
    setKeyboardHeight(0);
    Keyboard.dismiss();
    if (!EmojiPickerView) {
      void import("@/components/messages/ChatEmojiPicker").then((m) => {
        setEmojiPickerView(() => m.ChatEmojiPicker);
      });
    }
  }, [
    emojiOpen,
    emojiPanelVisible,
    EmojiPickerView,
    closeEmojiPanel,
    closeReactPicker,
    warmEmojiPicker,
  ]);

  useEffect(() => {
    prefetchChatMessaging();
    void warmImageLibraryPermission();
    warmEmojiPicker();
  }, [warmEmojiPicker]);

  useLayoutEffect(() => {
    if (!token || !conversationId || !myPhone || messages.length > 0) return;
    let cancelled = false;
    void ensureMessagesSnapshotFromDb(myPhone, token, conversationId).then(
      (snap) => {
        if (cancelled || !snap?.length) return;
        setMessages((prev) => (messagesEqual(prev, snap) ? prev : snap));
        setLoading(false);
        prefetchVoicesRef.current(snap);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, conversationId, myPhone, messages.length]);

  useEffect(() => () => stopTyping(), [stopTyping]);

  const sendText = async () => {
    const body = composerTextRef.current.trim();
    if (!token || !body || sendingRef.current) return;

    const replyMsg = replyDraft;
    const replyTo =
      replyMsg != null
        ? replyToFromMessage(replyMsg, t, formatFcfa)
        : null;
    const replyToMessageId = replyTo?.messageId ?? null;

    const clientId = newClientId();
    const createdAt = new Date().toISOString();
    const optimistic: ChatMessage = {
      id: clientId,
      conversationId,
      senderUserId: myId ?? "me",
      type: "text",
      body,
      moneyTransfer: null,
      replyTo,
      createdAt,
      clientId,
    };

    composerTextRef.current = "";
    setText("");
    setReplyDraft(null);
    stopTyping();
    atLatestRef.current = true;
    setPinListOnInsert(false);
    setNewBelowCount(0);

    lastLocalSendAtRef.current = Date.now();
    setMessages((m) => {
      const next = [...m, optimistic];
      setMessagesSnapshot(token, conversationId, next);
      return next;
    });
    bumpConversationPreview(body, "text", createdAt);
    atLatestRef.current = true;
    scrollToLatest(false);
    requestAnimationFrame(() => scrollToLatest(false));
    void playChatSound("sent");

    sendingRef.current = true;
    try {
      const { message: rawMessage } = await sendChatTextMessage(
        token,
        conversationId,
        body,
        clientId,
        replyToMessageId,
      );
      const message = withNormalizedReplyTo(rawMessage);
      setMessages((m) => {
        const next = m.map((x) =>
          x.clientId === clientId
            ? withNormalizedReplyTo({
                ...message,
                replyTo:
                  getMessageReplyTo(message) ??
                  getMessageReplyTo(x) ??
                  replyTo,
                createdAt:
                  x.createdAt && message.createdAt && x.createdAt < message.createdAt
                    ? x.createdAt
                    : message.createdAt,
              })
            : x,
        );
        setMessagesSnapshot(token, conversationId, next);
        return next;
      });
      bumpConversationPreview(body, "text", message.createdAt);
    } catch (e) {
      setMessages((m) => {
        const next = m.filter((x) => x.clientId !== clientId);
        setMessagesSnapshot(token, conversationId, next);
        return next;
      });
      const msg =
        e instanceof ApiError && e.status > 0 && e.status < 500 && e.message.trim()
          ? e.message.trim()
          : t("messages.sendFailed");
      Alert.alert(t("messages.send"), msg);
    } finally {
      sendingRef.current = false;
    }
  };

  const clearRecTick = () => {
    if (recTickRef.current) {
      clearInterval(recTickRef.current);
      recTickRef.current = null;
    }
  };

  const startVoiceRec = async () => {
    if (recUi !== "idle" || recBusy) return;
    closeEmojiPanel();
    try {
      const voice = await import("@/lib/voice/record");
      const ok = await voice.requestMicPermission();
      if (!ok) {
        Alert.alert(t("messages.title"), t("messages.voiceMicDenied"));
        return;
      }
      void import("@/lib/voice/play").then((m) => m.stopVoice());
      const rec = await voice.createVoiceRecorder();
      recRef.current = rec;
      setRecMs(0);
      await rec.start();
      setRecUi("recording");
      void import("@/lib/messages/chatSounds").then((m) =>
        m.playChatSound("recordStart", { keepRecording: true }),
      );
      recTickRef.current = setInterval(() => {
        setRecMs((prev) => {
          const n = prev + 200;
          if (n >= 60_000) {
            void recRef.current?.pause();
            clearRecTick();
            setRecUi("paused");
            return 60_000;
          }
          return n;
        });
      }, 200);
    } catch {
      recRef.current = null;
      clearRecTick();
      setRecUi("idle");
      Alert.alert(t("messages.title"), t("common.genericError"));
    }
  };

  const pauseVoiceRec = async () => {
    if (recUi !== "recording") return;
    try {
      await recRef.current?.pause();
    } catch {
      /* ignore */
    }
    clearRecTick();
    setRecUi("paused");
    void import("@/lib/messages/chatSounds").then((m) =>
      m.playChatSound("recordStop", { keepRecording: true }),
    );
  };

  const resumeVoiceRec = async () => {
    if (recUi !== "paused") return;
    try {
      await recRef.current?.resume();
      setRecUi("recording");
      void import("@/lib/messages/chatSounds").then((m) =>
        m.playChatSound("recordStart", { keepRecording: true }),
      );
      recTickRef.current = setInterval(() => {
        setRecMs((prev) => {
          const n = prev + 200;
          if (n >= 60_000) {
            void recRef.current?.pause();
            clearRecTick();
            setRecUi("paused");
            return 60_000;
          }
          return n;
        });
      }, 200);
    } catch {
      /* ignore */
    }
  };

  const deleteVoiceRec = async () => {
    clearRecTick();
    try {
      await recRef.current?.discard();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    setRecUi("idle");
    setRecMs(0);
    void import("@/lib/messages/chatSounds").then((m) =>
      m.playChatSound("recordStop", { keepRecording: true }),
    );
  };

  const sendVoice = async () => {
    if (!token || recUi === "idle" || recBusy) return;
    setRecBusy(true);
    clearRecTick();
    let clip: { uri: string; durationMs: number } | null = null;
    try {
      clip = (await recRef.current?.stop()) ?? null;
    } catch {
      clip = null;
    }
    recRef.current = null;
    setRecUi("idle");
    setRecMs(0);
    setRecBusy(false);
    if (!clip) {
      Alert.alert(t("messages.title"), t("messages.voiceTooShort"));
      return;
    }
    void import("@/lib/messages/chatSounds").then((m) => {
      m.playChatSound("recordStop");
      m.playChatSound("sent");
    });
    const replyMsg = replyDraftRef.current;
    const replyTo =
      replyMsg != null
        ? replyToFromMessage(replyMsg, t, formatFcfa)
        : null;
    setReplyDraft(null);

    const clientId = newClientId();
    const optimistic: ChatMessage = {
      id: clientId,
      conversationId,
      senderUserId: myId ?? "me",
      type: "voice",
      body: null,
      moneyTransfer: null,
      voice: {
        key: "",
        durationMs: clip.durationMs,
        localUri: clip.uri,
      },
      replyTo,
      createdAt: new Date().toISOString(),
      clientId,
    };
    setMessages((m) => {
      const next = [...m, optimistic];
      setMessagesSnapshot(token, conversationId, next);
      return next;
    });
    bumpConversationPreview("VOICE", "voice", optimistic.createdAt);
    scrollToLatest(false);
    void (async () => {
      let uri = clip.uri;
      try {
        uri = await copyVoiceIntoCache(`pending-${clientId}`, clip.uri);
        setMessages((m) => {
          const next = m.map((x) =>
            x.clientId === clientId && x.voice
              ? { ...x, voice: { ...x.voice, localUri: uri } }
              : x,
          );
          setMessagesSnapshot(token, conversationId, next);
          return next;
        });
      } catch {
        /* uri rec encore bonne le temps du 1er essai */
      }
      kickVoiceOutbox(token);
    })().catch(() => {
      /* outbox / cache — la bulle reste */
    });
  };

  const imagePickBusyRef = useRef(false);
  const [pendingImages, setPendingImages] = useState<PendingImageAsset[] | null>(
    null,
  );
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const [pendingDocument, setPendingDocument] = useState<{
    file: import("@/lib/document/pick").PickedDocument;
    thumbLocalUri: string | null;
    pageCount?: number;
  } | null>(null);

  const enqueueOptimisticImage = useCallback(
    (
      asset: PendingImageAsset,
      caption: string | null,
      at: string,
      replyTo: ChatMessage["replyTo"],
    ) => {
      if (!token) return;
      const clientId = newClientId();
      const uri = asset.uri;
      const optimistic: ChatMessage = {
        id: clientId,
        conversationId,
        senderUserId: myId ?? "me",
        type: "image",
        body: caption,
        moneyTransfer: null,
        image: {
          key: "",
          width: asset.width,
          height: asset.height,
          localUri: uri,
          contentType: asset.contentType,
        },
        replyTo: replyTo ?? null,
        createdAt: at,
        clientId,
      };
      setMessages((m) => {
        const next = [...m, optimistic];
        setMessagesSnapshot(token, conversationId, next);
        return next;
      });
      void (async () => {
        let cached = uri;
        try {
          cached = await copyImageIntoCache(`pending-${clientId}`, uri);
          setMessages((m) => {
            const next = m.map((x) =>
              x.clientId === clientId && x.image
                ? { ...x, image: { ...x.image, localUri: cached } }
                : x,
            );
            setMessagesSnapshot(token, conversationId, next);
            return next;
          });
        } catch {
          /* uri d’origine */
        }
      })().catch(() => {});
    },
    [token, conversationId, myId],
  );

  const sendPendingImages = useCallback(
    (caption: string) => {
      if (!token || !pendingImages?.length) return;
      const cap = caption.trim() || null;
      const assets = pendingImages;
      const replyMsg = replyDraftRef.current;
      const replyTo =
        replyMsg != null
          ? replyToFromMessage(replyMsg, t, formatFcfa)
          : null;
      setReplyDraft(null);
      setPendingImages(null);
      void import("@/lib/messages/chatSounds").then((m) =>
        m.playChatSound("sent"),
      );
      const base = Date.now();
      let lastAt = "";
      for (let i = 0; i < assets.length; i++) {
        const at = new Date(base + i).toISOString();
        lastAt = at;
        enqueueOptimisticImage(assets[i], cap, at, replyTo);
      }
      const preview = cap ?? "📷";
      bumpConversationPreview(preview, "image", lastAt);
      atLatestRef.current = true;
      setPinListOnInsert(false);
      scrollToLatest(false);
      kickImageOutbox(token);
    },
    [
      token,
      pendingImages,
      enqueueOptimisticImage,
      bumpConversationPreview,
      scrollToLatest,
      t,
      formatFcfa,
    ],
  );

  const pickAndQueueImages = async () => {
    if (!token || imagePickBusyRef.current || recUi !== "idle") return;
    imagePickBusyRef.current = true;
    try {
      closeEmojiPanel();
      const granted = await ensureImageLibraryPermission();
      if (!granted) {
        Alert.alert(t("messages.title"), t("messages.imagePermissionDenied"));
        return;
      }
      const assets = await pickImagesFromLibrary();
      if (!assets?.length) return;
      setPendingImages(assets);
    } catch {
      Alert.alert(t("messages.title"), t("messages.imageSendFailed"));
    } finally {
      imagePickBusyRef.current = false;
    }
  };

  const pickAndQueueDocument = async () => {
    if (!token || recUi !== "idle") return;
    try {
      closeEmojiPanel();
      const { pickDocumentFromDevice } = await import("@/lib/document/pick");
      const file = await pickDocumentFromDevice();
      if (!file) return;
      const clientId = newClientId();
      const { prepareDocumentSendArtifacts } = await import(
        "@/lib/document/prepareSend"
      );
      const { thumbLocalUri, pageCount } = await prepareDocumentSendArtifacts(
        file,
        clientId,
      );
      setPendingDocument({ file, thumbLocalUri, pageCount });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "DOCUMENT_SIZE") {
        Alert.alert(t("messages.title"), t("messages.documentTooLarge"));
        return;
      }
      if (msg === "DOCUMENT_NATIVE_MISSING") {
        Alert.alert(t("messages.title"), t("messages.documentSendFailed"));
        return;
      }
      Alert.alert(t("messages.title"), t("messages.documentSendFailed"));
    }
  };

  const sendPendingDocument = useCallback(
    (caption: string) => {
      if (!token || !pendingDocument) return;
      const { file, thumbLocalUri, pageCount } = pendingDocument;
      const cap = caption.trim() || null;
      const replyMsg = replyDraftRef.current;
      const replyTo =
        replyMsg != null
          ? replyToFromMessage(replyMsg, t, formatFcfa)
          : null;
      const replyToMessageId = replyMsg?.id ?? null;
      setReplyDraft(null);
      setPendingDocument(null);
      void import("@/lib/messages/chatSounds").then((m) =>
        m.playChatSound("sent"),
      );
      const clientId = newClientId();
      const optimistic: ChatMessage = {
        id: clientId,
        conversationId,
        senderUserId: myId ?? "me",
        type: "document",
        body: cap,
        moneyTransfer: null,
        document: {
          key: "",
          fileName: file.name,
          sizeBytes: file.size,
          contentType: file.mimeType,
          localUri: file.uri,
          thumbKey: null,
          pageCount,
        },
        replyTo,
        createdAt: new Date().toISOString(),
        clientId,
      };
      setMessages((m) => {
        const next = [...m, optimistic];
        setMessagesSnapshot(token, conversationId, next);
        return next;
      });
      const preview = cap ?? `📄 ${file.name}`;
      bumpConversationPreview(preview, "document", optimistic.createdAt);
      scrollToLatest(false);
      void (async () => {
        try {
          const api = await import("@/lib/api/client");
          const { uploadDocumentFile } = await import("@/lib/document/upload");
          const signed = await api.presignDocumentUpload(
            token,
            conversationId,
            file.mimeType,
            file.name,
          );
          await uploadDocumentFile(
            signed.uploadUrl,
            file.uri,
            signed.contentType,
          );
          let thumbKey: string | null = null;
          if (thumbLocalUri) {
            const thumbSigned = await api.presignDocumentThumbUpload(
              token,
              conversationId,
            );
            await uploadDocumentFile(
              thumbSigned.uploadUrl,
              thumbLocalUri,
              thumbSigned.contentType,
            );
            thumbKey = thumbSigned.key;
          }
          const { message } = await api.sendDocumentMessage(
            token,
            conversationId,
            signed.key,
            file.name,
            file.size,
            file.mimeType,
            clientId,
            replyToMessageId,
            thumbKey,
            pageCount ?? null,
            cap,
          );
          setMessages((m) => {
            const next = m.map((x) =>
              x.clientId === clientId ? { ...message, clientId } : x,
            );
            setMessagesSnapshot(token, conversationId, next);
            return next;
          });
        } catch {
          Alert.alert(t("messages.title"), t("messages.documentSendFailed"));
        }
      })();
    },
    [
      token,
      pendingDocument,
      conversationId,
      myId,
      bumpConversationPreview,
      scrollToLatest,
      t,
      formatFcfa,
    ],
  );

  const rememberVoiceUri = useCallback(
    (key: string, uri: string) => {
      const k = String(key ?? "").trim();
      if (!token || !k || !uri) return;
      setMessages((prev) => {
        let changed = false;
        const next = prev.map((m) => {
          if (!m.voice || m.voice.key !== k || m.voice.localUri === uri) {
            return m;
          }
          changed = true;
          return { ...m, voice: { ...m.voice, localUri: uri } };
        });
        if (!changed) return prev;
        setMessagesSnapshot(token, conversationId, next);
        return next;
      });
    },
    [token, conversationId],
  );

  const resolveVoiceUri = useCallback(
    async (msg: ChatMessage): Promise<string> => {
      const v = msg.voice;
      if (!v) return "";
      const local = v.localUri?.trim() || "";
      if (local && (await voiceUriExists(local))) return local;
      if (v.key) {
        const disk = await peekVoiceCache(v.key);
        if (disk) {
          rememberVoiceUri(v.key, disk);
          return disk;
        }
      }
      if (!token || !v.key) return "";
      const uri = await ensureVoiceCached(token, conversationId, v.key);
      if (uri) rememberVoiceUri(v.key, uri);
      return uri;
    },
    [token, conversationId, rememberVoiceUri],
  );

  const prefetchThreadVoices = useCallback(
    (list: ChatMessage[]) => {
      if (!token) return;
      const keys = list
        .filter((m) => m.type === "voice" && m.voice?.key)
        .map((m) => m.voice!.key);
      if (keys.length === 0) return;
      InteractionManager.runAfterInteractions(() => {
        void (async () => {
          void import("@/lib/voice/play").then((m) => m.warmVoiceEngine());
          for (const key of keys) {
            try {
              const uri = await ensureVoiceCached(
                token,
                conversationId,
                key,
              );
              if (uri) rememberVoiceUri(key, uri);
            } catch {
              /* un vocal en échec n’arrête pas les autres */
            }
          }
        })();
      });
    },
    [token, conversationId, rememberVoiceUri],
  );
  prefetchVoicesRef.current = prefetchThreadVoices;

  const playVoiceMsg = useCallback(
    async (msg: ChatMessage) => {
      const v = msg.voice;
      if (!v) return;
      try {
        const play = await import("@/lib/voice/play");
        if (play.isActiveMessage(msg.id)) {
          await play.toggleActiveVoice();
          return;
        }
        const uri = await resolveVoiceUri(msg);
        if (!uri) {
          Alert.alert(t("messages.title"), t("messages.voicePlayFailed"));
          return;
        }
        await play.playVoice(uri, {
          messageId: msg.id,
          durationMs: v.durationMs,
        });
        const list = messagesRef.current;
        const i = list.findIndex((x) => x.id === msg.id);
        const nxt = i >= 0 ? list[i + 1] : undefined;
        if (
          nxt?.type === "voice" &&
          nxt.voice &&
          nxt.senderUserId === msg.senderUserId
        ) {
          void resolveVoiceUri(nxt).catch(() => {});
        }
      } catch {
        Alert.alert(t("messages.title"), t("messages.voicePlayFailed"));
      }
    },
    [resolveVoiceUri, t],
  );

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let alive = true;
    void import("@/lib/voice/play").then((m) => {
      if (!alive) return;
      unsub = m.subscribeVoiceFinished((id) => {
        const list = messagesRef.current;
        const i = list.findIndex((x) => x.id === id);
        if (i < 0) return;
        const cur = list[i];
        const nxt = list[i + 1];
        if (
          !nxt ||
          nxt.type !== "voice" ||
          !nxt.voice ||
          nxt.senderUserId !== cur.senderUserId
        ) {
          return;
        }
        void playVoiceMsg(nxt);
      });
    });
    return () => {
      alive = false;
      unsub?.();
    };
  }, [playVoiceMsg]);

  const sendMoney = async (pinOverride?: string) => {
    const pin = String(pinOverride ?? pinDigits).replace(/\D/g, "");
    const n =
      parseAmountFcfa(amount) ?? pendingMoneyAmountRef.current ?? null;
    if (!token || n == null || sending || pin.length !== 4) return;
    const moneyCaption = pendingMoneyCaptionRef.current.trim() || null;
    const bal = user?.balanceFcfa ?? 0;
    if (bal < n) {
      Alert.alert(
        t("pay.insufficientBalanceTitle"),
        t("messages.insufficientBalance"),
      );
      return;
    }

    const replyMsg = replyDraftRef.current;
    const replyTo =
      replyMsg != null
        ? replyToFromMessage(replyMsg, t, formatFcfa)
        : null;
    const replyToMessageId = replyMsg?.id ?? null;

    const clientId = newClientId();
    const idem = newClientId();
    const createdAt = new Date().toISOString();
    const optimistic: ChatMessage = {
      id: clientId,
      conversationId,
      senderUserId: myId ?? "me",
      type: "money",
      body: moneyCaption,
      moneyTransfer: {
        transferId: clientId,
        amountFcfa: n,
        status: "pending",
        fromUserId: myId ?? "me",
        toUserId: null,
        toPhone: peerPhone ?? "",
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        claimedAt: null,
        createdAt,
      },
      replyTo,
      createdAt,
      clientId,
    };

    setSending(true);
    setPinError(null);
    setAmount("");
    setPinDigits("");
    setMoneyStep("amount");
    setMoneyOpen(false);
    pendingMoneyCaptionRef.current = "";
    pendingMoneyAmountRef.current = null;
    setPendingMoneyAmount(null);
    setReplyDraft(null);
    lastLocalSendAtRef.current = Date.now();
    atLatestRef.current = true;
    setPinListOnInsert(false);
    setMessages((m) => {
      const next = [...m, optimistic];
      setMessagesSnapshot(token, conversationId, next);
      return next;
    });
    bumpConversationPreview(
      t("messages.moneyPreview", { amount: formatFcfa(n) }),
      "money",
      createdAt,
    );
    scrollToLatest(false);

    try {
      const { sendMoneyMessage } = await import("@/lib/api/client");
      const { message, balanceFcfa } = await sendMoneyMessage(
        token,
        conversationId,
        n,
        clientId,
        idem,
        pin,
        replyToMessageId,
        moneyCaption,
      );
      setMessages((m) => {
        const next = m.map((x) =>
          x.clientId === clientId ? { ...message, clientId } : x,
        );
        setMessagesSnapshot(token, conversationId, next);
        return next;
      });
      updateBalance(balanceFcfa);
      void refreshUser().catch(() => {});
      void import("@/lib/security/transactionPinVault").then((m) => {
        void m.saveTransactionPinVault(pin);
      });
    } catch (e) {
      setPinDigits("");
      setMessages((m) => {
        const next = m.filter((x) => x.clientId !== clientId);
        setMessagesSnapshot(token, conversationId, next);
        return next;
      });
      if (isTransactionPinInvalidError(e)) {
        setMoneyStep("pin");
        setMoneyOpen(true);
        setPinError(t("messages.pinIncorrect"));
        if (!pinInputRef.current?.isFocused()) pinInputRef.current?.focus();
        return;
      }
      Alert.alert(
        t("messages.sendMoney"),
        e instanceof ApiError && e.status > 0 && e.status < 500 && e.message.trim()
          ? e.message.trim()
          : t("messages.sendFailed"),
      );
    } finally {
      setSending(false);
    }
  };

  const beginMoneyPinOrBio = useCallback(async () => {
    const { tryUnlockTransactionPinVault } = await import(
      "@/lib/security/transactionPinVault"
    );
    const vaulted = await tryUnlockTransactionPinVault(
      t("pay.deviceAuthPrompt"),
    );
    if (vaulted) {
      void sendMoney(vaulted);
      return;
    }
    setPinDigits("");
    setPinError(null);
    setMoneyStep("pin");
    setMoneyOpen(true);
  }, [sendMoney, t]);

  const sendPendingMoneyCaption = useCallback(
    (caption: string) => {
      const moneyN = pendingMoneyAmountRef.current ?? pendingMoneyAmount;
      if (moneyN == null) return;
      pendingMoneyAmountRef.current = moneyN;
      setAmount(String(moneyN));
      pendingMoneyCaptionRef.current = caption.trim();
      setPendingMoneyAmount(null);
      void beginMoneyPinOrBio();
    },
    [beginMoneyPinOrBio, pendingMoneyAmount],
  );

  const applyTransfer = (
    transferId: string,
    transfer: ChatMessage["moneyTransfer"],
  ) => {
    if (!transfer) return;
    setMessages((m) => {
      const next = m.map((msg) =>
        msg.moneyTransfer?.transferId === transferId
          ? {
              ...msg,
              moneyTransfer: mergeMoneyTransfer(msg.moneyTransfer, transfer),
            }
          : msg,
      );
      if (token) setMessagesSnapshot(token, conversationId, next);
      return next;
    });
  };

  const onClaim = async (transferId: string, mine: boolean) => {
    if (!token || claimingId) return;
    setClaimingId(transferId);
    try {
      const { claimMoneyTransfer } = await import("@/lib/api/client");
      const { transfer, balanceFcfa } = await claimMoneyTransfer(
        token,
        transferId,
        mine ? "recall" : "claim",
      );
      applyTransfer(transferId, transfer);
      updateBalance(balanceFcfa);
      void refreshUser().catch(() => {});
    } catch {
      /* ignore */
    } finally {
      setClaimingId(null);
    }
  };

  const canDeleteForEveryone = useCallback(
    (msg: ChatMessage) => {
      if (!isMine(msg)) return false;
      if (msg.deletedForAll) return false;
      if (msg.clientId && msg.id === msg.clientId) return true;
      const created = Date.parse(msg.createdAt);
      if (
        !Number.isFinite(created) ||
        Date.now() - created > DELETE_FOR_ALL_MS
      ) {
        return false;
      }
      if (msg.type === "money" && msg.moneyTransfer?.status !== "pending") {
        return false;
      }
      return true;
    },
    [isMine],
  );

  const applyDeleteLocalMany = useCallback(
    (msgs: ChatMessage[], scope: "me" | "everyone") => {
      const ids = new Set(msgs.map((m) => m.id));
      setMessages((prev) => {
        let next: ChatMessage[];
        if (scope === "me") {
          next = prev.filter((m) => !ids.has(m.id));
        } else {
          next = prev.map((m) =>
            !ids.has(m.id)
              ? m
              : {
                  ...m,
                  type: "text",
                  body: null,
                  voice: null,
                  image: null,
                  moneyTransfer: null,
                  reactions: [],
                  replyTo: null,
                  deletedForAll: true,
                },
          );
        }
        if (token) setMessagesSnapshot(token, conversationId, next);
        return next;
      });
      if (scope === "everyone") {
        void import("@/lib/messages/live").then(({ notifyMessageDeleted }) => {
          for (const m of msgs) {
            notifyMessageDeleted({
              conversationId,
              messageId: m.id,
              deletedForAll: true,
            });
          }
        });
      }
    },
    [token, conversationId],
  );

  const performDeleteMany = useCallback(
    async (msgs: ChatMessage[], scope: "me" | "everyone") => {
      closeReactPicker();
      const serverMsgs = msgs.filter(
        (m) => !(m.clientId && m.id === m.clientId),
      );
      applyDeleteLocalMany(msgs, scope);
      if (!token || serverMsgs.length === 0) return;
      try {
        const { deleteChatMessage } = await import("@/lib/api/client");
        await Promise.all(
          serverMsgs.map((m) =>
            deleteChatMessage(token, conversationId, m.id, scope),
          ),
        );
      } catch (e) {
        const { ApiError } = await import("@/lib/api/errors");
        const msgKey =
          e instanceof ApiError && e.code === "DELETE_TOO_LATE"
            ? "messages.deleteTooLate"
            : "messages.deleteFailed";
        Alert.alert(t(msgKey));
        void pullThread();
      }
    },
    [token, conversationId, applyDeleteLocalMany, pullThread, t, closeReactPicker],
  );

  const promptDeleteSelected = useCallback(() => {
    const msgs = selectedMessageIds
      .map((id) => messages.find((m) => m.id === id))
      .filter((m): m is ChatMessage => Boolean(m));
    if (!msgs.length) return;
    const showEveryone = msgs.every((m) => canDeleteForEveryone(m));
    const title =
      msgs.length > 1
        ? t("messages.deleteTitleMany", { count: msgs.length })
        : t("messages.deleteTitle");
    const buttons: {
      text: string;
      onPress?: () => void;
      style?: "cancel" | "destructive" | "default";
    }[] = [
      {
        text: t("messages.deleteForMe"),
        style: "destructive",
        onPress: () => void performDeleteMany(msgs, "me"),
      },
    ];
    if (showEveryone) {
      buttons.push({
        text: t("messages.deleteForEveryone"),
        style: "destructive",
        onPress: () => void performDeleteMany(msgs, "everyone"),
      });
    }
    buttons.push({ text: t("common.cancel"), style: "cancel" });
    Alert.alert(title, undefined, buttons);
  }, [
    selectedMessageIds,
    messages,
    canDeleteForEveryone,
    performDeleteMany,
    t,
  ]);

  const onThanks = async (msg: ChatMessage) => {
    const transferId = msg.moneyTransfer?.transferId;
    if (!token || !transferId) return;
    closeReactPicker();
    const optimisticName =
      firstNameOf(user?.firstName) || t("messages.someone");
    applyTransfer(transferId, {
      ...msg.moneyTransfer!,
      thanksUserId: myId ?? "me",
      thanksFirstName: optimisticName,
    });
    try {
      const { thankMoneyTransfer } = await import("@/lib/api/client");
      const { transfer } = await thankMoneyTransfer(
        token,
        conversationId,
        transferId,
      );
      applyTransfer(transferId, transfer);
    } catch {
      /* ignore */
    }
  };

  const receiptGeneration = useMemo(
    () => packReceiptGeneration(peerLastReadAt, peerLastDeliveredAt),
    [peerLastReadAt, peerLastDeliveredAt],
  );

  const messageRowHandlersRef = useRef<ChatMessageRowHandlers>({
    openReactPicker: () => {},
    toggleMessageSelection: () => {},
    notifyMessageRowTouch: () => {},
    closeReactPicker: () => {},
    startReplyTo: () => {},
    scrollToMessageId: () => {},
    onClaim: () => {},
    setRecallTransferId: () => {},
    dismissHighlight: () => {},
    applyReaction: () => {},
    playVoiceMsg: () => {},
  });

  messageRowHandlersRef.current = {
    openReactPicker: (messageId) => {
      setSelectedMessageIds((prev) => {
        if (prev.includes(messageId)) return prev;
        return [...prev, messageId];
      });
      measureReactPickerPos();
    },
    toggleMessageSelection,
    notifyMessageRowTouch,
    closeReactPicker,
    startReplyTo,
    scrollToMessageId,
    onClaim,
    setRecallTransferId,
    dismissHighlight,
    applyReaction: (msg, emoji) => void applyReaction(msg, emoji),
    playVoiceMsg,
  };

  const registerReactAnchor = useCallback(
    (messageId: string, node: View | null) => {
      if (primarySelectId === messageId && selectedMessageIds.length === 1) {
        reactAnchorRef.current = node;
      } else if (reactAnchorRef.current === node) {
        reactAnchorRef.current = null;
      }
    },
    [primarySelectId, selectedMessageIds.length],
  );

  const reactTargetMsg = useMemo(
    () =>
      primarySelectId && selectedMessageIds.length === 1
        ? messages.find((m) => m.id === primarySelectId) ?? null
        : null,
    [messages, primarySelectId, selectedMessageIds.length],
  );

  const selectedCount = selectedMessageIds.length;
  const selectionExtraData = useMemo(
    () => selectedMessageIds.join("\u001f"),
    [selectedMessageIds],
  );
  const peerTranslationExtra = useMemo(
    () => Object.keys(peerTranslations).join("\u001f"),
    [peerTranslations],
  );
  const listExtraData = useMemo(
    () =>
      [
        selectionExtraData,
        receiptGeneration,
        claimingId ?? "",
        highlightedTransferId ?? "",
        newArrivalHighlightIds.size,
        peerTranslationExtra,
      ].join("\u001f"),
    [
      selectionExtraData,
      receiptGeneration,
      claimingId,
      highlightedTransferId,
      newArrivalHighlightIds.size,
      peerTranslationExtra,
    ],
  );
  const selectedIdSet = useMemo(
    () => new Set(selectedMessageIds),
    [selectedMessageIds],
  );

  const renderMessageItem = useCallback(
    ({ item, index }: { item: ChatMessage; index: number }) => {
      const showDate = threadListModel.showDateAt[index] ?? false;
      const mine = isMine(item);
      const tr = item.moneyTransfer;
      const isMoney = item.type === "money" && tr;
      const showClaim = isMoney ? canClaim(item) : false;
      const highlighted =
        isMoney &&
        tr?.transferId === highlightedTransferId &&
        Boolean(highlightedTransferId);
      return (
        <ChatMessageListRow
          item={item}
          showDate={showDate}
          mine={mine}
          selected={selectedIdSet.has(item.id)}
          selectionActive={selectionMode}
          highlighted={highlighted}
          newArrival={newArrivalHighlightIds.has(item.id)}
          claimingThis={claimingId === tr?.transferId}
          showClaim={showClaim}
          peerName={peerName}
          myId={myId}
          conversationId={conversationId}
          token={token}
          receiptGeneration={receiptGeneration}
          highlightedTransferId={highlightedTransferId}
          colors={colors}
          styles={styles}
          handlersRef={messageRowHandlersRef}
          registerReactAnchor={registerReactAnchor}
          peerTranslations={peerTranslations}
        />
      );
    },
    [
      threadListModel.showDateAt,
      isMine,
      canClaim,
      selectedIdSet,
      selectionMode,
      highlightedTransferId,
      newArrivalHighlightIds,
      claimingId,
      peerName,
      myId,
      conversationId,
      token,
      receiptGeneration,
      colors,
      styles,
      registerReactAnchor,
      peerTranslations,
    ],
  );

  const typingHeader = useMemo(() => {
    if (!peerTypingName) return null;
    const name = firstNameOf(peerName) || t("messages.someone");
    return (
      <View style={[styles.bubbleRow, styles.bubbleRowTheirs]}>
        <View style={[styles.bubble, styles.bubbleTheirs]}>
          <Text style={styles.threadTyping}>
            {t("messages.typing", { name })}
          </Text>
        </View>
      </View>
    );
  }, [peerTypingName, peerName, styles, t]);

  const closeMoneySheet = useCallback(() => {
    setMoneyOpen(false);
    setMoneyStep("amount");
    setPinDigits("");
    setPinError(null);
  }, []);

  const navigation = useNavigation();

  const leaveChat = useCallback(() => {
    stopTyping();
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/messages");
  }, [stopTyping]);

  const handleThreadBack = useCallback(() => {
    if (emojiOpenRef.current || emojiPanelVisibleRef.current) {
      closeEmojiPanel();
      return true;
    }
    return false;
  }, [closeEmojiPanel]);

  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", (e) => {
      if (!emojiOpenRef.current && !emojiPanelVisibleRef.current) return;
      e.preventDefault();
      closeEmojiPanel();
    });
    return unsub;
  }, [navigation, closeEmojiPanel]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (handleThreadBack()) return true;
      if (recallTransferId) {
        setRecallTransferId(null);
        return true;
      }
      if (replyDraft) {
        setReplyDraft(null);
        return true;
      }
      if (moneyOpen) {
        if (moneyStep === "pin") {
          setMoneyStep("amount");
          setPinDigits("");
          setPinError(null);
          return true;
        }
        closeMoneySheet();
        return true;
      }
      if (selectionMode) {
        closeReactPicker();
        return true;
      }
      if (highlightedTransferId) {
        setHighlightedTransferId(null);
        return true;
      }
      stopTyping();
      return false;
    });
    return () => sub.remove();
  }, [
    stopTyping,
    handleThreadBack,
    selectionMode,
    highlightedTransferId,
    moneyOpen,
    moneyStep,
    closeMoneySheet,
    recallTransferId,
    closeReactPicker,
    replyDraft,
  ]);

  const amountOk = parseAmountFcfa(amount) != null;
  /** Clavier IME seulement ; panneau emoji dans le flux sous le composer. */
  const composerLift = emojiPanelVisible ? 0 : keyboardHeight;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {selectionMode ? (
        <View style={styles.threadSelectHeader}>
          <Pressable
            style={styles.headerBtn}
            onPress={closeReactPicker}
            accessibilityRole="button"
            accessibilityLabel={t("common.cancel")}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <Text
            style={styles.threadSelectCount}
            accessibilityLabel={t("messages.selectedCount", {
              count: selectedCount,
            })}
          >
            {selectedCount}
          </Text>
          <View style={styles.threadSelectActions}>
            <Pressable
              style={styles.headerBtn}
              onPress={() => {
                if (reactTargetMsg && !reactTargetMsg.deletedForAll) {
                  startReplyTo(reactTargetMsg);
                }
              }}
              disabled={
                selectedCount !== 1 ||
                !reactTargetMsg ||
                reactTargetMsg.deletedForAll
              }
              accessibilityRole="button"
              accessibilityLabel={t("messages.replyA11y")}
            >
              <Ionicons
                name="arrow-undo"
                size={22}
                color={
                  selectedCount === 1 &&
                  reactTargetMsg &&
                  !reactTargetMsg.deletedForAll
                    ? colors.text
                    : colors.placeholder
                }
              />
            </Pressable>
            <Pressable
              style={styles.headerBtn}
              onPress={() => promptDeleteSelected()}
              accessibilityRole="button"
              accessibilityLabel={t("messages.deleteA11y")}
            >
              <Ionicons name="trash-outline" size={22} color={colors.text} />
            </Pressable>
          </View>
        </View>
      ) : (
        <View
          style={styles.threadHeader}
          onTouchStart={() => {
            dismissHighlight();
          }}
        >
          <Pressable
            style={styles.headerBtn}
            onPress={() => {
              if (handleThreadBack()) return;
              stopTyping();
              leaveChat();
            }}
            accessibilityLabel={t("common.back")}
          >
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <PeerAvatar
            name={peerName}
            phone={peerPhone}
            remoteUrl={peerAvatarUrl ?? demoAvatarUrlForPhone(peerPhone)}
            localUri={contactPhotoUriForPhone(peerPhone)}
            size={40}
            style={styles.threadHeaderAvatar}
            recyclingKey={conversationId}
          />
          <View style={styles.threadHeaderText}>
            <Text style={styles.threadTitle} numberOfLines={1}>
              {peerName}
            </Text>
            {!peerOnBlyp ? (
              <View>
                <Text style={styles.badge}>{t("messages.notOnBlyp")}</Text>
                <Text style={styles.badgeHint} numberOfLines={2}>
                  {t("messages.notOnBlypInvite")}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      )}

      <View style={{ flex: 1, paddingBottom: composerLift }}>
        {loading && messages.length === 0 ? (
          <View style={styles.emptyWrap}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <View
            style={{ flex: 1 }}
            ref={listLayerRef}
            collapsable={false}
            onTouchEndCapture={handleListTouchEndCapture}
          >
          <FlatList
            ref={listRef}
            inverted
            style={{ flex: 1 }}
            removeClippedSubviews={Platform.OS === "android"}
            windowSize={7}
            maxToRenderPerBatch={8}
            updateCellsBatchingPeriod={24}
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            data={newestFirst}
            onContentSizeChange={onThreadListContentSizeChange}
            initialNumToRender={14}
            maintainVisibleContentPosition={
              pinListOnInsert
                ? {
                    minIndexForVisible: 0,
                    autoscrollToTopThreshold: 48,
                  }
                : undefined
            }
            keyExtractor={(m) => m.id}
            extraData={listExtraData}
            ListHeaderComponent={typingHeader}
            contentContainerStyle={[
              styles.messagesList,
              { flexGrow: 1 },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            scrollEventThrottle={32}
            onScroll={onListScroll}
            onScrollToIndexFailed={({ index }) => {
              setTimeout(() => {
                listRef.current?.scrollToIndex({
                  index,
                  animated: true,
                  viewPosition: 0.35,
                });
              }, 160);
            }}
            onScrollBeginDrag={() => {
              if (!selectionMode) closeReactPicker();
              dismissHighlight();
              revealStickyDate();
            }}
            onMomentumScrollBegin={revealStickyDate}
            onScrollEndDrag={hideStickyDateSoon}
            onMomentumScrollEnd={hideStickyDateSoon}
            renderItem={renderMessageItem}
          />
          {stickyDateOn && stickyDate ? (
            <View style={styles.dateChipFloat} pointerEvents="none">
              <View style={styles.dateChip}>
                <Text style={styles.dateChipText}>{stickyDate}</Text>
              </View>
            </View>
          ) : null}
          {newBelowCount > 0 ? (
            <View style={styles.newBelowFloat} pointerEvents="box-none">
              <Pressable
                style={styles.newBelowPill}
                onPress={jumpToNewBelow}
                accessibilityRole="button"
                accessibilityLabel={t("messages.unreadCount", {
                  count: newBelowCount,
                })}
              >
                <Ionicons
                  name="chevron-down"
                  size={18}
                  color={colors.accentOn}
                />
                <Text style={styles.newBelowPillText}>
                  {t("messages.unreadCount", { count: newBelowCount })}
                </Text>
              </Pressable>
            </View>
          ) : pinListOnInsert ? (
            <Pressable
              style={[
                styles.scrollDownFab,
                { backgroundColor: colors.modal, borderColor: colors.borderLight },
              ]}
              onPress={() => {
                atLatestRef.current = true;
                setPinListOnInsert(false);
                scrollToLatest(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={t("messages.scrollToBottomA11y")}
              hitSlop={8}
            >
              <Ionicons
                name="chevron-down"
                size={22}
                color={colors.textSecondary}
              />
            </Pressable>
          ) : null}
          {selectionMode ? (
            <>
              {selectedCount === 1 &&
              reactPickerPos &&
              reactTargetMsg &&
              ((!reactTargetMsg.deletedForAll &&
                !reactTargetMsg.id.startsWith("c-")) ||
                canThank(reactTargetMsg)) ? (
                <View
                  style={[
                    styles.reactPickerOverlay,
                    {
                      top: reactPickerPos.top,
                      left: reactPickerPos.left,
                      width: reactPickerPos.width,
                    },
                  ]}
                  pointerEvents="box-none"
                >
                  <ReactionPicker
                    styles={styles}
                    showReactions={
                      !reactTargetMsg.deletedForAll &&
                      !reactTargetMsg.id.startsWith("c-")
                    }
                    onPick={(emoji) => {
                      if (reactTargetMsg) void applyReaction(reactTargetMsg, emoji);
                      else closeReactPicker();
                    }}
                    thanksLabel={
                      reactTargetMsg && canThank(reactTargetMsg)
                        ? t("messages.thanksPick")
                        : undefined
                    }
                    onThanks={
                      reactTargetMsg && canThank(reactTargetMsg)
                        ? () => void onThanks(reactTargetMsg)
                        : undefined
                    }
                  />
                </View>
              ) : null}
            </>
          ) : null}
          </View>
        )}
        <View
          style={{
            backgroundColor: colors.background,
            paddingBottom:
              keyboardHeight > 0 || emojiPanelVisible
                ? 0
                : Math.max(insets.bottom, 0),
          }}
        >
          {replyDraft &&
          recUi === "idle" &&
          !pendingImages?.length &&
          !pendingDocument &&
          pendingMoneyAmount == null ? (
            <ComposerReplyBar
              replyTo={replyToFromMessage(replyDraft, t, formatFcfa)}
              myId={myId}
              peerName={peerName}
              styles={styles}
              onClose={() => setReplyDraft(null)}
            />
          ) : null}
        <View
          style={[
            styles.composer,
            {
              /** Safe area : uniquement sur le wrapper parent — pas 2× insets.bottom. */
              paddingBottom: 8,
            },
          ]}
          onTouchStart={() => {
            if (selectionMode) closeReactPicker();
            dismissHighlight();
          }}
        >
          {(pendingImages?.length ||
            pendingDocument ||
            pendingMoneyAmount != null) &&
          recUi === "idle" ? (
            <View style={[styles.composerField, { alignItems: "flex-end" }]}>
              <ImageCaptionComposer
                assets={pendingImages}
                document={
                  pendingDocument
                    ? {
                        fileName: pendingDocument.file.name,
                        previewUri: pendingDocument.thumbLocalUri,
                      }
                    : null
                }
                money={
                  pendingMoneyAmount != null
                    ? { amountLabel: formatFcfa(pendingMoneyAmount) }
                    : null
                }
                colors={colors}
                styles={styles}
                onCancel={() => {
                  setPendingImages(null);
                  setPendingDocument(null);
                  pendingMoneyAmountRef.current = null;
                  setPendingMoneyAmount(null);
                }}
                onSend={
                  pendingMoneyAmount != null
                    ? sendPendingMoneyCaption
                    : pendingDocument
                      ? sendPendingDocument
                      : sendPendingImages
                }
              />
            </View>
          ) : (
          <View style={styles.composerField}>
          <Pressable
            style={styles.moneyIconBtn}
              onPress={() => {
                setAmount("");
                setPinDigits("");
                setMoneyStep("amount");
                setMoneyOpen(true);
              }}
            accessibilityLabel={t("messages.sendMoney")}
          >
            <Text style={{ fontSize: 18 }}>💰</Text>
          </Pressable>
            {recUi === "idle" ? (
          <TextInput
                ref={composerRef}
            style={styles.composerInput}
            placeholder={t("messages.composerPlaceholder")}
            placeholderTextColor={colors.placeholder}
            value={text}
                onChangeText={onComposerChange}
                onFocus={() => closeEmojiPanel()}
            multiline
          />
            ) : (
              <View style={styles.recBar}>
                <View
                  style={[
                    styles.recDot,
                    recUi === "paused" && { opacity: 0.35 },
                  ]}
                />
                <Text style={styles.recTime}>{formatVoiceClock(recMs)}</Text>
                <Pressable
                  onPress={() =>
                    recUi === "recording"
                      ? void pauseVoiceRec()
                      : void resumeVoiceRec()
                  }
                  accessibilityLabel={
                    recUi === "recording"
                      ? t("messages.voicePause")
                      : t("messages.voiceResume")
                  }
                  hitSlop={8}
                >
                  <Ionicons
                    name={recUi === "recording" ? "pause" : "play"}
                    size={22}
                    color={colors.text}
                  />
                </Pressable>
                <Pressable
                  onPress={() => void deleteVoiceRec()}
                  accessibilityLabel={t("messages.voiceDelete")}
                  hitSlop={8}
                >
                  <Ionicons
                    name="trash-outline"
                    size={20}
                    color={colors.destructive}
                  />
                </Pressable>
              </View>
            )}
            {recUi === "idle" ? (
              <Pressable
                style={styles.composerEmojiBtn}
                onPress={() => setAttachSheetOpen(true)}
                accessibilityLabel={t("messages.attachA11y")}
              >
                <Ionicons
                  name="document-outline"
                  size={22}
                  color={colors.textMuted}
                />
              </Pressable>
            ) : null}
            {recUi === "idle" ? (
              <Pressable
                style={styles.composerEmojiBtn}
                onPress={toggleEmojiKeyboard}
                accessibilityLabel={
                  emojiOpen || emojiPanelVisible
                    ? t("messages.emojiShowKeyboard")
                    : t("messages.emojiShowPicker")
                }
              >
                <Ionicons
                  name={
                    emojiOpen || emojiPanelVisible
                      ? "keypad-outline"
                      : "happy-outline"
                  }
                  size={22}
                  color={colors.textMuted}
                />
              </Pressable>
            ) : null}
          </View>
          )}
          {pendingImages?.length && recUi === "idle" ? null : recUi ===
            "idle" && !text.trim() ? (
            <Pressable
              style={styles.sendBtn}
              onPress={() => void startVoiceRec()}
              accessibilityLabel={t("messages.voiceRecord")}
            >
              <Ionicons name="mic" size={20} color={colors.accentOn} />
            </Pressable>
          ) : (
          <Pressable
            style={[
              styles.sendBtn,
                recUi === "idle" && !text.trim() && styles.sendBtnDisabled,
                recUi !== "idle" && recBusy && styles.sendBtnDisabled,
              ]}
              disabled={recUi === "idle" ? !text.trim() : recBusy}
              onPress={() =>
                recUi === "idle" ? void sendText() : void sendVoice()
              }
              accessibilityLabel={
                recUi === "idle" ? t("messages.send") : t("messages.voiceSend")
              }
          >
            <Ionicons name="send" size={18} color={colors.accentOn} />
          </Pressable>
          )}
        </View>
        {emojiPickerMounted && recUi === "idle" ? (
          <View
            style={{
              height: emojiPanelVisible
                ? CHAT_EMOJI_PANEL_HEIGHT + Math.max(insets.bottom, 0)
                : 0,
              backgroundColor: colors.background,
              overflow: "hidden",
              opacity: emojiPanelVisible ? 1 : 0,
            }}
            pointerEvents={emojiPanelVisible ? "auto" : "none"}
          >
            {EmojiPickerView ? (
              <EmojiPickerView
                colors={colors}
                onPick={onEmojiPick}
                backgroundColor={colors.background}
                borderColor={colors.borderLight}
              />
            ) : (
              <View
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ActivityIndicator color={colors.accent} />
              </View>
            )}
          </View>
        ) : null}
        </View>
      </View>

      <Modal
        visible={moneyOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (moneyStep === "pin") {
            setMoneyStep("amount");
            setPinDigits("");
            setPinError(null);
            return;
          }
          closeMoneySheet();
        }}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={closeMoneySheet}
        />
        <View
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, 16) + 12,
              bottom: moneyStep === "pin" ? pinSheetLift : 0,
            },
          ]}
        >
          <Text style={styles.sheetTitle}>
            {moneyStep === "pin" ? t("messages.pinTitle") : t("messages.sendMoney")}
          </Text>
          {moneyStep === "pin" ? (
            <View style={{ alignItems: "center", marginBottom: 16 }}>
              <Text
                style={{
                  textAlign: "center",
                  color: colors.textMuted,
                  marginBottom: 16,
                }}
              >
                {t("messages.pinHint")}
              </Text>
              <MaskedPinInput
                key={pinInputKey}
                ref={pinInputRef}
                digits={pinDigits}
                error={Boolean(pinError)}
                onDigitsChange={(d) => {
                  if (sending) return;
                  if (pinError) setPinError(null);
                  setPinDigits(d);
                  if (d.length === 4) void sendMoney(d);
                }}
                onTouchStart={() => {
                  if (pinError) setPinError(null);
                }}
                maxLength={4}
                autoFocus
                showSoftInputOnFocus
                editable
                accessibilityLabel={t("messages.pinTitle")}
              />
              {pinError ? (
                <Text
                  style={styles.pinError}
                  accessibilityLiveRegion="polite"
                >
                  {pinError}
                </Text>
              ) : null}
              <Pressable
                onPress={() => void beginMoneyPinOrBio()}
                accessibilityRole="button"
                accessibilityLabel={t("messages.moneyBiometricUnlock")}
                style={{ marginTop: 14, paddingVertical: 8 }}
              >
                <Text
                  style={{
                    color: colors.accent,
                    fontSize: 15,
                    fontWeight: "600",
                    textAlign: "center",
                  }}
                >
                  {t("messages.moneyBiometricUnlock")}
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
          <Text
            style={{
              textAlign: "center",
              fontSize: 36,
              fontWeight: "800",
              color: colors.text,
              marginBottom: 8,
            }}
          >
            {amount === "" ? "0" : formatFcfa(parseAmountFcfa(amount) ?? 0)}{" "}
            <Text style={{ fontSize: 18, color: colors.textMuted }}>
              {t("common.fcfa")}
            </Text>
          </Text>
          <AmountNumericKeypad
            onDigit={(d) =>
              setAmount((prev) => {
                if (prev.length >= 6) return prev;
                if (prev === "" && d === "0") return prev;
                return prev + d;
              })
            }
            onBackspace={() => {
              setAmount((p) => p.slice(0, -1));
              return amount.length <= 1;
            }}
            onConfirm={() => {
              if (!amountOk || sending) return;
              const n = parseAmountFcfa(amount);
              if (n == null) return;
              pendingMoneyAmountRef.current = n;
              setPendingMoneyAmount(n);
              setAmount("");
              setMoneyOpen(false);
            }}
            confirmEnabled={amountOk && !sending}
            confirmVariant="outline"
            disabled={sending}
          />
            </>
          )}
          <Pressable
            style={[
              styles.primaryBtn,
              (moneyStep === "pin"
                ? pinDigits.length !== 4 || sending
                : !amountOk || sending) && styles.primaryBtnDisabled,
            ]}
            disabled={
              moneyStep === "pin"
                ? pinDigits.length !== 4 || sending
                : !amountOk || sending
            }
            onPress={() => {
              if (moneyStep === "amount") {
                const n = parseAmountFcfa(amount);
                if (n == null) return;
                pendingMoneyAmountRef.current = n;
                setPendingMoneyAmount(n);
                setAmount("");
                setMoneyOpen(false);
                return;
              }
              void sendMoney(pinDigits);
            }}
          >
            {sending ? (
              <ActivityIndicator color={colors.accentOn} />
            ) : (
              <Text style={styles.primaryBtnText}>{t("messages.send")}</Text>
            )}
          </Pressable>
        </View>
      </Modal>

      <ChatAttachSheet
        visible={attachSheetOpen}
        onClose={() => setAttachSheetOpen(false)}
        onPickPhoto={() => {
          setAttachSheetOpen(false);
          void pickAndQueueImages();
        }}
        onPickDocument={() => {
          setAttachSheetOpen(false);
          void pickAndQueueDocument();
        }}
      />

      <Modal
        visible={Boolean(recallTransferId)}
        transparent
        animationType="fade"
        onRequestClose={() => setRecallTransferId(null)}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setRecallTransferId(null)}
        />
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, 16) + 12 },
          ]}
        >
          <Text style={styles.sheetTitle}>
            {t("messages.recallConfirmTitle")}
          </Text>
          <Text
            style={{
              textAlign: "center",
              color: colors.textMuted,
              fontSize: 15,
              lineHeight: 22,
              marginBottom: 16,
            }}
          >
            {t("messages.recallConfirmBody", {
              name: firstNameOf(peerName) || t("messages.someone"),
            })}
          </Text>
          <Pressable
            style={[
              styles.primaryBtn,
              claimingId === recallTransferId && styles.primaryBtnDisabled,
            ]}
            disabled={Boolean(claimingId)}
            onPress={() => {
              const id = recallTransferId;
              setRecallTransferId(null);
              if (id) void onClaim(id, true);
            }}
          >
            {claimingId === recallTransferId ? (
              <ActivityIndicator color={colors.accentOn} />
            ) : (
              <Text style={styles.primaryBtnText}>
                {t("messages.recallConfirmAction")}
              </Text>
            )}
          </Pressable>
          <Pressable
            style={{ marginTop: 12, alignItems: "center", paddingVertical: 8 }}
            onPress={() => setRecallTransferId(null)}
            accessibilityRole="button"
            accessibilityLabel={t("messages.recallConfirmDismiss")}
          >
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 16,
                fontWeight: "600",
              }}
            >
              {t("messages.recallConfirmDismiss")}
            </Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
