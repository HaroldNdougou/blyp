import "@/lib/perf/eagerRoutes";
import { floodAllTabs } from "@/lib/perf/floodAllTabs";
import { AnimatedTabBarButton } from "@/components/tabs/AnimatedTabBarButton";
import { CommentDollarTabIcon } from "@/components/tabs/CommentDollarTabIcon";
import {
  CashTabIcon,
  NineDotKeypadIcon,
  PersonTabIcon,
  SwapTabIcon,
} from "@/components/tabs/TabBarIcons";
import { useAuth } from "@/contexts/authContextBase";
import { useTheme } from "@/contexts/ThemeContext";
import { getTotalUnread, subscribeUnread } from "@/lib/messages/unread";
import {
  getReceiptsUnreadCount,
  hydrateReceiptsUnread,
  subscribeReceiptsUnread,
} from "@/lib/receipts/receiptsUnread";
import { Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { CountBadge } from "@/components/ui/CountBadge";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const { colors } = useTheme();
  const isPro = user?.activeContext?.type === "commerce";
  const [unreadTick, setUnreadTick] = useState(0);
  const [receiptsUnreadTick, setReceiptsUnreadTick] = useState(0);
  const tabUnread = getTotalUnread();
  const accountId = String(user?.id ?? "").trim();
  const receiptsUnread = accountId
    ? getReceiptsUnreadCount(accountId)
    : 0;

  useEffect(() => subscribeUnread(() => setUnreadTick((n) => n + 1)), []);
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
    floodAllTabs(token);
  }, [token]);

  return (
    <Tabs
      initialRouteName="index"
      detachInactiveScreens={false}
      sceneContainerStyle={{ backgroundColor: colors.background }}
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        lazy: false,
        freezeOnBlur: false,
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
          tabBarButton: (props) => (
            <AnimatedTabBarButton {...props} routeName="index" />
          ),
          tabBarIcon: ({ color }) =>
            token ? (
              <View>
                <CommentDollarTabIcon color={color} />
                <CountBadge
                  count={tabUnread}
                  style={{ position: "absolute", top: -5, right: -8 }}
                />
              </View>
            ) : isPro ? (
              <CashTabIcon color={color} />
            ) : (
              <NineDotKeypadIcon color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="pay"
        options={{
          tabBarButton: (props) =>
            token ? (
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
        name="history"
        options={{
          tabBarButton: (props) => (
            <AnimatedTabBarButton {...props} routeName="history" />
          ),
          tabBarIcon: ({ color }) => <SwapTabIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarButton: (props) =>
            token ? (
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
