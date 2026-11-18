import { useMemo } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AdminStat } from "../../components/AdminStat";
import { useAdminDashboard } from "../../contexts/AdminDashboardContext";
import { useTheme } from "../../contexts/ThemeContext";
import { money } from "../../lib/adminTypes";
import { createAdminScreenStyles } from "../../lib/adminScreenStyles";

export default function StatsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createAdminScreenStyles(colors), [colors]);
  const { overview, loading, refreshing, error, refresh } = useAdminDashboard();

  const t = overview?.today;

  if (loading && !overview) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh(true, true)}
          tintColor={colors.accent}
        />
      }
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.section}>Aujourd’hui</Text>
      <View style={styles.grid}>
        <AdminStat label="Actifs" value={String(t?.activeUsers ?? 0)} styles={styles} />
        <AdminStat label="Inscriptions" value={String(t?.newUsers ?? 0)} styles={styles} />
        <AdminStat label="GMV" value={money(t?.gmvFcfa ?? 0)} styles={styles} />
        <AdminStat label="Transactions" value={String(t?.txCount ?? 0)} styles={styles} />
        <AdminStat label="Recharges" value={money(t?.depositVolumeFcfa ?? 0)} styles={styles} />
        <AdminStat label="Messages" value={String(t?.messages ?? 0)} styles={styles} />
      </View>
      <Text style={styles.section}>Audience</Text>
      <View style={styles.grid}>
        <AdminStat label="Jour" value={String(overview?.actives.dau ?? 0)} styles={styles} />
        <AdminStat label="Semaine" value={String(overview?.actives.wau ?? 0)} styles={styles} />
        <AdminStat label="Mois" value={String(overview?.actives.mau ?? 0)} styles={styles} />
        <AdminStat label="Total users" value={String(overview?.totals.users ?? 0)} styles={styles} />
      </View>
    </ScrollView>
  );
}