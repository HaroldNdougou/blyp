import PayRegisterOverlay from "@/components/pay/PayRegisterOverlay";
import { useMarkRootShellReady } from "@/lib/rootShellReady";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Platform, View } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";

const nativeShellLauncher =
  process.env.EXPO_PUBLIC_NATIVE_SHELL !== "0" &&
  process.env.EXPO_PUBLIC_NATIVE_SHELL !== "false";

/** Connexion type WhatsApp — plein écran, sans clavier Pay. */
export default function WelcomeSignInScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  useMarkRootShellReady();

  const onComplete = useCallback(() => {
    if (Platform.OS === "android" && nativeShellLauncher) {
      void import("@/lib/nativeShell").then(({ returnToNativeShellAfterWelcome }) => {
        void returnToNativeShellAfterWelcome();
      });
      return;
    }
    router.replace("/(tabs)/pay");
  }, [router]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <PayRegisterOverlay presentation="fullScreen" onComplete={onComplete} />
    </View>
  );
}
