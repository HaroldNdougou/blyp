import { useTheme } from "@/contexts/ThemeContext";
import { normalizeCameroonPhoneDigits } from "@/lib/format";
import type { ThemeColors } from "@/lib/theme/colors";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

function createRegisterStyles(c: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    safe: { flex: 1 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: c.borderLight,
    },
    closeBtn: {
      width: 44,
      height: 44,
      justifyContent: "center",
      alignItems: "flex-start",
    },
    closeBtnPressed: { opacity: 0.6 },
    headerTitle: {
      fontSize: 17,
      fontWeight: "700",
      color: c.text,
    },
    headerSpacer: { width: 44 },
    body: {
      flex: 1,
      paddingHorizontal: 25,
      paddingTop: 28,
    },
    lead: {
      fontSize: 15,
      color: c.textSecondary,
      lineHeight: 22,
      marginBottom: 32,
    },
    label: {
      fontSize: 12,
      fontWeight: "600",
      color: c.textMuted,
      marginBottom: 8,
      letterSpacing: 0.8,
    },
    inputWrap: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.inputBackground,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.inputBorder,
      paddingHorizontal: 16,
      marginBottom: 28,
    },
    prefix: {
      fontSize: 17,
      fontWeight: "700",
      color: c.text,
      marginRight: 8,
    },
    input: {
      flex: 1,
      height: 54,
      fontSize: 18,
      fontWeight: "600",
      color: c.text,
    },
    primaryBtn: {
      backgroundColor: c.accent,
      height: 56,
      borderRadius: 28,
      justifyContent: "center",
      alignItems: "center",
    },
    primaryBtnPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
    primaryBtnDisabled: { backgroundColor: c.disabledButton },
    primaryBtnText: {
      color: c.accentOn,
      fontSize: 17,
      fontWeight: "700",
    },
  });
}

export default function RegisterScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createRegisterStyles(colors), [colors]);
  const params = useLocalSearchParams<{ phone?: string }>();
  const fromWelcome =
    typeof params.phone === "string"
      ? params.phone
      : Array.isArray(params.phone)
        ? params.phone[0] ?? ""
        : "";
  const [phone, setPhone] = useState(() =>
    normalizeCameroonPhoneDigits(fromWelcome),
  );

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
            hitSlop={12}
          >
            <Ionicons name="close" size={28} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>{t("register.createAccount")}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.body}>
          <Text style={styles.lead}>{t("register.phoneLead")}</Text>

          <Text style={styles.label}>{t("register.phoneLabel")}</Text>
          <View style={styles.inputWrap}>
            <Text style={styles.prefix}>+237</Text>
            <TextInput
              style={styles.input}
              placeholder={t("register.phonePlaceholder")}
              placeholderTextColor={colors.placeholder}
              keyboardType="number-pad"
              maxLength={9}
              value={phone}
              onChangeText={(t) => setPhone(normalizeCameroonPhoneDigits(t))}
              autoFocus
              showSoftInputOnFocus
            />
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && phone.length === 9 && styles.primaryBtnPressed,
              phone.length !== 9 && styles.primaryBtnDisabled,
            ]}
            disabled={phone.length !== 9}
            onPress={() => {
              /* TODO: envoi OTP */
              router.back();
            }}
          >
            <Text style={styles.primaryBtnText}>{t("common.continue")}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
