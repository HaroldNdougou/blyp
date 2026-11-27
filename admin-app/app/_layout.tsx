import { Stack, useRootNavigationState } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { AppLoader } from "../components/AppLoader";
import { ThemeProvider, useTheme } from "../contexts/ThemeContext";
import { ensureAndroidChannels } from "../lib/notifications";

void SplashScreen.hideAsync();
void ensureAndroidChannels();

function RootNavigation() {
  const { colors, statusBarStyle } = useTheme();
  const navState = useRootNavigationState();
  const booting = !navState?.key;

  const bootOverlay = useMemo(
    () =>
      StyleSheet.create({
        overlay: {
          ...StyleSheet.absoluteFillObject,
          zIndex: 999,
          elevation: 999,
          backgroundColor: colors.bg,
        },
      }),
    [colors.bg],
  );

  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <>
      <StatusBar style={statusBarStyle} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "700", color: colors.text },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="recharge" options={{ headerShown: false, presentation: "modal" }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
      {booting ? (
        <View style={bootOverlay.overlay} pointerEvents="auto">
          <AppLoader />
        </View>
      ) : null}
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootNavigation />
    </ThemeProvider>
  );
}