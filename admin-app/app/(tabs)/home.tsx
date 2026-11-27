import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AdminStat } from "../../components/AdminStat";
import { RechargeModal } from "../../components/RechargeModal";
import { useAdminDashboard } from "../../contexts/AdminDashboardContext";
import { useTheme } from "../../contexts/ThemeContext";
import { money } from "../../lib/adminTypes";
import { createAdminScreenStyles } from "../../lib/adminScreenStyles";

export default function HomeTabScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createAdminScreenStyles(colors), [colors]);
  const { overview, loading, refreshing, error, refresh, depositPending, withdrawalPending } = useAdminDashboard();
  const [todayOpen, setTodayOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const t = overview?.today;

  if (loading && !overview) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <>
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
      <Text style={[styles.section, { marginTop: 0, fontSize: 15 }]}>Bienvenue</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actionRow}>
        <View style={{ flex: 1 }}>
          <Pressable
            style={({ pressed }) => [styles.bigBtn, styles.bigBtnPrimary, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel="Recharge"
            onPress={() => setRechargeOpen(true)}
          >
            <Text style={styles.bigBtnTextPrimary}>Recharge</Text>
          </Pressable>
          {depositPending > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{depositPending}</Text>
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1 }}>
          <Pressable
            style={({ pressed }) => [styles.bigBtn, styles.bigBtnSecondary, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel="Retrait"
            onPress={() => setWithdrawOpen(true)}
          >
            <Text style={styles.bigBtnTextSecondary}>Retrait</Text>
          </Pressable>
          {withdrawalPending > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{withdrawalPending}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [styles.sectionHeader, pressed && { opacity: 0.85 }]}
        onPress={() => setTodayOpen((open) => !open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: todayOpen }}
        accessibilityLabel="Aujourd’hui"
      >
        <Text style={styles.sectionHeaderTitle}>Aujourd’hui</Text>
        <Ionicons
          name={todayOpen ? "chevron-up" : "chevron-down"}
          size={20}
          color={colors.muted}
        />
      </Pressable>
      {todayOpen ? (
        <View style={styles.grid}>
          <AdminStat label="Utilisateurs actifs" value={String(t?.activeUsers ?? 0)} styles={styles} />
          <AdminStat label="Nouvelles inscriptions" value={String(t?.newUsers ?? 0)} styles={styles} />
          <AdminStat label="GMV" value={money(t?.gmvFcfa ?? 0)} styles={styles} />
          <AdminStat label="Transactions" value={String(t?.txCount ?? 0)} styles={styles} />
        </View>
      ) : null}

    </ScrollView>
      <RechargeModal
        visible={rechargeOpen}
        mode="deposit"
        onClose={() => setRechargeOpen(false)}
        onBalanceChanged={() => void refresh(true)}
      />
      <RechargeModal
        visible={withdrawOpen}
        mode="withdrawal"
        onClose={() => setWithdrawOpen(false)}
        onBalanceChanged={() => void refresh(true)}
      />
    </>
  );
}