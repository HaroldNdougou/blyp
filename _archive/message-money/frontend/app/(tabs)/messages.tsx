import React, { lazy, Suspense } from "react";
import { View } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";

const ConversationsScreen = lazy(
  () => import("@/components/messages/ConversationsScreen"),
);

export default function MessagesRoute() {
  const { colors } = useTheme();

  return (
    <Suspense
      fallback={<View style={{ flex: 1, backgroundColor: colors.background }} />}
    >
      <ConversationsScreen />
    </Suspense>
  );
}
