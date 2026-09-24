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
import { openDepositRoute } from "@/lib/nav/openDeposit";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { Redirect, router } from "expo-router";
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

function initialsFromName(first: string | null, last: string | null): string {
  const a = (first ?? "").trim().charAt(0);
  const b = (last ?? "").trim().charAt(0);
  const s = `${a}${b}`.toUpperCase();
  return s || "?";
}

export default function ProfileTabScreen() {
  const insets = useSafeAreaInsets();
  const { user, token, signOut, isLoading } = useAuth();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const styles = useMemo(() => createProfileStyles(colors), [colors]);
  const [signingOut, setSigningOut] = useState(false);
  const [announcePayments, setAnnouncePayments] = useState(false);
  const bleBroadcastAccount = useMemo(
    () => resolveBleBroadcastAccount(user),
    [user],
  );
  const broadcast = useTaxiBroadcast(bleBroadcastAccount);
  const isPro = user?.activeContext?.type === "commerce";
  const personalFirst = user?.personalFirstName ?? null;
  const personalLast = user?.personalLastName ?? null;

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

  const onContextChanged = useCallback(
    (next: "personal" | "commerce") => {
      if (next === "personal") {
        if (broadcast.on) void broadcast.setEnabled(false);
        return;
      }
      if (broadcast.on) {
        void broadcast.setEnabled(false).then(() => broadcast.setEnabled(true));
      }
    },
    [broadcast],
  );

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
  const pinOk = user?.onboardingStep !== "pin" && Boolean(user);
  const langLabel =
    i18n.language === "fr" ? t("profile.languageFr") : t("profile.languageEn");
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
          <View style={styles.avatar}>
            {hasName ? (
              <Text style={styles.avatarText}>
                {isPro
                  ? (user?.firstName ?? "?").trim().charAt(0).toUpperCase()
                  : initialsFromName(
                      user?.firstName ?? null,
                      user?.lastName ?? null,
                    )}
              </Text>
            ) : (
              <Ionicons name="person" size={36} color={colors.accent} />
            )}
          </View>
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

        <View style={styles.actionsRow}>
          <Pressable
            style={({ pressed }) => [
              styles.actionBtn,
              pressed && styles.actionBtnPressed,
            ]}
            onPressIn={() => {
              void import("@/app/deposit");
            }}
            onPress={() => openDepositRoute()}
            accessibilityRole="button"
            accessibilityLabel={t("profile.actionTopUp")}
          >
            <View style={styles.actionIconWrap}>
              <Ionicons name="add" size={20} color={colors.accent} />
            </View>
            <Text
              style={styles.actionLabel}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {t("profile.actionTopUp")}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.actionBtn,
              pressed && styles.actionBtnPressed,
            ]}
            onPress={() => router.push("/(tabs)/history")}
            accessibilityRole="button"
            accessibilityLabel={t("profile.actionHistory")}
          >
            <View style={styles.actionIconWrap}>
              <Ionicons name="swap-vertical" size={20} color={colors.accent} />
            </View>
            <Text
              style={styles.actionLabel}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {t("profile.actionHistory")}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.actionBtn,
              pressed && styles.actionBtnPressed,
            ]}
            onPress={() => router.push("/(tabs)")}
            accessibilityRole="button"
            accessibilityLabel={t("profile.actionPay")}
          >
            <View style={styles.actionIconWrap}>
              <Ionicons name="keypad" size={18} color={colors.accent} />
            </View>
            <Text
              style={styles.actionLabel}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {t("profile.actionPay")}
            </Text>
          </Pressable>
        </View>

        <CommerceSection styles={styles} onContextChanged={onContextChanged} />

        <Text style={styles.sectionTitle}>{t("profile.sectionTaxi")}</Text>
        <View style={styles.sectionCard}>
          <Pressable
            style={[styles.broadcastRow, styles.broadcastRowOnline]}
            onPress={() => {
              if (broadcast.busy) return;
              void onBroadcastToggle(!broadcast.on);
            }}
            disabled={broadcast.busy}
            accessibilityRole="switch"
            accessibilityState={{ checked: broadcast.on, disabled: broadcast.busy }}
            accessibilityLabel={t("profile.broadcastLabel")}
            hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
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
                    false: colors.borderLight,
                    true: colors.depositHighlightBorder,
                  }}
                  thumbColor={broadcast.on ? colors.accent : colors.surface}
                />
              </View>
            )}
          </Pressable>
          <View style={[styles.broadcastRow, styles.broadcastRowBorder]}>
            <View style={styles.broadcastTexts}>
              <Text style={styles.broadcastTitle}>
                {t("profile.announcePaymentsLabel")}
              </Text>
              <Text
                style={[
                  styles.broadcastHint,
                  announcePayments && styles.broadcastHintOn,
                ]}
              >
                {announcePayments
                  ? t("profile.announcePaymentsHintOn")
                  : t("profile.announcePaymentsHintOff")}
              </Text>
            </View>
            <Switch
              value={announcePayments}
              onValueChange={onAnnounceToggle}
              trackColor={{
                false: colors.borderLight,
                true: colors.depositHighlightBorder,
              }}
              thumbColor={
                announcePayments ? colors.accent : colors.surface
              }
              accessibilityLabel={t("profile.announcePaymentsLabel")}
              accessibilityRole="switch"
            />
          </View>
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

        <Text style={styles.sectionTitle}>{t("profile.sectionSecurity")}</Text>
        <View style={styles.sectionCard}>
          <View style={[styles.row, styles.rowBorder]}>
            <Text style={styles.rowLabel}>{t("profile.security")}</Text>
            <Text
              style={[
                styles.rowValue,
                styles.rowValueSoft,
                pinOk && accountComplete
                  ? { color: colors.accent }
                  : styles.rowValueMuted,
              ]}
            >
              {pinOk && accountComplete
                ? t("profile.pinSet")
                : t("profile.pinMissing")}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t("profile.language")}</Text>
            <Text
              style={[
                styles.rowValue,
                styles.rowValueMuted,
                styles.rowValueSoft,
              ]}
            >
              {langLabel}
            </Text>
          </View>
        </View>

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
