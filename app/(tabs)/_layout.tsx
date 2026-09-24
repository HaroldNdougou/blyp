import "@/lib/perf/eagerRoutes";
import { preloadHistoryScreen } from "@/components/history/preloadHistory";
import {
  CashTabIcon,
  ChatTabIcon,
  NineDotKeypadIcon,
  PersonTabIcon,
  SwapTabIcon,
} from "@/components/tabs/TabBarIcons";
import { useAuth } from "@/contexts/authContextBase";
import { useTheme } from "@/contexts/ThemeContext";
import { getTotalUnread, subscribeUnread } from "@/lib/messages/unread";
import { Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { InteractionManager, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const { colors } = useTheme();
  const isPro = user?.activeContext?.type === "commerce";
  const [unreadTick, setUnreadTick] = useState(0);
  const tabUnread = getTotalUnread();

  useEffect(() => subscribeUnread(() => setUnreadTick((n) => n + 1)), []);

  /** Flood modules dès le mount tabs — sans attendre 1 s. */
  useEffect(() => {
    void import("./history");
    void import("./messages");
    void import("@/components/messages/ConversationsScreen");
    void import("@/components/history/HistoryScreen");
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
          tabBarIcon: ({ color }) =>
            isPro ? (
              <CashTabIcon color={color} />
            ) : (
              <NineDotKeypadIcon color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          tabBarIcon: ({ color }) => <SwapTabIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          tabBarButton: token ? undefined : () => null,
          tabBarIcon: ({ color }) => (
            <View>
              <ChatTabIcon color={color} />
              {tabUnread > 0 ? (
                <View
                  style={{
                    position: "absolute",
                    top: -5,
                    right: -8,
                    minWidth: 16,
                    height: 16,
                    borderRadius: 8,
                    paddingHorizontal: 4,
                    backgroundColor: colors.accent,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{
                      color: colors.accentOn,
                      fontSize: 10,
                      fontWeight: "700",
                    }}
                  >
                    {tabUnread > 99 ? "99+" : String(tabUnread)}
                  </Text>
                </View>
              ) : null}
            </View>
          ),
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
