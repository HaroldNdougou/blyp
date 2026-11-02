import { PeerAvatar } from "@/components/peers/PeerAvatar";
import { CommerceSection } from "@/components/profile/CommerceSection";
import { ProfileEditSheet } from "@/components/profile/ProfileEditSheet";
import { SignOutConfirmModal } from "@/components/profile/SignOutConfirmModal";
import { createProfileStyles } from "@/components/profile/profileStyles";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useTaxiBroadcast } from "@/hooks/useTaxiBroadcast";
import { resolveBleBroadcastAccount } from "@/lib/ble/broadcastAccount";
import { showBroadcastFailureAlert } from "@/lib/ble/broadcastAlertMessage";
import { openDepositRoute } from "@/lib/nav/openDeposit";
import { formatRegistrationFullName } from "@/lib/profile/parseRegistrationFullName";
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
  ensureImageLibraryPermission,
  pickImagesFromLibrary,
  warmImageLibraryPermission,
} from "@/lib/image/pickFromLibrary";
import { showBlypActionFlash } from "@/lib/ui/blypActionFlash";
import { blypAlert } from "@/lib/ui/blypAlert";
import { ActivityIndicator, Pressable, ScrollView, Switch, Platform, Text, View } from "react-native";
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

export default function ProfileTabScreen() {
  const insets = useSafeAreaInsets();
  const { user, token, signOut, isLoading, refreshUser } = useAuth();
  const [smallPayWithoutPin, setSmallPayWithoutPin] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createProfileStyles(colors), [colors]);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutModalVisible, setSignOutModalVisible] = useState(false);
  const [profileEditMode, setProfileEditMode] = useState<"name" | "account" | null>(
    null,
  );
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
  const [quickPayNotif, setQuickPayNotif] = useState(false);
  const bleBroadcastAccount = useMemo(
    () => resolveBleBroadcastAccount(user),
    [user],
  );
  const broadcast = useTaxiBroadcast(bleBroadcastAccount);
  const [broadcastActivating, setBroadcastActivating] = useState(false);
  const isPro = user?.activeContext?.type === "commerce";
  const kycStatus = user?.kycStatus ?? "none";
  const kycCtaLabel =
    kycStatus === "rejected"
      ? t("profile.kycCtaUnlock")
      : t("profile.kycCtaVerify");

  useFocusEffect(
    useCallback(() => {
      void warmImageLibraryPermission();
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      perfMarkStart("tab_profile");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => perfMarkEnd("tab_profile"));
      });
    }, []),
  );

  useEffect(() => {
    setSmallPayWithoutPin(user?.smallPayWithoutPinEnabled === true);
  }, [user?.smallPayWithoutPinEnabled]);

  useEffect(() => {
    let cancelled = false;
    void import("@/lib/push/announcePref").then((m) => {
      void m.hydrateAnnouncePaymentsPref().then((on) => {
        if (!cancelled) setAnnouncePayments(on);
      });
    });
    void import("@/lib/pay/quickPayNotifPref").then((m) => {
      void m.hydrateQuickPayNotifPref().then((on) => {
        if (!cancelled) setQuickPayNotif(on);
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onBroadcastToggle = useCallback(
    async (enabled: boolean) => {
      setBroadcastActivating(true);
      try {
        const { status, message } = await broadcast.setEnabled(enabled);
        if (!enabled || status === "broadcasting") return;
        showBroadcastFailureAlert(
          t,
          t("profile.broadcastLabel"),
          status,
          message,
        );
      } finally {
        setBroadcastActivating(false);
      }
    },
    [broadcast.setEnabled, t],
  );

  const onAnnounceToggle = useCallback((enabled: boolean) => {
    setAnnouncePayments(enabled);
    void import("@/lib/push/announcePref").then((m) => {
      void m.setAnnouncePaymentsPref(enabled);
    });
  }, []);

  const onSmallPayWithoutPinToggle = useCallback(
    (enabled: boolean) => {
      if (!token) return;
      setSmallPayWithoutPin(enabled);
      void (async () => {
        try {
          const { setSmallPayWithoutPin: apiSet } = await import(
            "@/lib/api/client"
          );
          await apiSet(token, enabled);
          await refreshUser();
        } catch (e) {
          setSmallPayWithoutPin(!enabled);
          blypAlert(
            t("profile.smallPayWithoutPinLabel"),
            e instanceof Error ? e.message : t("common.genericError"),
          );
        }
      })();
    },
    [token, refreshUser, t],
  );

  const onQuickPayNotifToggle = useCallback(
    (enabled: boolean) => {
      setQuickPayNotif(enabled);
      void import("@/lib/pay/quickPayNotifPref").then((m) => {
        void m.setQuickPayNotifPref(enabled).then(async () => {
          const { syncQuickPayNotif } = await import("@/lib/pay/syncQuickPayNotif");
          const res = await syncQuickPayNotif({ interactive: true });
          if (!enabled || res.ok) return;
          setQuickPayNotif(false);
          void m.setQuickPayNotifPref(false);
          if (res.reason === "NO_NATIVE") {
            blypAlert(
              t("profile.quickPayNotifLabel"),
              t("profile.quickPayNotifRebuildRequired"),
            );
          } else if (res.reason === "NO_NOTIF_PERMISSION") {
            blypAlert(
              t("profile.quickPayNotifLabel"),
              t("profile.quickPayNotifPermissionRequired"),
            );
          }
        });
      });
    },
    [t],
  );

  const onContextChanged = useCallback((_next: "personal" | "commerce") => {
    /* Relance BLE : AuthContext.retarget après le nouveau compte. */
  }, []);

  const onChangePhoto = useCallback(async () => {
    if (!token || avatarBusy || avatarPickerOpen) return;
    setAvatarPickerOpen(true);
    try {
      const granted = await ensureImageLibraryPermission();
      if (!granted) return;
      const assets = await pickImagesFromLibrary();
      const asset = assets?.[0];
      if (!asset?.uri) return;
      setAvatarPickerOpen(false);
      setAvatarBusy(true);
      const { uploadProfileAvatar } = await import(
        "@/lib/avatar/uploadProfileAvatar"
      );
      await uploadProfileAvatar(token, asset.uri, asset.contentType);
      await refreshUser();
      showBlypActionFlash(t("profile.photoUpdatedFlash"));
    } catch {
      blypAlert(t("profile.title"), t("profile.photoUploadFailed"));
    } finally {
      setAvatarBusy(false);
      setAvatarPickerOpen(false);
    }
  }, [token, avatarBusy, avatarPickerOpen, refreshUser, t]);

  /** Hooks avant tout return — sinon crash « fewer hooks » au logout / session. */
  if (!isLoading && (!token || user?.needsOnboarding)) {
    return <Redirect href="/(tabs)/welcome" />;
  }

  const phoneDigits = user?.phone.replace(/\D/g, "").slice(-9) ?? "";
  const phoneDisplay = phoneDigits
    ? `+237 ${formatCameroonPhoneDisplay(phoneDigits)}`
    : t("profile.dash");
  const personalDisplayName = formatRegistrationFullName(
    user?.personalFirstName ?? user?.firstName,
    user?.personalLastName ?? user?.lastName,
  );
  const hasName = isPro
    ? Boolean(user?.firstName?.trim())
    : personalDisplayName.trim().length > 0;
  const displayName = isPro
    ? (user?.firstName ?? "").trim() || t("common.account")
    : personalDisplayName.trim() || t("common.account");
  const accountFullName = isPro
    ? personalDisplayName.trim() || t("profile.dash")
    : personalDisplayName.trim() || t("profile.dash");
  const accountComplete = Boolean(user && !user.needsOnboarding);
  const appVersion =
    Constants.expoConfig?.version ??
    Constants.nativeAppVersion ??
    t("profile.dash");

  const onSignOut = () => {
    setSignOutModalVisible(true);
  };

  const confirmSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      setSignOutModalVisible(false);
    } finally {
      setSigningOut(false);
    }
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
    <>
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
            onPress={() => void onChangePhoto()}
            disabled={!token || avatarBusy || avatarPickerOpen}
            accessibilityRole="button"
            accessibilityLabel={t("profile.changePhoto")}
          >
            <View style={styles.heroAvatarWrap}>
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
                  {!avatarPickerOpen && !avatarBusy ? (
                    <Ionicons name="person" size={36} color={colors.accent} />
                  ) : null}
                </View>
              )}
              {avatarPickerOpen || avatarBusy ? (
                <View
                  style={[
                    styles.heroAvatarSpinnerOverlay,
                    { backgroundColor: colors.overlay },
                  ]}
                >
                  <ActivityIndicator color={colors.accent} size="small" />
                </View>
              ) : null}
            </View>
          </Pressable>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={2}>
              {displayName}
            </Text>
            {accountComplete && !isPro ? (
              <Pressable
                style={({ pressed }) => [
                  styles.nameEditBtn,
                  pressed && styles.actionBtnPressed,
                ]}
                onPress={() => setProfileEditMode("name")}
                accessibilityRole="button"
                accessibilityLabel={t("profile.editName")}
              >
                <Ionicons
                  name="pencil-outline"
                  size={20}
                  color={colors.textMuted}
                />
              </Pressable>
            ) : null}
          </View>
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
          {accountComplete && !isPro ? (
            <View style={styles.balanceActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.balanceActionPrimary,
                  pressed && styles.balanceActionPrimaryPressed,
                ]}
                onPress={() => openDepositRoute()}
                accessibilityRole="button"
                accessibilityLabel={t("profile.actionTopUp")}
              >
                <Text style={styles.balanceActionPrimaryText}>
                  {t("profile.actionTopUp")}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.balanceActionSecondary,
                  pressed && styles.balanceActionSecondaryPressed,
                ]}
                onPress={() =>
                  blypAlert(
                    t("profile.withdrawSoonTitle"),
                    t("profile.withdrawSoonMessage"),
                  )
                }
                accessibilityRole="button"
                accessibilityLabel={t("profile.actionWithdraw")}
              >
                <Text style={styles.balanceActionSecondaryText}>
                  {t("profile.actionWithdraw")}
                </Text>
              </Pressable>
            </View>
          ) : null}
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
              pressed && styles.actionBtnPressed,
            ]}
            onPress={() => {
              if (broadcastActivating) return;
              void onBroadcastToggle(!broadcast.wantOn);
            }}
            disabled={broadcastActivating}
            accessibilityRole="switch"
            accessibilityState={{
              checked: broadcast.wantOn,
              busy: broadcastActivating || broadcast.busy,
            }}
            accessibilityLabel={t("profile.broadcastLabel")}
          >
            <View style={styles.broadcastTexts}>
              <Text style={styles.broadcastTitle}>
                {t("profile.broadcastLabel")}
              </Text>
            </View>
            <View style={styles.broadcastSwitchWrap} pointerEvents="none">
              <Switch
                value={broadcast.wantOn}
                trackColor={{
                  false: colors.switchTrackOff,
                  true: colors.switchTrackOn,
                }}
                thumbColor={
                  broadcast.wantOn
                    ? colors.switchThumbOn
                    : colors.switchThumbOff
                }
                ios_backgroundColor={colors.switchTrackOff}
              />
            </View>
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
          <Pressable
            style={({ pressed }) => [
              styles.broadcastRow,
              styles.broadcastRowBorder,
              pressed && styles.actionBtnPressed,
            ]}
            onPress={() => onSmallPayWithoutPinToggle(!smallPayWithoutPin)}
            accessibilityRole="switch"
            accessibilityState={{ checked: smallPayWithoutPin }}
            accessibilityLabel={t("profile.smallPayWithoutPinLabel")}
          >
            <View style={styles.broadcastTexts}>
              <Text style={styles.broadcastTitle}>
                {t("profile.smallPayWithoutPinLabel")}
              </Text>
              <Text style={styles.broadcastHint}>
                {t("profile.smallPayWithoutPinHint")}
              </Text>
            </View>
            <View style={styles.broadcastSwitchWrap} pointerEvents="none">
              <Switch
                value={smallPayWithoutPin}
                trackColor={{
                  false: colors.switchTrackOff,
                  true: colors.switchTrackOn,
                }}
                thumbColor={
                  smallPayWithoutPin
                    ? colors.switchThumbOn
                    : colors.switchThumbOff
                }
                ios_backgroundColor={colors.switchTrackOff}
              />
            </View>
          </Pressable>
          {Platform.OS === "android" ? (
          <Pressable
            style={({ pressed }) => [
              styles.broadcastRow,
              styles.broadcastRowBorder,
              pressed && styles.actionBtnPressed,
            ]}
            onPress={() => onQuickPayNotifToggle(!quickPayNotif)}
            accessibilityRole="switch"
            accessibilityState={{ checked: quickPayNotif }}
            accessibilityLabel={t("profile.quickPayNotifLabel")}
          >
            <View style={styles.broadcastTexts}>
              <Text style={styles.broadcastTitle}>
                {t("profile.quickPayNotifLabel")}
              </Text>
            </View>
            <View style={styles.broadcastSwitchWrap} pointerEvents="none">
              <Switch
                value={quickPayNotif}
                trackColor={{
                  false: colors.switchTrackOff,
                  true: colors.switchTrackOn,
                }}
                thumbColor={
                  quickPayNotif
                    ? colors.switchThumbOn
                    : colors.switchThumbOff
                }
                ios_backgroundColor={colors.switchTrackOff}
              />
            </View>
          </Pressable>
          ) : null}
        </View>

        <View style={styles.sectionTitleRow}>
          <Text style={[styles.sectionTitle, styles.sectionTitleRowLabel]}>
            {t("profile.sectionAccount")}
          </Text>
          {accountComplete && !isPro ? (
            <Pressable
              style={({ pressed }) => [
                styles.sectionEditBtn,
                pressed && styles.actionBtnPressed,
              ]}
              onPress={() => setProfileEditMode("account")}
              accessibilityRole="button"
              accessibilityLabel={t("profile.editAccount")}
            >
              <Ionicons
                name="pencil-outline"
                size={18}
                color={colors.textMuted}
              />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.sectionCard}>
          <View style={[styles.row, styles.rowBorder]}>
            <Text style={styles.rowLabel}>{t("profile.phone")}</Text>
            <Text style={[styles.rowValue, styles.rowValueMuted]}>
              {phoneDisplay}
            </Text>
          </View>
          <View style={[styles.row, styles.rowBorder]}>
            <Text style={styles.rowLabel}>{t("profile.fullNameLabel")}</Text>
            <Text style={styles.rowValue}>{accountFullName}</Text>
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
    <SignOutConfirmModal
      visible={signOutModalVisible}
      busy={signingOut}
      onCancel={() => {
        if (!signingOut) setSignOutModalVisible(false);
      }}
      onConfirm={() => void confirmSignOut()}
    />
    <ProfileEditSheet
      visible={profileEditMode != null}
      mode={profileEditMode ?? "name"}
      onClose={() => setProfileEditMode(null)}
    />
    </>
  );
}
