import { useAuth } from "@/contexts/AuthContext";
import { ApiError, deposit as apiDeposit } from "@/lib/api/client";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

const GREEN = "#5dc705";

/** Espace laissé au-dessus de la feuille (sous la zone statut / encoche). */
const SHEET_EXTRA_TOP = 36;

export default function DepositScreen() {
  const { token, refreshUser } = useAuth();
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const insets = useSafeAreaInsets();
  const sheetTopMargin = insets.top + SHEET_EXTRA_TOP;

  return (
    <View style={styles.root}>
      <Pressable
        style={styles.backdrop}
        onPress={() => router.back()}
        accessibilityLabel="Fermer"
        accessibilityRole="button"
      />
      <View style={[styles.sheetShell, { marginTop: sheetTopMargin }]}>
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
                <Ionicons name="close" size={28} color="#333" />
              </Pressable>
              <Text style={styles.headerTitle}>Recharger</Text>
              <View style={styles.headerSpacer} />
            </View>

            <View style={styles.body}>
              <Text style={styles.lead}>
                Le montant sera disponible tout de suite après validation.
              </Text>

              <Text style={styles.label}>Montant du dépôt</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor="#DDD"
                  keyboardType="numeric"
                  value={amount}
                  onChangeText={setAmount}
                  maxLength={8}
                />
                <Text style={styles.currency}>FCFA</Text>
              </View>

              <View style={styles.hintRow}>
                <View style={styles.hintIcon}>
                  <Ionicons name="flash-outline" size={18} color={GREEN} />
                </View>
                <Text style={styles.hint}>Paiement mobile — rapide et sécurisé</Text>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && parseInt(amount, 10) > 0 && styles.primaryBtnPressed,
                  (!amount || !(parseInt(amount, 10) > 0)) && styles.primaryBtnDisabled,
                ]}
                disabled={
                  !amount ||
                  !(parseInt(amount, 10) > 0) ||
                  submitting ||
                  !token
                }
                onPress={async () => {
                  const n = parseInt(amount, 10);
                  if (!Number.isFinite(n) || n <= 0 || !token) {
                    if (!token) {
                      Alert.alert(
                        "Connexion",
                        "Vous devez être connecté pour recharger.",
                      );
                    }
                    return;
                  }
                  setSubmitting(true);
                  try {
                    await apiDeposit(token, n);
                    await refreshUser();
                    router.back();
                  } catch (e) {
                    Alert.alert(
                      "Rechargement",
                      e instanceof ApiError
                        ? e.message
                        : "Impossible de créditer le compte.",
                    );
                  } finally {
                    setSubmitting(false);
                  }
                }}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>Valider</Text>
                )}
              </Pressable>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "transparent",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheetShell: {
    flex: 1,
    backgroundColor: "#fff",
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
    borderBottomColor: "#F0F0F0",
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
    color: "#333",
  },
  headerSpacer: { width: 44 },
  body: {
    flex: 1,
    paddingHorizontal: 25,
    paddingTop: 10,
  },
  lead: {
    fontSize: 13,
    color: "#666",
    lineHeight: 19,
    marginBottom: 22,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: "#888",
    marginBottom: 10,
    letterSpacing: 0.8,
    textAlign: "center",
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8F8F8",
    borderRadius: 20,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: "#EEE",
    marginBottom: 20,
  },
  input: {
    flex: 1,
    height: 72,
    fontSize: 28,
    fontWeight: "700",
    color: "#222",
  },
  currency: {
    fontSize: 18,
    fontWeight: "800",
    color: "#AAA",
    marginLeft: 8,
  },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  hintIcon: { marginRight: 10 },
  hint: {
    flex: 1,
    fontSize: 13,
    color: "#888",
    lineHeight: 18,
  },
  primaryBtn: {
    backgroundColor: GREEN,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  primaryBtnPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  primaryBtnDisabled: { backgroundColor: "#CCC" },
  primaryBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
