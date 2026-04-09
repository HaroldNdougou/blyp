import React, { lazy, Suspense } from "react";
import { StyleSheet, View } from "react-native";

const HistoryScreen = lazy(
  () => import("@/components/history/HistoryScreen"),
);

export default function HistoryRoute() {
  return (
    <Suspense fallback={<View style={styles.fallback} />}>
      <HistoryScreen />
    </Suspense>
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
});
