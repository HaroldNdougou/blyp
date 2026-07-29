import React, { lazy, Suspense } from "react";
import { View } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";

const HistoryScreen = lazy(
  () => import("@/components/history/HistoryScreen"),
);

export default function HistoryRoute() {
  const { colors } = useTheme();

  return (
    <Suspense fallback={<View style={{ flex: 1, backgroundColor: colors.background }} />}>
      <HistoryScreen />
    </Suspense>
  );
}
