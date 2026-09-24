import "@/lib/i18n";
import "@/lib/ui/scrollDefaults";
import { AuthProvider } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/authContextBase";
import { NetworkProvider } from "@/contexts/NetworkContext";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { BleBroadcastBootstrap } from "@/components/network/BleBroadcastBootstrap";
import { OfflineBanner } from "@/components/network/OfflineBanner";
import { PushBootstrap } from "@/components/network/PushBootstrap";
import { RealtimeSync } from "@/components/network/RealtimeSync";
import { RootShellReadyProvider } from "@/lib/rootShellReady";
import { getSplashBackground } from "@/lib/theme/splash";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useColorScheme, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

/** Pas de fade : priorité vitesse perçue (style WhatsApp). */
SplashScreen.setOptions({ duration: 0, fade: false });
void SplashScreen.preventAutoHideAsync().catch(() => {
  /* reload / splash déjà masqué — pas d’uncaught promise */
});

/**
 * 1) Pas de navigation tant que SecureStore n’a pas fini.
 * 2) **Release** : splash jusqu’au 1er layout accueil + 2 frames (évite flash).
 * 3) **Dev** : dès `!isLoading` + 2 rAF (ne pas attendre Pay / Metro).
 * 4) Repli ~700 ms (release) si pas d’accueil (deep link).
 * Sacré : ne jamais bloquer le hide sur polices, icônes, réseaux, lazy chunks.
 */
function SplashGate({ children }: { children: ReactNode }) {
  const { isLoading } = useAuth();
  const splashHiddenRef = useRef(false);
  const [shellReady, setShellReady] = useState(false);
  const onShellReady = useCallback(() => {
    setShellReady(true);
  }, []);

  const splashUnlockReady = __DEV__ || shellReady;

  useEffect(() => {
    if (isLoading) setShellReady(false);
  }, [isLoading]);

  useEffect(() => {
    if (isLoading || __DEV__) return;
    const t = setTimeout(() => {
      setShellReady((prev) => prev || true);
    }, 700);
    return () => clearTimeout(t);
  }, [isLoading]);

  useEffect(() => {
    if (isLoading || !splashUnlockReady || splashHiddenRef.current) return;
    let cancelled = false;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        if (cancelled || splashHiddenRef.current) return;
        splashHiddenRef.current = true;
        void SplashScreen.hideAsync().catch(() => {
          /* fréquent au hot reload */
        });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [isLoading, splashUnlockReady]);

  if (isLoading) {
    return null;
  }

  return (
    <RootShellReadyProvider onReady={onShellReady}>
      {children}
    </RootShellReadyProvider>
  );
}

function RootShell() {
  const { colors, statusBarStyle } = useTheme();

  /** Après hide : fond fenêtre = app (pas le vert splash). Non bloquant. */
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background);
  }, [colors.background]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style={statusBarStyle} translucent />
      <OfflineBanner />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="register"
          options={{
            presentation: "modal",
            animation: "slide_from_bottom",
          }}
        />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen
          name="deposit"
          options={{
            presentation: "transparentModal",
            animation: "none",
            contentStyle: { backgroundColor: "transparent" },
          }}
        />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  const systemScheme = useColorScheme();
  const splashBg = useMemo(
    () => getSplashBackground(systemScheme === "dark" ? "dark" : "light"),
    [systemScheme],
  );

  /** Pendant hydratation auth : même teinte que le splash natif (pas de flash blanc). */
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(splashBg);
  }, [splashBg]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: splashBg }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <NetworkProvider>
            <AuthProvider>
              <RealtimeSync />
              <PushBootstrap />
              <BleBroadcastBootstrap />
              <SplashGate>
                <RootShell />
              </SplashGate>
            </AuthProvider>
          </NetworkProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
