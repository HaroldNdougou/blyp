import { useTheme } from "@/contexts/ThemeContext";
import { useMarkRootShellReady } from "@/lib/rootShellReady";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/** Masque le splash dès le 1er frame Pay (le vrai écran charge en lazy). */
export function PayColdShell() {
  const { colors } = useTheme();
  useMarkRootShellReady();
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
    >
      <View style={{ flex: 1 }} />
    </SafeAreaView>
  );
}
