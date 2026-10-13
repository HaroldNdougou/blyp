import { createMessagesStyles } from "@/components/messages/messagesStyles";
import { AmountNumericKeypad } from "@/components/pay/AmountNumericKeypad";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { parseAmountFcfa } from "@/lib/amountLimits";
import type { ChatMessage, Conversation } from "@/lib/api/types";
import { formatFcfa } from "@/lib/formatFcfa";
import { formatMessageTime } from "@/lib/format";
import {
  getConversationsSnapshot,
  getMessagesSnapshot,
  setConversationsSnapshot,
  setMessagesSnapshot,
} from "@/lib/messagesCache";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Keyboard,
  type KeyboardEvent,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

function newClientId() {
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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

  // Géométrie écran si crédible (sinon height seule).
  let lift =
    screenY > 40 && frameLift >= height - 8
      ? Math.max(height, frameLift)
      : height;

  if (Platform.OS === "android") {
    // Frame ≈ height → bandeau icônes MIUI/Gboard probablement exclu.
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
  const params = useLocalSearchParams<{ id?: string }>();
  const conversationId = decodeURIComponent(
    typeof params.id === "string" ? params.id : "",
  );

  const myId = user?.id ?? null;
  const myPhone = user?.phone ?? "";

  const [peerName, setPeerName] = useState("…");
  const [peerPhone, setPeerPhone] = useState<string | null>(null);
  const [peerOnBlyp, setPeerOnBlyp] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [moneyOpen, setMoneyOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = (e: KeyboardEvent) => {
      setKeyboardHeight(imeLiftPx(e));
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
      });
    };
    const onHide = () => setKeyboardHeight(0);
    /** MIUI : la barre suggestions peut apparaître après le DidShow. */
    const onFrame = (e: KeyboardEvent) => {
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
  }, []);

  useEffect(() => {
    if (!token || !conversationId) return;
    const convs = getConversationsSnapshot(token);
    const conv = convs?.find((c) => c.id === conversationId);
    if (conv) {
      setPeerName(conv.peerName);
      setPeerPhone(conv.peerPhone);
      setPeerOnBlyp(Boolean(conv.peerUserId));
    }
    const cached = getMessagesSnapshot(token, conversationId);
    if (cached) {
      setMessages(cached);
      setLoading(false);
    }

    let cancelled = false;
    void (async () => {
      try {
        const { listMessages } = await import("@/lib/api/client");
        const { items } = await listMessages(token, conversationId);
        if (cancelled) return;
        setMessagesSnapshot(token, conversationId, items);
        setMessages(items);
      } catch {
        /* keep cache */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, conversationId]);

  const bumpConversationPreview = useCallback(
    (preview: string, type: "text" | "money") => {
      if (!token) return;
      const prev = getConversationsSnapshot(token) ?? [];
      const now = new Date().toISOString();
      const next: Conversation[] = prev.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              lastMessagePreview: preview,
              lastMessageType: type,
              lastMessageAt: now,
              updatedAt: now,
            }
          : c,
      );
      setConversationsSnapshot(token, next);
    },
    [token, conversationId],
  );

  const isMine = (msg: ChatMessage) => {
    if (msg.clientId) return true;
    if (myId && msg.senderUserId === myId) return true;
    if (
      msg.moneyTransfer &&
      peerPhone &&
      msg.moneyTransfer.toPhone === peerPhone
    ) {
      return true;
    }
    return false;
  };

  const canClaim = (msg: ChatMessage) => {
    const tr = msg.moneyTransfer;
    if (!tr || tr.status !== "pending") return false;
    if (myId && tr.fromUserId === myId) return false;
    if (myPhone && tr.toPhone === myPhone) return true;
    return false;
  };

  const sendText = async () => {
    const body = text.trim();
    if (!token || !body || sending) return;
    setSending(true);
    const clientId = newClientId();
    const optimistic: ChatMessage = {
      id: clientId,
      conversationId,
      senderUserId: myId ?? "me",
      type: "text",
      body,
      moneyTransfer: null,
      createdAt: new Date().toISOString(),
      clientId,
    };
    setMessages((m) => [...m, optimistic]);
    setText("");
    bumpConversationPreview(body, "text");
    try {
      const { sendTextMessage } = await import("@/lib/api/client");
      const { message } = await sendTextMessage(
        token,
        conversationId,
        body,
        clientId,
      );
      setMessages((m) => {
        const next = m.map((x) => (x.clientId === clientId ? message : x));
        setMessagesSnapshot(token, conversationId, next);
        return next;
      });
    } catch {
      setMessages((m) => m.filter((x) => x.clientId !== clientId));
    } finally {
      setSending(false);
    }
  };

  const sendMoney = async () => {
    const n = parseAmountFcfa(amount);
    if (!token || n == null || sending) return;
    const bal = user?.balanceFcfa ?? 0;
    if (bal < n) {
      Alert.alert(
        t("pay.insufficientBalanceTitle"),
        t("messages.insufficientBalance"),
      );
      return;
    }

    const clientId = newClientId();
    const idem = newClientId();
    const now = new Date().toISOString();
    const optimistic: ChatMessage = {
      id: clientId,
      conversationId,
      senderUserId: myId ?? "me",
      type: "money",
      body: null,
      moneyTransfer: {
        transferId: clientId,
        amountFcfa: n,
        status: "pending",
        fromUserId: myId ?? "me",
        toUserId: null,
        toPhone: peerPhone ?? "",
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
        claimedAt: null,
        createdAt: now,
      },
      createdAt: now,
      clientId,
    };

    // Instantané : le montant « part » du modal → bulle envoyée
    setMoneyOpen(false);
    setAmount("");
    setSending(true);
    setMessages((m) => [...m, optimistic]);
    bumpConversationPreview(
      t("messages.moneyPreview", { amount: formatFcfa(n) }),
      "money",
    );
    updateBalance(bal - n);
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });

    try {
      const { sendMoneyMessage } = await import("@/lib/api/client");
      const { message, balanceFcfa } = await sendMoneyMessage(
        token,
        conversationId,
        n,
        clientId,
        idem,
      );
      setMessages((m) => {
        const next = m.map((x) => (x.clientId === clientId ? message : x));
        setMessagesSnapshot(token, conversationId, next);
        return next;
      });
      updateBalance(balanceFcfa);
      void refreshUser();
    } catch {
      setMessages((m) => m.filter((x) => x.clientId !== clientId));
      updateBalance(bal);
      Alert.alert(t("messages.sendMoney"), t("messages.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  const onClaim = async (transferId: string) => {
    if (!token || claimingId) return;
    setClaimingId(transferId);
    try {
      const { claimMoneyTransfer } = await import("@/lib/api/client");
      const { transfer, balanceFcfa } = await claimMoneyTransfer(
        token,
        transferId,
      );
      setMessages((m) => {
        const next = m.map((msg) =>
          msg.moneyTransfer?.transferId === transferId
            ? { ...msg, moneyTransfer: transfer }
            : msg,
        );
        setMessagesSnapshot(token, conversationId, next);
        return next;
      });
      updateBalance(balanceFcfa);
      void refreshUser();
    } catch {
      /* ignore */
    } finally {
      setClaimingId(null);
    }
  };

  const statusLabel = (status: string) => {
    if (status === "claimed") return t("messages.statusClaimed");
    if (status === "expired") return t("messages.statusExpired");
    return t("messages.statusPending");
  };

  const moneyAmountColor = (
    status: string,
    mine: boolean,
  ): string => {
    if (status === "claimed") return colors.moneyAmountClaimed;
    if (status === "expired" || status === "cancelled") {
      return colors.moneyAmountExpired;
    }
    // pending
    return mine ? colors.moneyAmountSent : colors.moneyAmountPending;
  };

  const isSendingOptimistic = (msg: ChatMessage) =>
    Boolean(msg.clientId && msg.id === msg.clientId);

  /** Heure (+ coche si mien) : un simple espace après le message. */
  const renderBubbleMetaInline = (msg: ChatMessage, mine: boolean) => {
    const time = formatMessageTime(msg.createdAt);
    if (!time) return null;
    const sending = mine && isSendingOptimistic(msg);
    return (
      <Text
        style={styles.bubbleMetaTime}
        accessibilityLabel={
          mine
            ? `${time}, ${sending ? t("messages.sendingA11y") : t("messages.sentA11y")}`
            : time
        }
      >
        {` ${time}`}
        {mine ? (
          <Text style={styles.bubbleMetaCheck}>
            {sending ? " …" : " ✓"}
          </Text>
        ) : null}
      </Text>
    );
  };

  const amountOk = parseAmountFcfa(amount) != null;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.threadHeader}>
        <Pressable
          style={styles.headerBtn}
          onPress={() => router.back()}
          accessibilityLabel={t("common.back")}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <View style={styles.threadHeaderText}>
          <Text style={styles.threadTitle} numberOfLines={1}>
            {peerName}
          </Text>
          {!peerOnBlyp ? (
            <Text style={styles.badge}>{t("messages.notOnBlyp")}</Text>
          ) : null}
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {loading && messages.length === 0 ? (
          <View style={styles.emptyWrap}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={[
              styles.messagesList,
              {
                paddingBottom:
                  56 +
                  (keyboardHeight > 0
                    ? keyboardHeight
                    : Math.max(insets.bottom, 8)),
              },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onContentSizeChange={() =>
              listRef.current?.scrollToEnd({ animated: false })
            }
            initialNumToRender={16}
            windowSize={9}
            renderItem={({ item }) => {
              const mine = isMine(item);
              const isMoney = item.type === "money" && item.moneyTransfer;
              const tr = item.moneyTransfer;
              const showClaim = isMoney ? canClaim(item) : false;
              const amountLabel = tr
                ? `${formatFcfa(tr.amountFcfa)} ${t("common.fcfa")}`
                : "";
              const body = isMoney ? amountLabel : (item.body ?? "");
              const amountColor =
                isMoney && tr
                  ? moneyAmountColor(tr.status, mine)
                  : undefined;
              const a11y = isMoney && tr
                ? showClaim
                  ? t("messages.claimTapA11y", {
                      amount: formatFcfa(tr.amountFcfa),
                    })
                  : `${amountLabel}, ${statusLabel(tr.status)}`
                : undefined;

              const bubble = (
                <View
                  style={[
                    styles.bubble,
                    mine ? styles.bubbleMine : styles.bubbleTheirs,
                  ]}
                >
                  <Text
                    style={[
                      isMoney ? styles.moneyAmountText : styles.bubbleText,
                      !isMoney &&
                        (mine
                          ? styles.bubbleTextMine
                          : styles.bubbleTextTheirs),
                      amountColor ? { color: amountColor } : null,
                      claimingId === tr?.transferId && { opacity: 0.55 },
                    ]}
                  >
                    {body}
                    {renderBubbleMetaInline(item, mine)}
                  </Text>
                </View>
              );

              return (
                <View
                  style={[
                    styles.bubbleRow,
                    mine ? styles.bubbleRowMine : styles.bubbleRowTheirs,
                  ]}
                >
                  {showClaim && tr ? (
                    <Pressable
                      onPress={() => void onClaim(tr.transferId)}
                      disabled={claimingId === tr.transferId}
                      accessibilityRole="button"
                      accessibilityLabel={a11y}
                    >
                      {bubble}
                    </Pressable>
                  ) : (
                    <View accessibilityLabel={a11y}>{bubble}</View>
                  )}
                </View>
              );
            }}
          />
        )}

        <View
          style={[
            styles.composer,
            {
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              transform: [{ translateY: -keyboardHeight }],
              paddingBottom:
                keyboardHeight > 0 ? 8 : Math.max(insets.bottom, 8),
              backgroundColor: colors.background,
            },
          ]}
        >
          <Pressable
            style={styles.moneyIconBtn}
            onPress={() => setMoneyOpen(true)}
            accessibilityLabel={t("messages.sendMoney")}
          >
            <Text style={{ fontSize: 18 }}>💰</Text>
          </Pressable>
          <TextInput
            style={styles.composerInput}
            placeholder={t("messages.composerPlaceholder")}
            placeholderTextColor={colors.placeholder}
            value={text}
            onChangeText={setText}
            multiline
          />
          <Pressable
            style={[
              styles.sendBtn,
              (!text.trim() || sending) && styles.sendBtnDisabled,
            ]}
            disabled={!text.trim() || sending}
            onPress={() => void sendText()}
            accessibilityLabel={t("messages.send")}
          >
            <Ionicons name="send" size={18} color={colors.accentOn} />
          </Pressable>
        </View>
      </View>

      <Modal visible={moneyOpen} transparent animationType="fade">
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setMoneyOpen(false)}
        />
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, 16) + 12 },
          ]}
        >
          <Text style={styles.sheetTitle}>{t("messages.sendMoney")}</Text>
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
            onBackspace={() => setAmount((p) => p.slice(0, -1))}
            disabled={sending}
          />
          <Pressable
            style={[
              styles.primaryBtn,
              (!amountOk || sending) && styles.primaryBtnDisabled,
            ]}
            disabled={!amountOk || sending}
            onPress={() => void sendMoney()}
          >
            {sending ? (
              <ActivityIndicator color={colors.accentOn} />
            ) : (
              <Text style={styles.primaryBtnText}>{t("messages.send")}</Text>
            )}
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
