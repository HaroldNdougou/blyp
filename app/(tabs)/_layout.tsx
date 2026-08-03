import "@/lib/perf/eagerRoutes";
import { preloadHistoryScreen } from "@/components/history/preloadHistory";
import {
  NineDotKeypadIcon,
  PersonTabIcon,
  SwapTabIcon,
} from "@/components/tabs/TabBarIcons";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Tabs } from "expo-router";
import { useEffect } from "react";
import { InteractionManager } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { colors } = useTheme();

  /** Flood modules dès le mount tabs — sans attendre 1 s. */
  useEffect(() => {
    void import("./history");
    void preloadHistoryScreen();
    void import("@/app/deposit");
    if (token) void import("./profile");
    const task = InteractionManager.runAfterInteractions(() => {
      void import("@expo/vector-icons").then((m) => {
        void m.Ionicons.loadFont().catch(() => {});
      });
    });
    return () => task.cancel();
  }, [token]);

  return (
    <Tabs
      detachInactiveScreens={false}
      sceneContainerStyle={{ backgroundColor: colors.background }}
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        freezeOnBlur: true,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopWidth: 0.5,
          borderTopColor: colors.tabBarBorder,
          height: 52 + (insets.bottom > 0 ? insets.bottom : 8),
          paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
          paddingTop: 8,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ color }) => <NineDotKeypadIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          tabBarIcon: ({ color }) => <SwapTabIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarButton: token ? undefined : () => null,
          tabBarIcon: ({ color }) => <PersonTabIcon color={color} />,
        }}
      />
    </Tabs>
  );
}
