import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { digitsOnlyAmount, isValidAmountFcfa, MAX_AMOUNT_DIGITS } from "@/lib/amountLimits";
import { ApiError } from "@/lib/api/errors";
import type { ThemeColors } from "@/lib/theme/colors";
import { router, Stack } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
    inputWrap: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.inputBackground,
      borderRadius: 20,
      paddingHorizontal: 20,
      borderWidth: 1,
      borderColor: c.inputBorder,
      marginBottom: 20,
      marginTop: 8,
    },
    input: {
      flex: 1,
      height: 56,
      fontSize: 20,
      fontWeight: "700",
      color: c.text,
    },
    currency: {
      fontSize: 15,
      fontWeight: "800",
      color: c.textFaint,
      marginLeft: 8,
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
    primaryBtnSuccess: {
      backgroundColor: c.accent,
    },
    primaryBtnText: {
      color: c.accentOn,
      fontSize: 14,
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
  const { getDepositIntentStatus } = await import("@/lib/api/client");
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
  /** idle → loading (spinner) → success (coche) → retour Pay. */
  const [submitPhase, setSubmitPhase] = useState<
    "idle" | "loading" | "success"
  >("idle");
  const idempotencyKeyRef = useRef<string | null>(null);
  const amountInputRef = useRef<TextInput>(null);
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = windowHeight * SHEET_HEIGHT_RATIO;
  const busy = submitPhase !== "idle";

  const n = parseInt(amount, 10);
  const amountOk = isValidAmountFcfa(amount);

  useEffect(() => {
    const timer = setTimeout(() => {
      amountInputRef.current?.focus();
    }, Platform.OS === "android" ? 120 : 60);
    return () => clearTimeout(timer);
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
    if (busy) return;

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = newIdempotencyKey();
    }
    const idempotencyKey = idempotencyKeyRef.current;

    setSubmitPhase("loading");
    try {
      const { deposit: apiDeposit } = await import("@/lib/api/client");
      const res = await apiDeposit(token, n, idempotencyKey);
      if (res.status !== "completed" && res.depositIntentId) {
        await pollDepositCompleted(token, res.depositIntentId);
      }
      idempotencyKeyRef.current = null;
      setSubmitPhase("success");
      await new Promise<void>((r) => setTimeout(r, 700));
      router.back();
      void refreshUser();
    } catch (e) {
      setSubmitPhase("idle");
      Alert.alert(
        t("deposit.topUpTitle"),
        e instanceof ApiError ? e.message : t("deposit.creditFailed"),
      );
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
                <Text style={{ fontSize: 28, color: colors.text, lineHeight: 32 }}>
                  ×
                </Text>
              </Pressable>
              <Text style={styles.headerTitle}>{t("deposit.title")}</Text>
              <View style={styles.headerSpacer} />
            </View>

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
            >
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
                  onChangeText={(text) => {
                    idempotencyKeyRef.current = null;
                    setAmount(digitsOnlyAmount(text, MAX_AMOUNT_DIGITS));
                  }}
                  onSubmitEditing={() => {
                    void submitDeposit();
                  }}
                  maxLength={MAX_AMOUNT_DIGITS}
                  accessibilityLabel={t("deposit.amountLabel")}
                />
                <Text style={styles.currency}>{t("common.fcfa")}</Text>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed &&
                    amountOk &&
                    submitPhase === "idle" &&
                    styles.primaryBtnPressed,
                  (!amountOk || busy || !token) &&
                    submitPhase !== "success" &&
                    styles.primaryBtnDisabled,
                  submitPhase === "success" && styles.primaryBtnSuccess,
                ]}
                disabled={!amountOk || busy || !token}
                onPress={() => {
                  void submitDeposit();
                }}
                accessibilityState={{ busy }}
              >
                {submitPhase === "loading" ? (
                  <ActivityIndicator color={colors.accentOn} size="small" />
                ) : submitPhase === "success" ? (
                  <Text
                    style={[styles.primaryBtnText, { fontSize: 22 }]}
                    accessibilityLabel={t("deposit.success")}
                  >
                    ✓
                  </Text>
                ) : (
                  <Text style={styles.primaryBtnText}>{t("common.topUp")}</Text>
                )}
              </Pressable>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </View>
  );
}
