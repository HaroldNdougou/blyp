import { router } from "expo-router";

/** Prefetch module + navigation — appeler après avoir affiché la coquille UI. */
export function openDepositRoute(): void {
  void import("@/app/deposit");
  router.push("/deposit");
}
