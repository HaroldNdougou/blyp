import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../contexts/ThemeContext";
import { unlockWithDevice } from "../lib/api";
import { setSessionPassword } from "../lib/adminSession";
import { ensurePushRegistered } from "../lib/notifications";
import type { ThemeColors } from "../lib/theme";

const PASS_KEY = "blyp_admin_password";

function createLoginStyles(c: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center" },
    brand: {
      color: c.accent,
      fontSize: 28,
      fontWeight: "600",
      marginBottom: 28,
      textAlign: "center",
    },
    error: { color: c.danger, marginBottom: 16, textAlign: "center", paddingHorizontal: 24 },
    btn: {
      backgroundColor: c.accent,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 28,
      alignItems: "center",
      minWidth: 220,
    },
    btnDisabled: { opacity: 0.45 },
    btnText: { color: c.onAccent, fontWeight: "800", fontSize: 16 },
  });
}

export default function LoginScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createLoginStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enter = useCallback(async () => {
    const pass = await SecureStore.getItemAsync(PASS_KEY);
    if (pass) setSessionPassword(pass);
    await ensurePushRegistered().catch(() => {});
    router.replace("/home");
  }, []);

  const promptUnlock = useCallback(async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Déverrouiller Blyp admin",
        cancelLabel: "Annuler",
        fallbackLabel: "Code",
        disableDeviceFallback: false,
      });
      if (!result.success) return;
      try {
        await unlockWithDevice();
      } catch {
        setError("Ouverture impossible.");
        return;
      }
      await enter();
    } catch {
      setError("Empreinte ou code indisponible.");
    } finally {
      setBusy(false);
    }
  }, [busy, enter]);

  useEffect(() => {
    void promptUnlock();
    // Une seule demande au premier affichage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.flex, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Text style={styles.brand}>Blyp admin</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={[styles.btn, busy && styles.btnDisabled]} onPress={() => void promptUnlock()} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.btnText}>Empreinte ou code</Text>}
      </Pressable>
    </View>
  );
}
