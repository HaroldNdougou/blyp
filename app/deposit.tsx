import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import {
  deposit as apiDeposit,
  ApiError,
  getDepositIntentStatus,
} from "@/lib/api/client";
import { setPendingDepositAmountForPayHome } from "@/lib/pendingDepositForPayHome";
import { digitsOnlyAmount, isValidAmountFcfa, MAX_AMOUNT_DIGITS } from "@/lib/amountLimits";
import type { ThemeColors } from "@/lib/theme/colors";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

/** Part de la hauteur d’écran occupée par la feuille modale (depuis le bas). */
const SHEET_HEIGHT_RATIO = 0.85;

const POLL_MS = 2500;
const POLL_MAX = 24;

function createDepositStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: "transparent",
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: c.overlay,
    },
    sheetShell: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: c.modal,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      overflow: "hidden",
    },
    sheet: {
      flex: 1,
    },
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
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 25,
      paddingTop: 10,
      paddingBottom: 24,
      flexGrow: 1,
    },
    label: {
      fontSize: 12,
      fontWeight: "600",
      color: c.textMuted,
      marginBottom: 10,
      letterSpacing: 0.8,
      textAlign: "center",
    },
    labelOption: {
      fontSize: 11,
      fontWeight: "600",
      color: c.textFaint,
      marginBottom: 8,
      textAlign: "center",
    },
    optionInput: {
      backgroundColor: c.surfaceMuted,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 12,
      color: c.text,
      borderWidth: 1,
      borderColor: c.inputBorder,
      marginBottom: 8,
    },
    optionInputSecond: {
      marginBottom: 12,
    },
    inputWrap: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.inputBackground,
      borderRadius: 20,
      paddingHorizontal: 20,
      borderWidth: 1,
      borderColor: c.inputBorder,
      marginBottom: 16,
    },
    input: {
      flex: 1,
      height: 72,
      fontSize: 28,
      fontWeight: "700",
      color: c.text,
    },
    currency: {
      fontSize: 18,
      fontWeight: "800",
      color: c.textFaint,
      marginLeft: 8,
    },
    waitingBox: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 14,
      paddingVertical: 10,
      paddingHorizontal: 12,
      backgroundColor: c.depositHighlightBackground,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.depositHighlightBorder,
    },
    waitingSpinner: { marginRight: 12 },
    waitingText: {
      flex: 1,
      fontSize: 13,
      color: c.textSecondary,
      lineHeight: 18,
    },
    primaryBtn: {
      marginTop: 8,
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
      fontSize: 16,
      fontWeight: "700",
    },
  });
}

function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return `idemp-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function pollDepositCompleted(
  token: string,
  depositIntentId: string,
): Promise<void> {
  for (let i = 0; i < POLL_MAX; i++) {
    await sleep(POLL_MS);
    const s = await getDepositIntentStatus(token, depositIntentId);
    if (s.status === "completed") return;
    if (s.status === "failed") {
      throw new ApiError(
        s.failureReason?.trim() || "Rechargement échoué ou annulé.",
        409,
      );
    }
  }
  throw new ApiError(
    "Délai dépassé. Vérifiez votre solde dans un instant ou réessayez.",
    408,
  );
}

export default function DepositScreen() {
  const { token, refreshUser } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createDepositStyles(colors), [colors]);
  const [amount, setAmount] = useState("");
  /** Optionnel : numéro facturé par PawaPay (ex. MSISDN sandbox 237653456789). */
  const [sandboxPayerPhone, setSandboxPayerPhone] = useState("");
  /** Optionnel : MTN_MOMO_CMR ou ORANGE_CMR si l’auto-détection ne convient pas. */
  const [sandboxMmProvider, setSandboxMmProvider] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [waitingProvider, setWaitingProvider] = useState(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const amountInputRef = useRef<TextInput>(null);
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = windowHeight * SHEET_HEIGHT_RATIO;

  const n = parseInt(amount, 10);
  const amountOk = isValidAmountFcfa(amount);

  useEffect(() => {
    const t = setTimeout(() => {
      amountInputRef.current?.focus();
    }, Platform.OS === "android" ? 120 : 60);
    return () => clearTimeout(t);
  }, []);

  const submitDeposit = async () => {
    if (!Number.isFinite(n) || n <= 0 || !token) {
      if (!token) {
        Alert.alert(
          t("deposit.signInRequiredTitle"),
          t("deposit.signInRequiredMessage"),
        );
      }
      return;
    }
    if (submitting || waitingProvider) return;

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = newIdempotencyKey();
    }
    const idempotencyKey = idempotencyKeyRef.current;

    setSubmitting(true);
    try {
      const res = await apiDeposit(token, n, idempotencyKey, {
        payerPhone: sandboxPayerPhone.trim() || undefined,
        mmProvider: sandboxMmProvider.trim() || undefined,
      });
      if (res.status === "completed") {
        await refreshUser();
        setPendingDepositAmountForPayHome(n);
        idempotencyKeyRef.current = null;
        router.back();
        return;
      }
      setSubmitting(false);
      setWaitingProvider(true);
      await pollDepositCompleted(token, res.depositIntentId);
      await refreshUser();
      setPendingDepositAmountForPayHome(n);
      idempotencyKeyRef.current = null;
      router.back();
    } catch (e) {
      Alert.alert(
        t("deposit.topUpTitle"),
        e instanceof ApiError
          ? e.message
          : t("deposit.creditFailed"),
      );
    } finally {
      setSubmitting(false);
      setWaitingProvider(false);
    }
  };

  return (
    <View style={styles.root}>
      <Pressable
        style={styles.backdrop}
        onPress={() => router.back()}
        accessibilityLabel={t("common.close")}
        accessibilityRole="button"
      />
      <View style={[styles.sheetShell, { height: sheetHeight }]}>
        <KeyboardAvoidingView
          style={styles.sheet}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Stack.Screen options={{ headerShown: false }} />
          <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
            <View style={styles.header}>
              <Pressable
                onPress={() => router.back()}
                style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
                hitSlop={12}
              >
                <Ionicons name="close" size={28} color={colors.text} />
              </Pressable>
              <Text style={styles.headerTitle}>{t("deposit.title")}</Text>
              <View style={styles.headerSpacer} />
            </View>

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              <Text style={styles.label}>{t("deposit.amountLabel")}</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  ref={amountInputRef}
                  style={styles.input}
                  placeholder={t("deposit.amountPlaceholder")}
                  placeholderTextColor={colors.placeholder}
                  keyboardType="numeric"
                  returnKeyType="done"
                  autoFocus
                  value={amount}
                  onChangeText={(t) => {
                    idempotencyKeyRef.current = null;
                    setAmount(digitsOnlyAmount(t, MAX_AMOUNT_DIGITS));
                  }}
                  onSubmitEditing={() => {
                    void submitDeposit();
                  }}
                  maxLength={MAX_AMOUNT_DIGITS}
                />
                <Text style={styles.currency}>{t("common.fcfa")}</Text>
              </View>

              <Text style={styles.labelOption}>{t("deposit.pawapayPhoneLabel")}</Text>
              <TextInput
                style={styles.optionInput}
                placeholder={t("deposit.pawapayPhonePlaceholder")}
                placeholderTextColor={colors.placeholder}
                keyboardType="phone-pad"
                returnKeyType="done"
                value={sandboxPayerPhone}
                onChangeText={setSandboxPayerPhone}
                onSubmitEditing={() => {
                  void submitDeposit();
                }}
              />
              <TextInput
                style={[styles.optionInput, styles.optionInputSecond]}
                placeholder={t("deposit.pawapayProviderPlaceholder")}
                placeholderTextColor={colors.placeholder}
                autoCapitalize="characters"
                returnKeyType="done"
                value={sandboxMmProvider}
                onChangeText={setSandboxMmProvider}
                onSubmitEditing={() => {
                  void submitDeposit();
                }}
              />

              {waitingProvider ? (
                <View style={styles.waitingBox}>
                  <ActivityIndicator
                    color={colors.accent}
                    size="small"
                    style={styles.waitingSpinner}
                  />
                  <Text style={styles.waitingText}>
                    {t("deposit.waitingProvider")}
                  </Text>
                </View>
              ) : null}

              <Pressable
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && amountOk && styles.primaryBtnPressed,
                  (!amountOk || submitting || waitingProvider || !token) &&
                    styles.primaryBtnDisabled,
                ]}
                disabled={
                  !amountOk ||
                  submitting ||
                  waitingProvider ||
                  !token
                }
                onPress={() => {
                  void submitDeposit();
                }}
              >
                {submitting || waitingProvider ? (
                  <ActivityIndicator color={colors.accentOn} size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>{t("common.validate")}</Text>
                )}
              </Pressable>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </View>
  );
}
