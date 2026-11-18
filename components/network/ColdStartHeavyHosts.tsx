import { QuickPayHost } from "@/components/pay/QuickPayHost";
import {
  getPostPayBootPhase,
  isDeferredBackgroundBootReady,
  subscribePostPayBoot,
} from "@/lib/perf/postPayBoot";
import { useEffect, useState } from "react";

/** Quick pay / notif — après 1er paint Pay (phase 2), pas sur le chemin splash. */
export function ColdStartHeavyHosts() {
  const [ready, setReady] = useState(() => isDeferredBackgroundBootReady());

  useEffect(() => {
    if (ready) return;
    return subscribePostPayBoot(() => {
      if (getPostPayBootPhase() >= 2) setReady(true);
    });
  }, [ready]);

  if (!ready) return null;
  return <QuickPayHost />;
}
