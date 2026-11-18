import React, { lazy, Suspense } from "react";
import { View } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";

const ForwardMessagesScreen = lazy(
  () => import("@/components/messages/ForwardMessagesScreen"),
);

export default function ForwardRoute() {
  const { colors } = useTheme();

  return (
    <Suspense
      fallback={<View style={{ flex: 1, backgroundColor: colors.background }} />}
    >
      <ForwardMessagesScreen />
    </Suspense>
  );
}
