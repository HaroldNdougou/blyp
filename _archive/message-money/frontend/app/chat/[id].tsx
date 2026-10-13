import React, { lazy, Suspense } from "react";
import { View } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";

const ChatThreadScreen = lazy(
  () => import("@/components/messages/ChatThreadScreen"),
);

export default function ChatRoute() {
  const { colors } = useTheme();

  return (
    <Suspense
      fallback={<View style={{ flex: 1, backgroundColor: colors.background }} />}
    >
      <ChatThreadScreen />
    </Suspense>
  );
}
