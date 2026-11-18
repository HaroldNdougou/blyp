import { useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAdminDashboard } from "../../contexts/AdminDashboardContext";
import { useTheme } from "../../contexts/ThemeContext";
import { createAdminScreenStyles } from "../../lib/adminScreenStyles";

export default function GoScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createAdminScreenStyles(colors), [colors]);
  const { events, loading, refreshing, error, refresh } = useAdminDashboard();

  const onPullRefresh = () => {
    void refresh(true, true);
  };

  if (loading && events.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onPullRefresh}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={
          <View style={{ paddingTop: insets.top + 8 }}>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Text style={styles.section}>Activité en direct</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View
            style={[
              styles.card,
              item.severity === "money" && ({ borderColor: colors.money } as ViewStyle),
              item.severity === "alert" && ({ borderColor: colors.danger } as ViewStyle),
            ]}
          >
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardSummary}>{item.summary}</Text>
            <Text style={styles.cardMeta}>{new Date(item.at).toLocaleString("fr-FR")}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.muted}>Aucune activité pour l’instant.</Text>}
        contentContainerStyle={[styles.content, { paddingTop: 0 }]}
      />
    </View>
  );
}