import { createMessagesStyles } from "@/components/messages/messagesStyles";
import { PeerAvatar } from "@/components/peers/PeerAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { attachBlypStatus } from "@/lib/contacts/blypLookup";
import {
  checkContactsPermission,
  openContactsAppSettings,
  requestContactsPermission,
} from "@/lib/contacts/permissions";
import {
  clearPhoneContactsCache,
  filterPhoneContacts,
  loadPhoneContacts,
  pickContactFromDevice,
  type PhoneContactRow,
} from "@/lib/contacts/phoneContacts";
import { normalizeCameroonPhoneDigits } from "@/lib/format";
import {
  formatPeerPhoneDisplay,
  normalizeContactPhoneE164,
} from "@/lib/phone/e164";
import {
  buildInviteMessage,
  invitePeerOnWhatsApp,
} from "@/lib/messages/invitePeer";
import { openConversationWithPhone } from "@/lib/messages/openConversationWithPhone";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  InteractionManager,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function NewChatScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createMessagesStyles(colors), [colors]);
  const { token, user } = useAuth();
  const ownerPhoneE164 = useMemo(
    () => normalizeContactPhoneE164(user?.phone ?? "") ?? user?.phone ?? null,
    [user?.phone],
  );
  const inviterName =
    user?.personalFirstName?.trim() ||
    user?.firstName?.trim() ||
    "";

  const [search, setSearch] = useState("");
  const [manual, setManual] = useState(false);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [listDenied, setListDenied] = useState(false);
  const [contactsBlocked, setContactsBlocked] = useState(false);
  const [requestingPerm, setRequestingPerm] = useState(false);
  const [contacts, setContacts] = useState<PhoneContactRow[]>([]);

  const reloadList = useCallback(async () => {
    setLoading(true);
    const perm = await checkContactsPermission();
    setContactsBlocked(perm === "blocked");
    setListDenied(perm !== "granted");
    const res = await loadPhoneContacts(ownerPhoneE164);
    let items = res.items;
    if (res.ok && items.length > 0 && token) {
      items = await attachBlypStatus(items, token);
    }
    setContacts(items);
    setLoading(false);
  }, [ownerPhoneE164, token]);

  const onAllowContacts = useCallback(async () => {
    if (requestingPerm) return;
    setRequestingPerm(true);
    const status = await requestContactsPermission();
    setContactsBlocked(status === "blocked");
    setListDenied(status !== "granted");
    clearPhoneContactsCache();
    await reloadList();
    setRequestingPerm(false);
  }, [reloadList, requestingPerm]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const task = InteractionManager.runAfterInteractions(() => {
        void (async () => {
          if (cancelled) return;
          await reloadList();
        })();
      });
      return () => {
        cancelled = true;
        task.cancel();
      };
    }, [reloadList]),
  );

  const filtered = useMemo(
    () => filterPhoneContacts(contacts, search),
    [contacts, search],
  );

  const openPeer = useCallback(
    async (phone: string) => {
      if (!token || opening || !phone.trim()) return;
      setOpening(true);
      const res = await openConversationWithPhone(phone);
      setOpening(false);
      if (res.ok) return;
      if (res.code === "auth" || res.code === "session") {
        Alert.alert(t("messages.signInRequired"));
      } else if (res.code === "api" && res.message) {
        Alert.alert(res.message);
      } else {
        Alert.alert(t("messages.openFailed"));
      }
    },
    [opening, t, token],
  );

  const onPickFromDevice = useCallback(async () => {
    if (opening) return;
    const picked = await pickContactFromDevice();
    if (picked.ok) {
      void openPeer(picked.phoneE164);
      return;
    }
    if (picked.reason === "invalid") {
      Alert.alert(t("messages.contactNotCmMobile"));
    }
  }, [opening, openPeer, t]);

  const onPickRow = useCallback(
    (row: PhoneContactRow) => {
      if (!row.phoneE164) return;
      void openPeer(row.phoneE164);
    },
    [openPeer],
  );

  const onInvite = useCallback(
    (row: PhoneContactRow) => {
      if (!row.phoneE164 || row.onBlyp === true) return;
      const message = buildInviteMessage(inviterName, t);
      void invitePeerOnWhatsApp(row.phoneE164, message);
    },
    [inviterName, t],
  );

  const renderRow = useCallback(
    ({ item }: { item: PhoneContactRow }) => {
      const showInvite = Boolean(item.phoneE164 && item.onBlyp !== true);
      return (
        <View style={styles.newChatRow}>
          <Pressable
            style={styles.newChatRowMain}
            disabled={opening || !item.phoneE164}
            onPress={() => onPickRow(item)}
          >
            <PeerAvatar
              name={item.name}
              phone={item.phoneE164}
              localUri={item.imageUri}
              size={48}
              style={styles.avatarSlot}
            />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.rowPreview} numberOfLines={1}>
                {item.phoneE164
                  ? formatPeerPhoneDisplay(item.phoneE164)
                  : item.phoneLabel}
              </Text>
            </View>
          </Pressable>
          {showInvite ? (
            <Pressable
              style={styles.newChatInviteBtn}
              onPress={() => onInvite(item)}
              accessibilityLabel={t("messages.invite")}
            >
              <Text style={styles.newChatInviteBtnText}>
                {t("messages.invite")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      );
    },
    [onInvite, onPickRow, opening, styles, t],
  );

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.newChatHeader}>
        <Pressable
          style={styles.headerBtn}
          onPress={() => router.back()}
          accessibilityLabel={t("common.back")}
        >
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.newChatHeaderTitle}>{t("messages.newChat")}</Text>
        <Pressable
          style={styles.headerBtn}
          onPress={() => setManual((m) => !m)}
          accessibilityLabel={t("messages.contactsManualEntry")}
        >
          <Ionicons
            name={manual ? "people-outline" : "keypad-outline"}
            size={22}
            color={colors.accent}
          />
        </Pressable>
      </View>

      {manual ? (
        <View style={styles.newChatManualPane}>
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
            onPress={() => void openPeer(phone)}
          >
            {opening ? (
              <ActivityIndicator color={colors.accentOn} />
            ) : (
              <Text style={styles.primaryBtnText}>{t("messages.openChat")}</Text>
            )}
          </Pressable>
        </View>
      ) : (
        <View style={styles.newChatBody}>
          <View style={styles.newChatSearchWrap}>
            <Ionicons
              name="search"
              size={18}
              color={colors.placeholder}
              style={styles.newChatSearchIcon}
            />
            <TextInput
              style={styles.newChatSearchInput}
              placeholder={t("messages.contactsSearchPlaceholder")}
              placeholderTextColor={colors.placeholder}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>

          {listDenied ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.newChatHint}>
                {t("messages.contactsPermissionDenied")}
              </Text>
              {contactsBlocked ? (
                <>
                  <Text style={[styles.newChatHint, { marginTop: 4 }]}>
                    {t("messages.contactsMiuiBlockedHint")}
                  </Text>
                  <Pressable
                    style={styles.newChatFooterBtn}
                    onPress={() => void openContactsAppSettings()}
                  >
                    <Text style={styles.newChatFooterBtnText}>
                      {t("messages.contactsOpenSettings")}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.newChatFooterBtn}
                    onPress={() => void onPickFromDevice()}
                  >
                    <Text style={styles.newChatFooterBtnText}>
                      {t("messages.contactsPickFromPhone")}
                    </Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  style={[
                    styles.primaryBtn,
                    { marginHorizontal: 20, marginTop: 12 },
                    requestingPerm && styles.primaryBtnDisabled,
                  ]}
                  disabled={requestingPerm}
                  onPress={() => void onAllowContacts()}
                >
                  {requestingPerm ? (
                    <ActivityIndicator color={colors.accentOn} />
                  ) : (
                    <Text style={styles.primaryBtnText}>
                      {t("messages.contactsAllow")}
                    </Text>
                  )}
                </Pressable>
              )}
            </View>
          ) : loading ? (
            <View style={styles.emptyWrap}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyHint}>
                {contacts.length === 0
                  ? t("messages.contactsEmpty")
                  : t("messages.contactsNoMatch")}
              </Text>
            </View>
          ) : (
            <FlatList
              style={styles.newChatList}
              data={filtered}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={24}
              windowSize={9}
              renderItem={renderRow}
            />
          )}
        </View>
      )}
    </SafeAreaView>
  );
}
