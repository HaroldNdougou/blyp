import "@/lib/i18n";
import "@/lib/ui/scrollDefaults";
import { AuthProvider } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/authContextBase";
import { NetworkProvider } from "@/contexts/NetworkContext";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { ChatRealtimeBootstrap } from "@/components/network/ChatRealtimeBootstrap";
import { NativeShellBadgeBootstrap } from "@/components/network/NativeShellBadgeBootstrap";
import { NativeShellReturnBootstrap } from "@/components/network/NativeShellReturnBootstrap";
import { OfflineBanner } from "@/components/network/OfflineBanner";
import { BlypActionFlashHost } from "@/components/ui/BlypActionFlashHost";
import { BlypAlertHost } from "@/components/ui/BlypAlertHost";
import {
  armNativeShellMessagesHandoff,
  consumeNativeShellLaunch,
  openNativeShellPreview,
} from "@/lib/nativeShell";
import { stackScreenOptions } from "@/lib/perf/instantMotion";
import { getSplashBackground } from "@/lib/theme/splash";
import { router, Stack, useRootNavigationState } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, AppState, useColorScheme, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

/**
 * Version finale : seul l’îlot Messages (liste + fil) reste en RN.
 * Pay / Historique / Profil / connexion = coque native.
 */
SplashScreen.setOptions({ duration: 0, fade: false });
void SplashScreen.preventAutoHideAsync().catch(() => {});

/** Liste ou fil demandé par la coque (`BlypShellLaunchBridge`). */
function IslandLaunch() {
  const { token, isLoading } = useAuth();
  const navReady = Boolean(useRootNavigationState()?.key);

  useEffect(() => {
    if (isLoading || !navReady) return;
    if (!token) {
      void openNativeShellPreview();
      return;
    }
    const run = () => {
      void consumeNativeShellLaunch().then((payload) => {
        if (!payload) return;
        armNativeShellMessagesHandoff();
        if (payload.route === "chat" && payload.conversationId) {
          const tid = payload.transferId?.trim();
          router.replace({
            pathname: "/chat/[id]",
            params: tid
              ? { id: payload.conversationId, transferId: tid }
              : { id: payload.conversationId },
          });
          return;
        }
        if (payload.route === "new-chat") {
          router.replace("/new-chat");
          return;
        }
        router.replace("/");
      });
    };
    run();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    return () => sub.remove();
  }, [isLoading, navReady, token]);

  return null;
}

function SplashHide() {
  const hidden = useRef(false);

  useEffect(() => {
    if (hidden.current) return;
    hidden.current = true;
    void SplashScreen.hideAsync().catch(() => {});
  }, []);

  return null;
}

function IslandShell() {
  const { colors, statusBarStyle } = useTheme();
  const { isLoading } = useAuth();

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background);
  }, [colors.background]);

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style={statusBarStyle} translucent />
      <OfflineBanner />
      <Stack screenOptions={{ headerShown: false, ...stackScreenOptions }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="new-chat" />
        <Stack.Screen name="forward" />
      </Stack>
    </View>
  );
}

export default function MessagesIslandLayout() {
  const systemScheme = useColorScheme();
  const splashBg = useMemo(
    () => getSplashBackground(systemScheme === "dark" ? "dark" : "light"),
    [systemScheme],
  );

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: splashBg }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <NetworkProvider>
            <AuthProvider>
              <NativeShellBadgeBootstrap />
              <NativeShellReturnBootstrap />
              <ChatRealtimeBootstrap />
              <SplashHide />
              <IslandShell />
              <IslandLaunch />
              <BlypAlertHost />
              <BlypActionFlashHost />
            </AuthProvider>
          </NetworkProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
