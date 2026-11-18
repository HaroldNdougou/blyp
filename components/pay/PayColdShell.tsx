import { useTheme } from "@/contexts/ThemeContext";
import { notifyNativePayInteractive } from "@/lib/pay/nativeColdStart";
import { useMarkRootShellReady } from "@/lib/rootShellReady";
import { useLayoutEffect } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/** Fallback minimal (caisse lazy) — le perso utilise PayHomeInstantShell. */
export function PayColdShell() {
  const { colors } = useTheme();
  useMarkRootShellReady();
  useLayoutEffect(() => {
    notifyNativePayInteractive();
  }, []);
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
    >
      <View style={{ flex: 1 }} />
    </SafeAreaView>
  );
}
