import { ChatThreadShellFallback } from "@/components/messages/ChatThreadShellFallback";
import { createMessagesStyles } from "@/components/messages/messagesStyles";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { getConversationsSnapshot } from "@/lib/messagesCache";
import { perfChatOpenLap } from "@/lib/perf/marks";
import { useLocalSearchParams } from "expo-router";
import React, { lazy, Suspense, useMemo } from "react";

const ChatThreadScreenBody = lazy(() =>
  import("@/components/messages/ChatThreadScreenBody").then((m) => {
    if (__DEV__) perfChatOpenLap("inner_chunk");
    return { default: m.default };
  }),
);

/**
 * Entrée fil légère : shell immédiat (Suspense) + corps chargé en chunk séparé.
 * Pay / voix / attach / emoji restent différés dans le body (`chatThreadDeferredUi`).
 */
export default function ChatThreadScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createMessagesStyles(colors), [colors]);
  const { token } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const conversationId = decodeURIComponent(
    typeof params.id === "string" ? params.id : "",
  );
  const convInit =
    token && conversationId
      ? getConversationsSnapshot(token)?.find((c) => c.id === conversationId)
      : undefined;

  return (
    <Suspense
      fallback={
        <ChatThreadShellFallback
          conversationId={conversationId}
          peerName={convInit?.peerName?.trim() || "…"}
          peerPhone={convInit?.peerPhone ?? null}
          peerAvatarUrl={convInit?.peerAvatarUrl ?? null}
          peerOnBlyp={convInit ? Boolean(convInit.peerUserId) : true}
          colors={colors}
          styles={styles}
        />
      }
    >
      <ChatThreadScreenBody />
    </Suspense>
  );
}
