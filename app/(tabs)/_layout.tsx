import "@/lib/perf/eagerRoutes";
import { floodAllTabs } from "@/lib/perf/floodAllTabs";
import { AnimatedTabBarButton } from "@/components/tabs/AnimatedTabBarButton";
import {
  CashTabIcon,
  NineDotKeypadIcon,
  PersonTabIcon,
  SwapTabIcon,
} from "@/components/tabs/TabBarIcons";
import { useAuth } from "@/contexts/authContextBase";
import { useTheme } from "@/contexts/ThemeContext";
import {
  getReceiptsUnreadCount,
  hydrateReceiptsUnread,
  subscribeReceiptsUnread,
} from "@/lib/receipts/receiptsUnread";
import { Tabs, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { CountBadge } from "@/components/ui/CountBadge";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Connecté → Pay ; déconnecté → welcome (pas de tab bar). */
export const unstable_settings = {
  initialRouteName: "pay",
};

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, user, isLoading } = useAuth();
  const { colors } = useTheme();
  const signedIn = Boolean(token);
  const isPro = user?.activeContext?.type === "commerce";
  const [receiptsUnreadTick, setReceiptsUnreadTick] = useState(0);
  const accountId = String(user?.id ?? "").trim();
  const receiptsUnread = accountId
    ? getReceiptsUnreadCount(accountId)
    : 0;

  useEffect(
    () => subscribeReceiptsUnread(() => setReceiptsUnreadTick((n) => n + 1)),
    [],
  );
  useEffect(() => {
    if (!accountId) return;
    void hydrateReceiptsUnread(accountId).then(() =>
      setReceiptsUnreadTick((n) => n + 1),
    );
  }, [accountId]);

  useEffect(() => {
    if (isLoading) return;
    if (!signedIn) {
      router.replace("/(tabs)/welcome");
      return;
    }
    if (user?.needsOnboarding) {
      router.replace("/(tabs)/welcome");
    }
  }, [isLoading, signedIn, user?.needsOnboarding, router]);

  useEffect(() => {
    if (__DEV__) return;
    floodAllTabs(token);
  }, [token]);

  const tabBarHeight = 52 + (insets.bottom > 0 ? insets.bottom : 8);

  return (
    <Tabs
      initialRouteName={
        !signedIn || user?.needsOnboarding ? "welcome" : "pay"
      }
      detachInactiveScreens={false}
      sceneContainerStyle={{ backgroundColor: colors.background }}
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        lazy: __DEV__,
        freezeOnBlur: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle:
          signedIn && !user?.needsOnboarding
            ? {
              backgroundColor: colors.tabBar,
              borderTopWidth: 1,
              borderTopColor: colors.tabBarBorder,
              height: tabBarHeight,
              paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
              paddingTop: 8,
            }
            : { display: "none", height: 0 },
        tabBarItemStyle: signedIn ? { flex: 1 } : undefined,
      }}
    >
      <Tabs.Screen
        name="welcome"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="pay"
        options={{
          tabBarButton: (props) =>
            signedIn ? (
              <AnimatedTabBarButton {...props} routeName="pay" />
            ) : null,
          tabBarIcon: ({ color }) =>
            isPro ? (
              <CashTabIcon color={color} />
            ) : (
              <NineDotKeypadIcon color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          tabBarButton: (props) =>
            signedIn ? (
              <AnimatedTabBarButton {...props} routeName="history" />
            ) : null,
          tabBarIcon: ({ color }) => <SwapTabIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarButton: (props) =>
            signedIn ? (
              <AnimatedTabBarButton {...props} routeName="profile" />
            ) : null,
          tabBarIcon: ({ color }) => (
            <View>
              <PersonTabIcon color={color} />
              <CountBadge
                count={receiptsUnread}
                style={{ position: "absolute", top: -5, right: -8 }}
              />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}
