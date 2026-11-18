import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAdminDashboard } from "../../contexts/AdminDashboardContext";
import { useTheme } from "../../contexts/ThemeContext";
import { createAdminScreenStyles } from "../../lib/adminScreenStyles";

export default function ReglagesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createAdminScreenStyles(colors), [colors]);
  const { admin, logoutAdmin } = useAdminDashboard();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
    >
      <Text style={styles.section}>Compte</Text>
      <View style={styles.rowCard}>
        <Text style={styles.rowLabel}>Connecté en tant que</Text>
        <Text style={styles.rowValue}>{admin || "—"}</Text>
      </View>
      <View style={styles.rowCard}>
        <Text style={styles.rowLabel}>Apparence</Text>
        <Text style={styles.rowValue}>Suit le réglage du téléphone</Text>
      </View>
      <Pressable style={styles.dangerBtn} onPress={() => void logoutAdmin()}>
        <Text style={styles.dangerBtnText}>Déconnexion</Text>
      </Pressable>
    </ScrollView>
  );
}