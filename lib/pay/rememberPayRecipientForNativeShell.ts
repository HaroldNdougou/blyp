import type { ApiUser } from "@/lib/api/types";
import type { QuickPayRecipient } from "@/lib/pay/quickPayRecipient";
import { Platform } from "react-native";

/** Mémorise le destinataire pour la coque native + quick pay. */
export async function rememberPayRecipientForNativeShell(
  to: QuickPayRecipient,
  user: ApiUser | null | undefined,
): Promise<void> {
  const { rememberQuickPayRecipient } = await import("@/lib/pay/quickPayRecipient");
  await rememberQuickPayRecipient(to);
  if (Platform.OS !== "android") return;
  void import("@/lib/auth/authSession").then(({ getUserSnapshot }) => {
    void import("@/lib/pay/syncShellPayRuntime").then((m) =>
      m.syncShellPayRuntime(user ?? getUserSnapshot()),
    );
  });
}
