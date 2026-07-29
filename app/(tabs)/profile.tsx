import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import {
  formatCameroonPhoneDisplay,
  formatFcfa,
} from "@/lib/format";
import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ThemeColors } from "@/lib/theme/colors";
import { useTranslation } from "react-i18next";

function createProfileStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: c.background,
    },
    loadingWrap: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
    },
    scroll: {
      paddingBottom: 32,
    },
    header: {
      paddingHorizontal: 25,
      paddingVertical: 20,
      borderBottomWidth: 1,
      borderBottomColor: c.borderLight,
    },
    title: {
      fontSize: 24,
      fontWeight: "700",
      color: c.text,
    },
    card: {
      alignItems: "center",
      paddingVertical: 28,
      paddingHorizontal: 20,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    avatar: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: c.avatarBackground,
      justifyContent: "center",
      alignItems: "center",
      marginBottom: 14,
    },
    name: {
      fontSize: 20,
      fontWeight: "700",
      color: c.text,
      textAlign: "center",
    },
    hintOnboarding: {
      marginTop: 10,
      fontSize: 13,
      color: c.textMuted,
      textAlign: "center",
      lineHeight: 18,
      paddingHorizontal: 12,
    },
    section: {
      paddingHorizontal: 25,
      paddingVertical: 18,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: "600",
      color: c.textMuted,
      marginBottom: 6,
      letterSpacing: 0.5,
    },
    sectionValue: {
      fontSize: 17,
      fontWeight: "600",
      color: c.text,
    },
    sectionValueAccent: {
      fontSize: 19,
      fontWeight: "800",
      color: c.accent,
    },
    signOutBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      marginHorizontal: 25,
      marginTop: 28,
      paddingVertical: 16,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.signOutBorder,
      backgroundColor: c.signOutBackground,
    },
    signOutBtnPressed: {
      opacity: 0.85,
    },
    signOutBtnDisabled: {
      opacity: 0.6,
    },
    signOutText: {
      fontSize: 16,
      fontWeight: "700",
      color: c.destructive,
    },
  });
}

export default function ProfileTabScreen() {
  const { user, token, signOut, isLoading } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createProfileStyles(colors), [colors]);
  const [signingOut, setSigningOut] = useState(false);

  if (!isLoading && !token) {
    return <Redirect href="/" />;
  }

  const phoneDigits = user?.phone.replace(/\D/g, "").slice(-9) ?? "";
  const displayName =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`.trim()
      : t("common.account");

  const onSignOut = () => {
    Alert.alert(
      t("profile.signOutTitle"),
      t("profile.signOutMessage"),
      [
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
      ],
    );
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
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t("profile.title")}</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={40} color={colors.accent} />
          </View>
          <Text style={styles.name}>{displayName}</Text>
          {user?.needsOnboarding && (
            <Text style={styles.hintOnboarding}>
              {t("profile.onboardingHint")}
            </Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t("profile.phone")}</Text>
          <Text style={styles.sectionValue}>
            {phoneDigits
              ? `+237 ${formatCameroonPhoneDisplay(phoneDigits)}`
              : "—"}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t("profile.balance")}</Text>
          <Text style={styles.sectionValueAccent}>
            {formatFcfa(user?.balanceFcfa ?? 0)} {t("common.fcfa")}
          </Text>
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
              <Ionicons name="log-out-outline" size={22} color={colors.destructive} />
              <Text style={styles.signOutText}>{t("profile.signOut")}</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
