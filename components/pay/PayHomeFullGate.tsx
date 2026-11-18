import { PayHomeInstantShell } from "@/components/pay/PayHomeInstantShell";
import React, { lazy, Suspense, useEffect, useState } from "react";

const payHomeImport = () => import("@/components/pay/PayHomeScreen");
const PayHomeScreenLazy = lazy(payHomeImport);

/** Coquille immédiate → module Pay complet dès qu’il est en cache. */
export function PayHomeFullGate() {
  const [fullReady, setFullReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      void payHomeImport().then(() => {
        if (cancelled) return;
        requestAnimationFrame(() => setFullReady(true));
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, []);

  if (!fullReady) {
    return <PayHomeInstantShell />;
  }

  return (
    <Suspense fallback={<PayHomeInstantShell />}>
      <PayHomeScreenLazy />
    </Suspense>
  );
}
