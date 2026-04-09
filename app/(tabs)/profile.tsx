import { useAuth } from "@/contexts/AuthContext";
import {
  formatCameroonPhoneDisplay,
  formatFcfa,
} from "@/lib/format";
import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import React, { useState } from "react";
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

const ACCENT = "#5dc705";

export default function ProfileTabScreen() {
  const { user, token, signOut, isLoading } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  if (!isLoading && !token) {
    return <Redirect href="/" />;
  }

  const phoneDigits = user?.phone.replace(/\D/g, "").slice(-9) ?? "";
  const displayName =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`.trim()
      : "Compte";

  const onSignOut = () => {
    Alert.alert(
      "Déconnexion",
      "Voulez-vous vous déconnecter ?",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Déconnexion",
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
          <ActivityIndicator color={ACCENT} size="large" />
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
          <Text style={styles.title}>Profil</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={40} color={ACCENT} />
          </View>
          <Text style={styles.name}>{displayName}</Text>
          {user?.needsOnboarding && (
            <Text style={styles.hintOnboarding}>
              Terminez l’inscription (PIN / profil) depuis l’écran d’accueil.
            </Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Téléphone</Text>
          <Text style={styles.sectionValue}>
            {phoneDigits
              ? `+237 ${formatCameroonPhoneDisplay(phoneDigits)}`
              : "—"}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Solde</Text>
          <Text style={styles.sectionValueAccent}>
            {formatFcfa(user?.balanceFcfa ?? 0)} FCFA
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
          accessibilityLabel="Se déconnecter"
        >
          {signingOut ? (
            <ActivityIndicator color="#c62828" size="small" />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={22} color="#c62828" />
              <Text style={styles.signOutText}>Se déconnecter</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#FFFFFF",
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
    borderBottomColor: "#F0F0F0",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#000",
  },
  card: {
    alignItems: "center",
    paddingVertical: 28,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#F5F5F5",
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#F0F4F2",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
  },
  name: {
    fontSize: 20,
    fontWeight: "700",
    color: "#222",
    textAlign: "center",
  },
  hintOnboarding: {
    marginTop: 10,
    fontSize: 13,
    color: "#888",
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: 12,
  },
  section: {
    paddingHorizontal: 25,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#F5F5F5",
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#999",
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  sectionValue: {
    fontSize: 17,
    fontWeight: "600",
    color: "#333",
  },
  sectionValueAccent: {
    fontSize: 19,
    fontWeight: "800",
    color: ACCENT,
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
    borderColor: "#FFCDD2",
    backgroundColor: "#FFF8F8",
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
    color: "#c62828",
  },
});
