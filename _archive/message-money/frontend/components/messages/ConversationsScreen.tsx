import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { ApiError } from "@/lib/api/errors";
import { formatFcfa } from "@/lib/formatFcfa";
import {
  getConversationsSnapshot,
  setConversationsSnapshot,
} from "@/lib/messagesCache";
import type { Conversation } from "@/lib/api/types";
import { createMessagesStyles } from "@/components/messages/messagesStyles";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { normalizeCameroonPhoneDigits } from "@/lib/format";

export default function ConversationsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createMessagesStyles(colors), [colors]);
  const { token } = useAuth();
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [opening, setOpening] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!token) {
        setItems([]);
        setLoading(false);
        setError(null);
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
          const { listConversations } = await import("@/lib/api/client");
          const { items: next } = await listConversations(token);
          if (cancelled) return;
          setConversationsSnapshot(token, next);
          setItems(next);
          setError(null);
        } catch (e) {
          if (!cancelled) {
            setError(
              e instanceof ApiError ? e.message : t("messages.loadFailed"),
            );
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [token, t]),
  );

  const openNew = async () => {
    if (!token || phone.length !== 9 || opening) return;
    setOpening(true);
    try {
      const { openConversation } = await import("@/lib/api/client");
      const { conversation } = await openConversation(token, phone);
      const next = [
        conversation,
        ...items.filter((c) => c.id !== conversation.id),
      ];
      setConversationsSnapshot(token, next);
      setItems(next);
      setNewOpen(false);
      setPhone("");
      router.push(`/chat/${encodeURIComponent(conversation.id)}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("messages.sendFailed"));
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
          {error ? (
            <Text style={[styles.emptyHint, { marginTop: 12 }]}>{error}</Text>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          initialNumToRender={12}
          windowSize={7}
          renderItem={({ item }) => (
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
                <Text style={styles.rowPreview} numberOfLines={1}>
                  {previewFor(item)}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}

      <Modal visible={newOpen} transparent animationType="fade">
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setNewOpen(false)}
        />
        <View style={styles.sheet}>
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
        </View>
      </Modal>
    </SafeAreaView>
  );
}
