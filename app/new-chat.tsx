import React, { lazy, Suspense } from "react";
import { View } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";

const NewChatScreen = lazy(
  () => import("@/components/messages/NewChatScreen"),
);

export default function NewChatRoute() {
  const { colors } = useTheme();

  return (
    <Suspense
      fallback={<View style={{ flex: 1, backgroundColor: colors.background }} />}
    >
      <NewChatScreen />
    </Suspense>
  );
}
