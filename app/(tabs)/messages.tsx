import React, { lazy, Suspense } from "react";
import { ActivityIndicator, View } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";

const ConversationsScreen = lazy(
  () => import("@/components/messages/ConversationsScreen"),
);

/** Liste conversations — îlot RN (ouvert depuis coque native ou deep link). */
export default function MessagesRnIslandScreen() {
  const { colors } = useTheme();

  return (
    <Suspense
      fallback={
        <View
          style={{
            flex: 1,
            backgroundColor: colors.background,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      }
    >
      <ConversationsScreen />
    </Suspense>
  );
}
