import PayRegisterOverlay from "@/components/pay/PayRegisterOverlay";
import { useMarkRootShellReady } from "@/lib/rootShellReady";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";

/** Connexion type WhatsApp — plein écran, sans clavier Pay. */
export default function WelcomeSignInScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  useMarkRootShellReady();

  const onComplete = useCallback(() => {
    router.replace("/(tabs)/pay");
  }, [router]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <PayRegisterOverlay presentation="fullScreen" onComplete={onComplete} />
    </View>
  );
}
