import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { ApiError } from "@/lib/api/errors";
import { getAccessToken } from "@/lib/auth/authSession";
import { formatFcfa } from "@/lib/formatFcfa";
import {
  getConversationsSnapshot,
  setConversationsSnapshot,
} from "@/lib/messagesCache";
import { subscribeIncomingMessage } from "@/lib/messages/live";
import { getUnread, subscribeUnread } from "@/lib/messages/unread";
import type { Conversation } from "@/lib/api/types";
import { createMessagesStyles } from "@/components/messages/messagesStyles";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type KeyboardEvent,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { normalizeCameroonPhoneDigits } from "@/lib/format";

/** Même lift que le chat : MIUI sous-estime souvent la hauteur du clavier. */
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
  if (Platform.OS === "android" && frameLift <= height + 12) {
    lift += 48;
  }
  return Math.round(Math.min(lift, screenH * 0.75));
}

export default function ConversationsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createMessagesStyles(colors), [colors]);
  const { token } = useAuth();
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [opening, setOpening] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [unreadTick, setUnreadTick] = useState(0);

  useEffect(() => {
    if (!newOpen) {
      setKeyboardHeight(0);
      return;
    }
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = (e: KeyboardEvent) => setKeyboardHeight(imeLiftPx(e));
    const onHide = () => setKeyboardHeight(0);
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
  }, [newOpen]);

  useEffect(() => subscribeUnread(() => setUnreadTick((n) => n + 1)), []);

  useEffect(() => {
    if (!token) return;
    return subscribeIncomingMessage(() => {
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
          setItems(next);
        } catch {
          /* garde la liste déjà affichée */
        }
      })();
    });
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      if (!token) {
        setItems([]);
        setLoading(false);
        return;
      }
      const cached = getConversationsSnapshot(token);
      if (cached) {
        setItems(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }
      let cancelled = false;
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
          setItems(next);
        } catch {
          // Échec de chargement : on garde l’état vide, sans texte d’erreur.
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [token]),
  );

  const openNew = async () => {
    if (!token || phone.length !== 9 || opening) return;
    setOpening(true);
    setError(null);
    try {
      const { ensureSessionFresh, openConversation } = await import(
        "@/lib/api/client"
      );
      await ensureSessionFresh();
      const access = getAccessToken();
      if (!access) {
        setError(t("messages.signInRequired"));
        return;
      }
      const { conversation } = await openConversation(access, phone);
      const next = [
        conversation,
        ...items.filter((c) => c.id !== conversation.id),
      ];
      setConversationsSnapshot(access, next);
      setItems(next);
      setNewOpen(false);
      setPhone("");
      router.push(`/chat/${encodeURIComponent(conversation.id)}`);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setError(t("messages.sessionExpired"));
      } else if (
        e instanceof ApiError &&
        e.status > 0 &&
        e.status < 500 &&
        e.message.trim() &&
        !/^session invalide$/i.test(e.message.trim())
      ) {
        setError(e.message.trim());
      } else {
        setError(t("messages.openFailed"));
      }
    } finally {
      setOpening(false);
    }
  };

  const previewFor = (c: Conversation) => {
    if (c.lastMessageType === "money") {
      const n = parseInt(c.lastMessagePreview.replace(/\D/g, ""), 10);
      if (Number.isFinite(n) && n > 0) {
        return t("messages.moneyPreview", { amount: formatFcfa(n) });
      }
    }
    return c.lastMessagePreview || t("messages.emptyHint");
  };

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
          onPress={() => setNewOpen(true)}
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
          extraData={unreadTick}
          data={items}
          keyExtractor={(c) => c.id}
          initialNumToRender={12}
          windowSize={7}
          renderItem={({ item }) => {
            const unread = getUnread(item.id);
            return (
            <Pressable
              style={styles.row}
              onPress={() =>
                router.push(`/chat/${encodeURIComponent(item.id)}`)
              }
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(item.peerName.trim().charAt(0) || "?").toUpperCase()}
                </Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.peerName}
                </Text>
                <Text
                  style={
                    unread > 0 ? styles.rowPreviewUnread : styles.rowPreview
                  }
                  numberOfLines={1}
                >
                  {previewFor(item)}
                </Text>
              </View>
              {unread > 0 ? (
                <View
                  style={styles.unreadBadge}
                  accessibilityLabel={t("messages.unreadCount", {
                    count: unread,
                  })}
                >
                  <Text style={styles.unreadBadgeText}>
                    {unread > 99 ? "99+" : String(unread)}
                  </Text>
                </View>
              ) : null}
            </Pressable>
            );
          }}
        />
      )}

      <Modal visible={newOpen} transparent animationType="fade">
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setNewOpen(false)}
        />
        <View
          style={[
            styles.sheet,
            {
              bottom: keyboardHeight,
              paddingBottom:
                keyboardHeight > 0 ? 16 : Math.max(insets.bottom, 16),
            },
          ]}
        >
          <Text style={styles.sheetTitle}>{t("messages.newChat")}</Text>
          <Text style={[styles.rowPreview, { marginBottom: 8 }]}>
            {t("messages.phoneLabel")}
          </Text>
          <View style={styles.inputWrap}>
            <Text style={styles.prefix}>+237</Text>
            <TextInput
              style={styles.input}
              placeholder={t("messages.phonePlaceholder")}
              placeholderTextColor={colors.placeholder}
              keyboardType="number-pad"
              maxLength={9}
              value={phone}
              onChangeText={(v) => setPhone(normalizeCameroonPhoneDigits(v))}
              autoFocus
            />
          </View>
          <Pressable
            style={[
              styles.primaryBtn,
              (phone.length !== 9 || opening) && styles.primaryBtnDisabled,
            ]}
            disabled={phone.length !== 9 || opening}
            onPress={() => void openNew()}
          >
            {opening ? (
              <ActivityIndicator color={colors.accentOn} />
            ) : (
              <Text style={styles.primaryBtnText}>{t("messages.openChat")}</Text>
            )}
          </Pressable>
          {error ? (
            <Text style={[styles.emptyHint, { marginTop: 12 }]}>{error}</Text>
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
