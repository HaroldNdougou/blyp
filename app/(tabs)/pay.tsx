import { PayColdShell } from "@/components/pay/PayColdShell";
import { useAuth } from "@/contexts/authContextBase";
import { Redirect } from "expo-router";
import React, { lazy, Suspense } from "react";

const PayHomeScreen = lazy(() => import("@/components/pay/PayHomeScreen"));
const CommerceHomeScreen = lazy(() =>
  import("@/components/pay/CommerceHomeScreen").then((m) => ({
    default: m.CommerceHomeScreen,
  })),
);

/** Onglet Pay (perso) ou encaissement (mode commerce). */
export default function PayTabScreen() {
  const { user, token } = useAuth();
  if (!token || user?.needsOnboarding) {
    return <Redirect href="/(tabs)/welcome" />;
  }
  if (user?.activeContext?.type === "commerce") {
    return (
      <Suspense fallback={<PayColdShell />}>
        <CommerceHomeScreen />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<PayColdShell />}>
      <PayHomeScreen />
    </Suspense>
  );
}
