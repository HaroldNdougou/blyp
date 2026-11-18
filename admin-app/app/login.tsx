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
import { login } from "../lib/api";
import { requestElevation } from "../lib/adminWallet";
import { setSessionPassword } from "../lib/adminSession";
import { ensurePushRegistered } from "../lib/notifications";
import type { ThemeColors } from "../lib/theme";

function createLoginStyles(c: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.bg },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: 24,
      justifyContent: "flex-start",
    },
    brand: {
      color: c.accent,
      fontSize: 28,
      fontWeight: "600",
      marginBottom: 20,
      textAlign: "center",
      alignSelf: "stretch",
    },
    form: { gap: 12 },
    input: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 12,
      color: c.text,
      paddingHorizontal: 14,
      paddingVertical: 14,
      fontSize: 16,
    },
    error: { color: c.danger, marginTop: 4 },
    btn: {
      marginTop: 8,
      backgroundColor: c.accent,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
    },
    btnDisabled: { opacity: 0.45 },
    btnText: { color: c.onAccent, fontWeight: "800", fontSize: 16 },
  });
}

export default function LoginScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createLoginStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    return email.trim().length > 0 && password.length > 0 && totp.trim().length === 6;
  }, [email, password, totp]);

  const onSubmit = useCallback(async () => {
    if (busy || !canSubmit) return;
    Keyboard.dismiss();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password, totp.trim());
      setSessionPassword(password);
      await requestElevation(password, totp.trim()).catch(() => {});
      await ensurePushRegistered().catch(() => {});
      router.replace("/home");
    } catch (e: any) {
      if (e?.status === 429 && e?.retryAfterSec != null) {
        const sec = Number(e.retryAfterSec);
        const min = Math.max(1, Math.ceil(sec / 60));
        setError(`Trop d'essais. Réessaie dans environ ${min} min.`);
      } else {
        setError(e?.message || "Connexion impossible");
      }
    } finally {
      setBusy(false);
    }
  }, [busy, canSubmit, email, password, totp]);

  const onTotpSubmit = useCallback(() => {
    if (busy || !canSubmit) return;
    void onSubmit();
  }, [busy, canSubmit, onSubmit]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
    >
      <ScrollView
        style={styles.flex}
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 120 },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.brand}>Blyp admin</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor={colors.muted}
            value={email}
            onChangeText={setEmail}
            returnKeyType="next"
          />
          <TextInput
            style={styles.input}
            secureTextEntry
            placeholder="Mot de passe"
            placeholderTextColor={colors.muted}
            value={password}
            onChangeText={setPassword}
            returnKeyType="next"
          />
          <TextInput
            style={styles.input}
            keyboardType={Platform.OS === "android" ? "numeric" : "number-pad"}
            maxLength={6}
            placeholder="Code à 6 chiffres"
            placeholderTextColor={colors.muted}
            value={totp}
            onChangeText={setTotp}
            returnKeyType="done"
            blurOnSubmit={false}
            onSubmitEditing={onTotpSubmit}
            submitBehavior="submit"
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.btn, (!canSubmit || busy) && styles.btnDisabled]}
            onPress={onSubmit}
            disabled={busy || !canSubmit}
          >
            {busy ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={styles.btnText}>Se connecter</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}