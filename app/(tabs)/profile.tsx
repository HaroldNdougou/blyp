import { PeerAvatar } from "@/components/peers/PeerAvatar";
import { CommerceSection } from "@/components/profile/CommerceSection";
import { createProfileStyles } from "@/components/profile/profileStyles";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useTaxiBroadcast } from "@/hooks/useTaxiBroadcast";
import { resolveBleBroadcastAccount } from "@/lib/ble/broadcastAccount";
import {
  formatCameroonPhoneDisplay,
  formatFcfa,
} from "@/lib/format";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { Redirect, router } from "expo-router";
import { perfMarkEnd, perfMarkStart } from "@/lib/perf/marks";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { CountBadge } from "@/components/ui/CountBadge";
import {
  getReceiptsUnreadCount,
  hydrateReceiptsUnread,
  subscribeReceiptsUnread,
} from "@/lib/receipts/receiptsUnread";

function initialsFromName(first: string | null, last: string | null): string {
  const a = (first ?? "").trim().charAt(0);
  const b = (last ?? "").trim().charAt(0);
  const s = `${a}${b}`.toUpperCase();
  return s || "?";
}

export default function ProfileTabScreen() {
  const insets = useSafeAreaInsets();
  const { user, token, signOut, isLoading, refreshUser } = useAuth();
  const [avatarBusy, setAvatarBusy] = useState(false);
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createProfileStyles(colors), [colors]);
  const [signingOut, setSigningOut] = useState(false);
  const [receiptsUnreadTick, setReceiptsUnreadTick] = useState(0);
  const accountId = String(user?.id ?? "").trim();
  const receiptsUnread = accountId
    ? getReceiptsUnreadCount(accountId)
    : 0;

  useEffect(
    () => subscribeReceiptsUnread(() => setReceiptsUnreadTick((n) => n + 1)),
    [],
  );
  useFocusEffect(
    useCallback(() => {
      if (!accountId) return;
      void hydrateReceiptsUnread(accountId).then(() =>
        setReceiptsUnreadTick((n) => n + 1),
      );
    }, [accountId]),
  );
  const [announcePayments, setAnnouncePayments] = useState(false);
  const bleBroadcastAccount = useMemo(
    () => resolveBleBroadcastAccount(user),
    [user],
  );
  const broadcast = useTaxiBroadcast(bleBroadcastAccount);
  const isPro = user?.activeContext?.type === "commerce";
  const kycStatus = user?.kycStatus ?? "none";
  const kycCtaLabel =
    kycStatus === "rejected"
      ? t("profile.kycCtaUnlock")
      : t("profile.kycCtaVerify");
  const personalFirst = user?.personalFirstName ?? null;
  const personalLast = user?.personalLastName ?? null;

  useFocusEffect(
    useCallback(() => {
      perfMarkStart("tab_profile");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => perfMarkEnd("tab_profile"));
      });
    }, []),
  );

  useEffect(() => {
    let cancelled = false;
    void import("@/lib/push/announcePref").then((m) => {
      void m.hydrateAnnouncePaymentsPref().then((on) => {
        if (!cancelled) setAnnouncePayments(on);
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onBroadcastToggle = useCallback(
    async (enabled: boolean) => {
      const { status, message } = await broadcast.setEnabled(enabled);
      if (!enabled || status === "broadcasting") return;
      const msg =
        status === "denied"
          ? t("profile.broadcastDenied")
          : status === "unavailable"
            ? t("profile.broadcastUnavailable")
            : status === "powered_off"
              ? t("profile.broadcastOffBt")
              : message === "INVALID_ACCOUNT"
                ? t("profile.broadcastInvalidAccount")
                : message && __DEV__
                  ? `${t("profile.broadcastError")}\n${message}`
                  : t("profile.broadcastError");
      Alert.alert(t("profile.broadcastLabel"), msg);
    },
    [broadcast.setEnabled, t],
  );

  const onAnnounceToggle = useCallback((enabled: boolean) => {
    setAnnouncePayments(enabled);
    void import("@/lib/push/announcePref").then((m) => {
      void m.setAnnouncePaymentsPref(enabled);
    });
  }, []);

  const onContextChanged = useCallback((_next: "personal" | "commerce") => {
    /* Relance BLE : AuthContext.retarget après le nouveau compte. */
  }, []);

  const onChangePhoto = useCallback(async () => {
    if (!token || avatarBusy) return;
    setAvatarBusy(true);
    try {
      const { requestImageLibraryPermission } = await import(
        "@/lib/image/pickFromLibrary"
      );
      const { pickImagesFromLibrary } = await import(
        "@/lib/image/pickFromLibrary"
      );
      const granted = await requestImageLibraryPermission();
      if (!granted) return;
      const assets = await pickImagesFromLibrary();
      const asset = assets?.[0];
      if (!asset?.uri) return;
      const { uploadProfileAvatar } = await import(
        "@/lib/avatar/uploadProfileAvatar"
      );
      await uploadProfileAvatar(token, asset.uri, asset.contentType);
      await refreshUser();
    } catch {
      Alert.alert(t("profile.title"), t("profile.photoUploadFailed"));
    } finally {
      setAvatarBusy(false);
    }
  }, [token, avatarBusy, refreshUser, t]);

  /** Hooks avant tout return — sinon crash « fewer hooks » au logout / session. */
  if (!isLoading && !token) {
    return <Redirect href="/" />;
  }

  const phoneDigits = user?.phone.replace(/\D/g, "").slice(-9) ?? "";
  const phoneDisplay = phoneDigits
    ? `+237 ${formatCameroonPhoneDisplay(phoneDigits)}`
    : t("profile.dash");
  const hasName = isPro
    ? Boolean(user?.firstName?.trim())
    : Boolean(user?.firstName?.trim() && user?.lastName?.trim());
  const displayName = isPro
    ? (user?.firstName ?? "").trim() || t("common.account")
    : hasName
      ? `${user!.firstName!.trim()} ${user!.lastName!.trim()}`
      : t("common.account");
  const accountComplete = Boolean(user && !user.needsOnboarding);
  const appVersion =
    Constants.expoConfig?.version ??
    Constants.nativeAppVersion ??
    t("profile.dash");

  const onSignOut = () => {
    Alert.alert(t("profile.signOutTitle"), t("profile.signOutMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("profile.signOutConfirm"),
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          try {
            await signOut();
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  };

  if (isLoading && !user) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: 36 + Math.max(insets.bottom, 8) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t("profile.title")}</Text>
          <Text style={styles.subtitle}>{t("profile.subtitle")}</Text>
        </View>

        <View style={styles.hero}>
          <Pressable
            onPress={onChangePhoto}
            disabled={!token || avatarBusy}
            accessibilityRole="button"
            accessibilityLabel={t("profile.changePhoto")}
          >
            {hasName ? (
              <PeerAvatar
                name={displayName}
                phone={user?.phone ?? null}
                remoteUrl={user?.avatarUrl}
                size={84}
                style={styles.avatar}
                textStyle={styles.avatarText}
              />
            ) : (
              <View style={styles.avatar}>
                {avatarBusy ? (
                  <ActivityIndicator color={colors.accent} />
                ) : (
                  <Ionicons name="person" size={36} color={colors.accent} />
                )}
              </View>
            )}
          </Pressable>
          <Text style={styles.name}>{displayName}</Text>
          <View
            style={[
              styles.statusChip,
              accountComplete || isPro
                ? styles.statusChipOk
                : styles.statusChipWarn,
            ]}
          >
            <Text
              style={[
                styles.statusChipText,
                accountComplete || isPro
                  ? styles.statusChipTextOk
                  : styles.statusChipTextWarn,
              ]}
            >
              {isPro
                ? t("profile.modeProChip")
                : accountComplete
                  ? t("profile.statusActive")
                  : t("profile.statusIncomplete")}
            </Text>
          </View>
        </View>

        {!accountComplete ? (
          <View style={styles.onboardingBanner}>
            <Text style={styles.onboardingBannerText}>
              {t("profile.onboardingHint")}
            </Text>
          </View>
        ) : null}

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>{t("profile.balance")}</Text>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceValue} numberOfLines={1}>
              {formatFcfa(user?.balanceFcfa ?? 0)}
            </Text>
            <Text style={styles.balanceCurrency}>{t("common.fcfa")}</Text>
          </View>
        </View>

        <CommerceSection styles={styles} onContextChanged={onContextChanged} />

        <Text style={styles.sectionTitle}>{t("vault.profileSection")}</Text>
        <View style={styles.sectionCard}>
          <Pressable
            style={({ pressed }) => [
              styles.row,
              styles.rowBorder,
              pressed && styles.actionBtnPressed,
            ]}
            onPress={() => router.push("/documents")}
            accessibilityRole="button"
            accessibilityLabel={t("vault.title")}
          >
            <Text style={styles.commerceTitle}>{t("vault.title")}</Text>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={colors.textMuted}
            />
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.row,
              pressed && styles.actionBtnPressed,
            ]}
            onPress={() => router.push("/receipts")}
            accessibilityRole="button"
            accessibilityLabel={t("receipts.title")}
          >
            <Text style={styles.commerceTitle}>{t("receipts.title")}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <CountBadge count={receiptsUnread} />
              <Ionicons
                name="chevron-forward"
                size={20}
                color={colors.textMuted}
              />
            </View>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>{t("profile.sectionTaxi")}</Text>
        <View style={styles.sectionCard}>
          <Pressable
            style={({ pressed }) => [
              styles.broadcastRow,
              styles.broadcastRowOnline,
              pressed && !broadcast.busy && styles.actionBtnPressed,
            ]}
            onPress={() => {
              if (broadcast.busy) return;
              void onBroadcastToggle(!broadcast.on);
            }}
            disabled={broadcast.busy}
            accessibilityRole="switch"
            accessibilityState={{ checked: broadcast.on, disabled: broadcast.busy }}
            accessibilityLabel={t("profile.broadcastLabel")}
          >
            <View style={styles.broadcastTexts}>
              <Text style={styles.broadcastTitle}>
                {t("profile.broadcastLabel")}
              </Text>
              <Text
                style={[
                  styles.broadcastHint,
                  broadcast.on && styles.broadcastHintOn,
                ]}
              >
                {broadcast.on
                  ? t("profile.broadcastHintOn")
                  : t("profile.broadcastHintOff")}
              </Text>
            </View>
            {broadcast.busy ? (
              <ActivityIndicator color={colors.accent} size="small" />
            ) : (
              <View style={styles.broadcastSwitchWrap} pointerEvents="none">
                <Switch
                  value={broadcast.on}
                  trackColor={{
                    false: colors.switchTrackOff,
                    true: colors.switchTrackOn,
                  }}
                  thumbColor={
                    broadcast.on
                      ? colors.switchThumbOn
                      : colors.switchThumbOff
                  }
                  ios_backgroundColor={colors.switchTrackOff}
                />
              </View>
            )}
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.broadcastRow,
              styles.broadcastRowBorder,
              pressed && styles.actionBtnPressed,
            ]}
            onPress={() => onAnnounceToggle(!announcePayments)}
            accessibilityRole="switch"
            accessibilityState={{ checked: announcePayments }}
            accessibilityLabel={t("profile.announcePaymentsLabel")}
          >
            <View style={styles.broadcastTexts}>
              <Text style={styles.broadcastTitle}>
                {t("profile.announcePaymentsLabel")}
              </Text>
              <Text style={styles.broadcastHint}>
                {t("profile.announcePaymentsHint")}
              </Text>
            </View>
            <View style={styles.broadcastSwitchWrap} pointerEvents="none">
              <Switch
                value={announcePayments}
                trackColor={{
                  false: colors.switchTrackOff,
                  true: colors.switchTrackOn,
                }}
                thumbColor={
                  announcePayments
                    ? colors.switchThumbOn
                    : colors.switchThumbOff
                }
                ios_backgroundColor={colors.switchTrackOff}
              />
            </View>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>{t("profile.sectionAccount")}</Text>
        <View style={styles.sectionCard}>
          <View style={[styles.row, styles.rowBorder]}>
            <Text style={styles.rowLabel}>{t("profile.phone")}</Text>
            <Text style={[styles.rowValue, styles.rowValueMuted]}>
              {phoneDisplay}
            </Text>
          </View>
          <View style={[styles.row, styles.rowBorder]}>
            <Text style={styles.rowLabel}>{t("profile.firstName")}</Text>
            <Text style={styles.rowValue}>
              {(isPro ? personalFirst : user?.firstName)?.trim() ||
                t("profile.dash")}
            </Text>
          </View>
          <View style={[styles.row, styles.rowBorder]}>
            <Text style={styles.rowLabel}>{t("profile.lastName")}</Text>
            <Text style={styles.rowValue}>
              {(isPro ? personalLast : user?.lastName)?.trim() ||
                t("profile.dash")}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t("profile.accountId")}</Text>
            <Text
              style={[
                styles.rowValue,
                styles.rowValueMuted,
                styles.rowValueMono,
              ]}
              selectable
            >
              {user?.id?.trim() || t("profile.dash")}
            </Text>
          </View>
        </View>

        {kycStatus !== "approved" ? (
          <>
            <Text style={styles.sectionTitle}>
              {t("profile.sectionSecurity")}
            </Text>
            {kycStatus === "pending" ? (
              <View style={styles.kycPendingChip}>
                <Text style={styles.kycPendingChipText}>
                  {t("profile.kycStatusPending")}
                </Text>
              </View>
            ) : (
              <Pressable
                style={({ pressed }) => [
                  styles.kycCtaBtn,
                  pressed && styles.kycCtaBtnPressed,
                ]}
                onPress={() => router.push("/kyc")}
                accessibilityRole="button"
                accessibilityLabel={kycCtaLabel}
              >
                <Text style={styles.kycCtaBtnText}>{kycCtaLabel}</Text>
              </Pressable>
            )}
            <Text style={styles.kycLead}>
              {t("profile.kycLead", {
                amount: formatFcfa(999_999),
              })}
            </Text>
          </>
        ) : null}

        <Pressable
          style={({ pressed }) => [
            styles.signOutBtn,
            pressed && styles.signOutBtnPressed,
            signingOut && styles.signOutBtnDisabled,
          ]}
          onPress={onSignOut}
          disabled={signingOut}
          accessibilityRole="button"
          accessibilityLabel={t("profile.signOut")}
        >
          {signingOut ? (
            <ActivityIndicator color={colors.destructive} size="small" />
          ) : (
            <>
              <Ionicons
                name="log-out-outline"
                size={22}
                color={colors.destructive}
              />
              <Text style={styles.signOutText}>{t("profile.signOut")}</Text>
            </>
          )}
        </Pressable>

        <View style={styles.appMeta}>
          <Text style={styles.appMetaText}>{t("profile.appName")}</Text>
          <Text style={styles.appMetaText}>v{appVersion}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
