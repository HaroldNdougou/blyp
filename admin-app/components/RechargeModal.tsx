import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../contexts/ThemeContext";
import {
  adjustUserBalance,
  confirmMoneyRequest,
  listAdminUsers,
  newIdempotencyKey,
  rejectMoneyRequest,
  userLabel,
  type AdminUserSummary,
} from "../lib/adminWallet";
import { money } from "../lib/adminTypes";
import type { ThemeColors } from "../lib/theme";
import {
  fetchWithdrawalRequests,
  formatRequestWhen,
  markWithdrawalHandled,
  type WithdrawalRequestRow,
} from "../lib/withdrawalRequests";

type Props = {
  visible: boolean;
  mode?: "deposit" | "withdrawal";
  onClose: () => void;
  onBalanceChanged?: () => void;
};

function digits9(raw: string) {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("237") && d.length >= 12) d = d.slice(3);
  if (d.length > 9) d = d.slice(-9);
  return d;
}

function isOrange(raw: string) {
  const d = digits9(raw);
  if (d.length < 3 || d[0] !== "6") return false;
  if (d.startsWith("69") || d.startsWith("640") || d.startsWith("686")) return true;
  if (d.startsWith("65")) {
    const third = Number(d[2]);
    if (third >= 5 && third <= 9) return true;
  }
  return false;
}

function dialWithdrawal(phone: string, amount: number) {
  const tel = digits9(phone);
  if (tel.length < 9 || amount < 1) return;
  const code = isOrange(tel)
    ? `#150*11*${tel}*${amount}*2#`
    : `*126*11*${tel}*${amount}#`;
  void Linking.openURL(`tel:${code.replace(/#/g, "%23")}`);
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: c.bg,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: "92%",
      borderTopWidth: 1,
      borderColor: c.border,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingHorizontal: 18,
      paddingBottom: 12,
    },
    title: { color: c.text, fontSize: 18, fontWeight: "700" },
    close: { color: c.muted, fontSize: 15, fontWeight: "600" },
    section: { color: c.accent, fontWeight: "800", fontSize: 13, marginBottom: 8, marginHorizontal: 18 },
    pad: { paddingHorizontal: 18, paddingBottom: 16 },
    row: {
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 12,
      marginBottom: 8,
    },
    name: { color: c.text, fontWeight: "700", fontSize: 15 },
    meta: { color: c.muted, fontSize: 13, marginTop: 4 },
    amount: { color: c.text, fontWeight: "800", fontSize: 16, marginTop: 6 },
    muted: { color: c.muted, textAlign: "center", marginVertical: 12, marginHorizontal: 18 },
    link: {
      marginHorizontal: 18,
      marginBottom: 12,
      paddingVertical: 12,
      alignItems: "center",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
    },
    linkText: { color: c.accent, fontWeight: "700" },
    input: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 12,
      color: c.text,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      marginBottom: 10,
    },
    label: { color: c.muted, fontSize: 12, marginBottom: 6 },
    signRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
    signBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      backgroundColor: c.card,
    },
    signOn: { borderColor: c.accent },
    signText: { color: c.muted, fontWeight: "700" },
    signTextOn: { color: c.accent },
    go: {
      backgroundColor: c.accent,
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: "center",
      marginTop: 4,
    },
    goText: { color: c.onAccent, fontWeight: "800", fontSize: 16 },
    err: { color: c.danger, marginHorizontal: 18, marginBottom: 8 },
    ok: { color: c.accent, marginHorizontal: 18, marginBottom: 8 },
    actionRow: { flexDirection: "row", gap: 10, marginTop: 10 },
    accept: { flex: 1, backgroundColor: c.accent, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
    reject: {
      flex: 1,
      borderRadius: 10,
      paddingVertical: 10,
      alignItems: "center",
      borderWidth: 1,
      borderColor: c.danger,
    },
    acceptText: { color: c.onAccent, fontWeight: "700" },
    rejectText: { color: c.danger, fontWeight: "700" },
  });
}

export function RechargeModal({ visible, mode = "deposit", onClose, onBalanceChanged }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState<WithdrawalRequestRow[]>([]);
  const [picked, setPicked] = useState<WithdrawalRequestRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [showFree, setShowFree] = useState(false);

  const [query, setQuery] = useState("");
  const [user, setUser] = useState<AdminUserSummary | null>(null);
  const [credit, setCredit] = useState(true);
  const [amount, setAmount] = useState("");

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchWithdrawalRequests();
      setRequests(items.filter((row) => row.kind === mode));
    } catch (e: any) {
      setError(e?.message || "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    if (!visible) return;
    setPicked(null);
    setShowFree(false);
    setError(null);
    setOk(null);
    void loadRequests();
  }, [visible, loadRequests]);

  const onReject = useCallback(
    (row: WithdrawalRequestRow) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      void rejectMoneyRequest(row.id)
        .then(() => {
          markWithdrawalHandled(row.id);
          setRequests((prev) => prev.filter((r) => r.id !== row.id));
          setPicked(null);
          setOk("Demande rejetée.");
        })
        .catch((e: any) => setError(e?.message || "Rejet impossible"))
        .finally(() => setBusy(false));
    },
    [busy],
  );

  const onAccept = useCallback(
    async (row: WithdrawalRequestRow) => {
      if (!row.userId || busy) return;
      setBusy(true);
      setError(null);
      try {
        if (mode === "withdrawal") dialWithdrawal(row.phone, row.amountFcfa);
        await confirmMoneyRequest(row.id);
        markWithdrawalHandled(row.id);
        setRequests((prev) => prev.filter((r) => r.id !== row.id));
        setPicked(null);
        const label = row.kind === "deposit" ? "rechargée" : "retirée";
        setOk(`${row.name} ${label} · ${money(row.amountFcfa)}`);
        onBalanceChanged?.();
      } catch (e: any) {
        setError(e?.message || "Confirmation impossible");
      } finally {
        setBusy(false);
      }
    },
    [busy, mode, onBalanceChanged],
  );

  const findUser = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) {
      setError("Saisis au moins 2 caractères.");
      return;
    }
    setBusy(true);
    setError(null);
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

  const freeSubmit = useCallback(async () => {
    if (!user || busy) return;
    const amt = parseInt(amount.replace(/\D/g, "") || "0", 10);
    if (amt < 1) {
      setError("Montant invalide.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await adjustUserBalance({
        userId: user.userId,
        direction: mode === "withdrawal" ? "debit" : credit ? "credit" : "debit",
        amountFcfa: amt,
        idempotencyKey: newIdempotencyKey(),
        reason: mode === "withdrawal" ? "Retrait" : "Recharge",
      });
      setOk(`Nouveau solde : ${money(res.balanceAfterFcfa)}`);
      setAmount("");
      setUser({ ...user, balanceFcfa: res.balanceAfterFcfa });
      onBalanceChanged?.();
    } catch (e: any) {
      setError(e?.message || "Échec");
    } finally {
      setBusy(false);
    }
  }, [amount, busy, credit, mode, onBalanceChanged, user]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable
          style={[styles.sheet, { paddingTop: insets.top > 0 ? 12 : 16, paddingBottom: insets.bottom + 8 }]}
          onPress={() => {}}
        >
          <View style={styles.header}>
            <Text style={styles.title}>{mode === "withdrawal" ? "Retraits" : "Recharges"}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>Fermer</Text>
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <Text style={styles.section}>Demandes</Text>
            {loading ? (
              <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
            ) : requests.length === 0 ? (
              <Text style={styles.muted}>Aucune demande en attente.</Text>
            ) : (
              <View style={styles.pad}>
                {requests.map((row) => (
                  <Pressable
                    key={row.id}
                    style={styles.row}
                    onPress={() => setPicked(picked?.id === row.id ? null : row)}
                  >
                    <Text style={styles.name}>{row.name}</Text>
                    <Text style={styles.meta}>
                      {row.summary} · {row.phone} · {formatRequestWhen(row.at)}
                    </Text>
                    <Text style={styles.amount}>{money(row.amountFcfa)}</Text>
                    {picked?.id === row.id ? (
                      <View style={styles.actionRow}>
                        <Pressable
                          style={styles.accept}
                          disabled={busy}
                          onPress={() => void onAccept(row)}
                        >
                          <Text style={styles.acceptText}>Confirmer</Text>
                        </Pressable>
                        <Pressable style={styles.reject} onPress={() => onReject(row)}>
                          <Text style={styles.rejectText}>Rejeter</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            )}

            <Pressable style={styles.link} onPress={() => setShowFree((v) => !v)}>
              <Text style={styles.linkText}>
                {showFree
                  ? mode === "withdrawal"
                    ? "Masquer le retrait libre"
                    : "Masquer la recharge libre"
                  : mode === "withdrawal"
                    ? "Retrait libre"
                    : "Recharge libre (manuelle)"}
              </Text>
            </Pressable>

            {showFree ? (
              <View style={styles.pad}>
                <Text style={styles.label}>Téléphone ou nom</Text>
                <TextInput
                  style={styles.input}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="6XX…"
                  placeholderTextColor={colors.muted}
                />
                <Pressable style={styles.go} onPress={() => void findUser()} disabled={busy}>
                  <Text style={styles.goText}>Trouver</Text>
                </Pressable>
                {user ? (
                  <>
                    <Text style={[styles.name, { marginTop: 12 }]}>{userLabel(user)}</Text>
                    <Text style={styles.meta}>
                      {user.phone ?? "—"} · {money(user.balanceFcfa)}
                    </Text>
                    {mode === "deposit" ? (
                    <View style={[styles.signRow, { marginTop: 10 }]}>
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
                    ) : null}
                    <Text style={styles.label}>Montant (F)</Text>
                    <TextInput
                      style={styles.input}
                      value={amount}
                      onChangeText={setAmount}
                      keyboardType={Platform.OS === "android" ? "numeric" : "number-pad"}
                      placeholder="0"
                      placeholderTextColor={colors.muted}
                    />
                    <Pressable style={styles.go} onPress={() => void freeSubmit()} disabled={busy}>
                      {busy ? (
                        <ActivityIndicator color={colors.onAccent} />
                      ) : (
                        <Text style={styles.goText}>Valider</Text>
                      )}
                    </Pressable>
                  </>
                ) : null}
              </View>
            ) : null}

            {error ? <Text style={styles.err}>{error}</Text> : null}
            {ok ? <Text style={styles.ok}>{ok}</Text> : null}
          </ScrollView>
        </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}