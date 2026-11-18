import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../contexts/ThemeContext";
import {
  adjustUserBalance,
  listAdminUsers,
  newIdempotencyKey,
  userLabel,
  type AdminUserSummary,
} from "../lib/adminWallet";
import type { ThemeColors } from "../lib/theme";

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    pad: { paddingHorizontal: 20, paddingBottom: 32 },
    top: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingBottom: 16,
    },
    h1: { color: c.text, fontSize: 20, fontWeight: "700" },
    close: { color: c.muted, fontSize: 15 },
    field: { marginBottom: 14 },
    label: { color: c.muted, fontSize: 12, marginBottom: 6 },
    input: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 12,
      color: c.text,
      paddingHorizontal: 14,
      paddingVertical: 14,
      fontSize: 17,
    },
    userLine: {
      marginBottom: 16,
      padding: 12,
      borderRadius: 12,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
    },
    userName: { color: c.text, fontWeight: "600", fontSize: 16 },
    userBal: { color: c.accent, fontWeight: "700", marginTop: 4, fontSize: 15 },
    signRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
    signBtn: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      backgroundColor: c.card,
    },
    signOn: { borderColor: c.accent },
    signText: { color: c.muted, fontWeight: "700", fontSize: 16 },
    signTextOn: { color: c.accent },
    go: {
      backgroundColor: c.accent,
      borderRadius: 14,
      paddingVertical: 16,
      alignItems: "center",
      marginTop: 6,
    },
    goOff: { opacity: 0.45 },
    goText: { color: c.onAccent, fontWeight: "800", fontSize: 17 },
    err: { color: c.danger, marginBottom: 10, fontSize: 14 },
    ok: { color: c.accent, marginBottom: 10, fontSize: 14, fontWeight: "600" },
  });
}

export default function RechargeScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState("");
  const [user, setUser] = useState<AdminUserSummary | null>(null);
  const [credit, setCredit] = useState(true);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const findUser = useCallback(async () => {
    Keyboard.dismiss();
    setError(null);
    setOk(null);
    const q = query.trim();
    if (q.length < 2) {
      setError("Saisis au moins 2 caractères.");
      return;
    }
    setBusy(true);
    try {
      const { users } = await listAdminUsers(q);
      if (!users.length) {
        setUser(null);
        setError("Personne trouvée.");
        return;
      }
      setUser(users[0]);
    } catch (e: any) {
      setError(e?.message || "Recherche impossible");
    } finally {
      setBusy(false);
    }
  }, [query]);

  const apply = useCallback(async () => {
    if (!user || busy) return;
    const amt = parseInt(amount.replace(/\D/g, "") || "0", 10);
    if (amt < 1) {
      setError("Montant invalide.");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await adjustUserBalance({
        userId: user.userId,
        direction: credit ? "credit" : "debit",
        amountFcfa: amt,
        idempotencyKey: newIdempotencyKey(),
      });
      setUser({ ...user, balanceFcfa: res.balanceAfterFcfa });
      setOk(`Nouveau solde : ${Math.round(res.balanceAfterFcfa).toLocaleString("fr-FR")} F`);
      setAmount("");
    } catch (e: any) {
      setError(e?.message || "Échec");
    } finally {
      setBusy(false);
    }
  }, [amount, busy, credit, user]);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
    >
      <View style={[styles.top, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.h1}>Solde client</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.close}>Fermer</Text>
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.pad, { flexGrow: 1, paddingBottom: insets.bottom + 120 }]}
      >
        <View style={styles.field}>
          <Text style={styles.label}>Téléphone ou nom</Text>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={(t) => {
              setQuery(t);
              setUser(null);
            }}
            placeholder="6XX…"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            onSubmitEditing={() => void findUser()}
          />
        </View>
        <Pressable style={[styles.go, busy && styles.goOff]} onPress={() => void findUser()} disabled={busy}>
          {busy && !user ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={styles.goText}>Trouver le client</Text>
          )}
        </Pressable>

        {user ? (
          <>
            <View style={[styles.userLine, { marginTop: 16 }]}>
              <Text style={styles.userName}>{userLabel(user)}</Text>
              <Text style={styles.userBal}>
                {Math.round(user.balanceFcfa).toLocaleString("fr-FR")} F
              </Text>
            </View>

            <View style={styles.signRow}>
              <Pressable
                style={[styles.signBtn, credit && styles.signOn]}
                onPress={() => setCredit(true)}
              >
                <Text style={[styles.signText, credit && styles.signTextOn]}>+ Ajouter</Text>
              </Pressable>
              <Pressable
                style={[styles.signBtn, !credit && styles.signOn]}
                onPress={() => setCredit(false)}
              >
                <Text style={[styles.signText, !credit && styles.signTextOn]}>− Retirer</Text>
              </Pressable>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Montant (F)</Text>
              <TextInput
                style={styles.input}
                value={amount}
                onChangeText={setAmount}
                keyboardType={Platform.OS === "android" ? "numeric" : "number-pad"}
                placeholder="0"
                placeholderTextColor={colors.muted}
              />
            </View>

            {error ? <Text style={styles.err}>{error}</Text> : null}
            {ok ? <Text style={styles.ok}>{ok}</Text> : null}

            <Pressable style={[styles.go, busy && styles.goOff]} onPress={() => void apply()} disabled={busy}>
              {busy ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={styles.goText}>Valider</Text>
              )}
            </Pressable>
          </>
        ) : error ? (
          <Text style={[styles.err, { marginTop: 12 }]}>{error}</Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}