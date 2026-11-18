import { router } from "expo-router";

/** Fil sans écran RN derrière : retour coque native, sinon racine. */
export function leaveThreadWithoutBackStack(): void {
  void import("@/lib/nativeShell")
    .then((m) => m.leaveMessagesToNativeShell())
    .then((ok) => {
      if (!ok) router.replace("/");
    });
}
