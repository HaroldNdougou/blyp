import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { RootShellReadyProvider } from "@/lib/rootShellReady";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

SplashScreen.setOptions({ duration: 0, fade: false });
void SplashScreen.preventAutoHideAsync();

/**
 * 1) Pas de navigation tant que SecureStore n’a pas fini.
 * 2) **Release** : splash jusqu’au 1er layout accueil + 2 frames (évite flash blanc).
 * 3) **Dev** : on **n’attend pas** PayHome — Metro peut mettre 30 s à bundler ce chunk ; attendre
 *    `useMarkRootShellReady` = splash bloqué tout ce temps. Ici dès `!isLoading` + 2 rAF.
 * 4) Repli ~700 ms (release) si pas d’accueil (deep link).
 */
function SplashGate({ children }: { children: ReactNode }) {
  const { isLoading } = useAuth();
  const splashHiddenRef = useRef(false);
  const [shellReady, setShellReady] = useState(false);
  const onShellReady = useCallback(() => {
    setShellReady(true);
  }, []);

  /** En prod uniquement : attendre le signal accueil (ou timeout). */
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
        void SplashScreen.hideAsync();
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

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <SplashGate>
            <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
              <StatusBar style="dark" translucent />
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen
                  name="register"
                  options={{
                    presentation: "modal",
                    animation: "slide_from_bottom",
                  }}
                />
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
          </SplashGate>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
