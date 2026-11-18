import { Text, View } from "react-native";
import type { AdminScreenStyles } from "../lib/adminScreenStyles";

export function AdminStat({
  label,
  value,
  styles,
}: {
  label: string;
  value: string;
  styles: AdminScreenStyles;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}