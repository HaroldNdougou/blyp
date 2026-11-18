import { ChatRealtimeBootstrap } from "@/components/network/ChatRealtimeBootstrap";
import { BleBroadcastBootstrap } from "@/components/network/BleBroadcastBootstrap";
import { PushBootstrap } from "@/components/network/PushBootstrap";
import { QuickPayBootstrap } from "@/components/network/QuickPayBootstrap";
import { InstantPayBootstrap } from "@/components/pay/InstantPayBootstrap";
import { RealtimeSync } from "@/components/network/RealtimeSync";
import { WalletRealtimeBootstrap } from "@/components/network/WalletRealtimeBootstrap";
import {
  getPostPayBootPhase,
  isChatRealtimeBootReady,
  isDeferredBackgroundBootReady,
  subscribePostPayBoot,
} from "@/lib/perf/postPayBoot";
import { useEffect, useState } from "react";

/**
 * Notifs, sync, caisse temps réel — **après** le 1er paint Pay (phase 2).
 * Socket messagerie — phase 3 (prefetch onglets d’abord).
 */
export function DeferredAppBootstraps() {
  const [ready, setReady] = useState(() => isDeferredBackgroundBootReady());
  const [chatReady, setChatReady] = useState(() => isChatRealtimeBootReady());

  useEffect(() => {
    if (ready && chatReady) return;
    return subscribePostPayBoot(() => {
      if (getPostPayBootPhase() >= 2) setReady(true);
      if (getPostPayBootPhase() >= 3) setChatReady(true);
    });
  }, [ready, chatReady]);

  if (!ready) return null;

  return (
    <>
      <RealtimeSync />
      <WalletRealtimeBootstrap />
      <PushBootstrap />
      <BleBroadcastBootstrap />
      <QuickPayBootstrap />
      <InstantPayBootstrap />
      {chatReady ? <ChatRealtimeBootstrap /> : null}
    </>
  );
}
