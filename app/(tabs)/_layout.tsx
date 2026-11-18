import "@/lib/perf/eagerRoutes";
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
import {
  armNativeShellDepositHandoff,
  armNativeShellDocumentsHandoff,
  armNativeShellKycHandoff,
  armNativeShellMessagesHandoff,
  armNativeShellPayHandoff,
  armNativeShellProfileHandoff,
  armNativeShellReceiptsHandoff,
  consumeNativeShellLaunch,
  isNativeShellRouteScreenHandoff,
  isRnIslandHideTabBar,
  returnToNativeShellAfterMessages,
  returnToNativeShellAfterPay,
  returnToNativeShellFromRouteScreen,
  isNativeShellPayHandoff,
  isNativeShellProfileHandoff,
  subscribeNativeShellHandoff,
  returnToNativeShellAfterProfile,
} from "@/lib/nativeShell";
import {
  queuePayAmountFromShell,
  setShellPayDigits,
} from "@/lib/pay/payHomeHandoff";
import {
  schedulePostPayBootFallback,
  isDeferredBackgroundBootReady,
  subscribePostPayBoot,
  getPostPayBootPhase,
  markPayTabFirstPaint,
} from "@/lib/perf/postPayBoot";
import { Tabs, useRouter, useSegments } from "expo-router";
import { useEffect, useState, useCallback } from "react";
import { BackHandler, InteractionManager, AppState } from "react-native";
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
  const segments = useSegments();
  const { token, user, isLoading, signOut } = useAuth();
  const { colors } = useTheme();
  const signedIn = Boolean(token);
  const isPro = user?.activeContext?.type === "commerce";
  const [receiptsUnreadTick, setReceiptsUnreadTick] = useState(0);
  const [hideTabBarForIsland, setHideTabBarForIsland] = useState(() =>
    isRnIslandHideTabBar(),
  );
  const [shellHandoffTick, setShellHandoffTick] = useState(0);
  const accountId = String(user?.id ?? "").trim();
  const receiptsUnread = accountId
    ? getReceiptsUnreadCount(accountId)
    : 0;

  useEffect(
    () => subscribeReceiptsUnread(() => setReceiptsUnreadTick((n) => n + 1)),
    [],
  );
  useEffect(
    () => subscribeNativeShellHandoff(() => setShellHandoffTick((n) => n + 1)),
    [],
  );
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      void hydrateReceiptsUnread(accountId).then(() => {
        if (!cancelled) setReceiptsUnreadTick((n) => n + 1);
      });
    };
    if (isDeferredBackgroundBootReady()) {
      InteractionManager.runAfterInteractions(run);
      return () => {
        cancelled = true;
      };
    }
    const unsub = subscribePostPayBoot(() => {
      if (getPostPayBootPhase() >= 2) {
        InteractionManager.runAfterInteractions(run);
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [accountId]);

  useEffect(() => {
    if (isLoading || !signedIn) return;
    return schedulePostPayBootFallback({
      token,
      phone: user?.phone ?? null,
    });
  }, [isLoading, signedIn, token, user?.phone]);

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

  const applyNativeShellLaunch = useCallback(
    (payload: NonNullable<Awaited<ReturnType<typeof consumeNativeShellLaunch>>>) => {
      if (payload.route === "pay") {
        if (payload.returnToShell) armNativeShellPayHandoff();
        setHideTabBarForIsland(false);
      } else if (payload.hideTabBar) {
        setHideTabBarForIsland(true);
      }
      if (payload.route === "messages" || payload.route === "pay") {
        markPayTabFirstPaint({
          token,
          phone: user?.phone ?? null,
        });
      }
      if (payload.payDigits) setShellPayDigits(payload.payDigits);
      if (payload.pendingPayFcfa && payload.pendingPayFcfa > 0) {
        queuePayAmountFromShell(payload.pendingPayFcfa);
      }
      if (payload.route === "messages") {
        armNativeShellMessagesHandoff();
        router.replace("/(tabs)/messages");
        return;
      }
      if (payload.route === "chat" && payload.conversationId) {
        armNativeShellMessagesHandoff();
        setHideTabBarForIsland(true);
        const tid = payload.transferId?.trim();
        if (tid) {
          router.replace({
            pathname: "/chat/[id]",
            params: { id: payload.conversationId, transferId: tid },
          });
        } else {
          router.replace({
            pathname: "/chat/[id]",
            params: { id: payload.conversationId },
          });
        }
        return;
      }
      if (payload.route === "pay") {
        router.replace("/(tabs)/pay");
        return;
      }
      if (payload.route === "deposit") {
        setHideTabBarForIsland(false);
        armNativeShellDepositHandoff();
        router.push("/deposit");
        return;
      }
      if (payload.route === "receipts") {
        setHideTabBarForIsland(false);
        armNativeShellReceiptsHandoff();
        router.push("/receipts");
        return;
      }
      if (payload.route === "documents") {
        setHideTabBarForIsland(false);
        armNativeShellDocumentsHandoff();
        router.push("/documents");
        return;
      }
      if (payload.route === "kyc") {
        setHideTabBarForIsland(false);
        armNativeShellKycHandoff();
        router.push("/kyc");
        return;
      }
      if (payload.route === "profile") {
        setHideTabBarForIsland(true);
        armNativeShellProfileHandoff();
        router.replace("/(tabs)/profile");
        return;
      }
      if (payload.route === "sign_out") {
        setHideTabBarForIsland(false);
        void signOut().then(() => router.replace("/(tabs)/welcome"));
        return;
      }
      if (payload.route === "welcome") {
        setHideTabBarForIsland(false);
        router.replace("/(tabs)/welcome");
      }
    },
    [router, signOut, token, user?.phone],
  );

  useEffect(() => {
    if (isLoading || !signedIn) return;
    const run = () => {
      void consumeNativeShellLaunch().then((payload) => {
        if (payload) applyNativeShellLaunch(payload);
      });
    };
    run();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    return () => sub.remove();
  }, [isLoading, signedIn, applyNativeShellLaunch]);

  const onRouteScreenHandoff =
    isNativeShellRouteScreenHandoff() &&
    (segments[0] === "receipts" ||
      segments[0] === "documents" ||
      segments[0] === "deposit" ||
      segments[0] === "kyc");

  useEffect(() => {
    if (!onRouteScreenHandoff) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      void returnToNativeShellFromRouteScreen();
      return true;
    });
    return () => sub.remove();
  }, [onRouteScreenHandoff, shellHandoffTick]);

  const onMessagesIslandRoot =
    hideTabBarForIsland &&
    segments[0] === "(tabs)" &&
    segments[1] === "messages" &&
    !segments.some((s) => s === "chat" || s === "new-chat" || s === "forward");

  const onPayShellHandoff =
    isNativeShellPayHandoff() &&
    segments[0] === "(tabs)" &&
    segments[1] === "pay";

  const onProfileShellHandoff =
    isNativeShellProfileHandoff() &&
    segments[0] === "(tabs)" &&
    segments[1] === "profile";

  useEffect(() => {
    if (!onMessagesIslandRoot) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      void returnToNativeShellAfterMessages();
      return true;
    });
    return () => sub.remove();
  }, [onMessagesIslandRoot]);

  useEffect(() => {
    if (!onPayShellHandoff) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      void returnToNativeShellAfterPay();
      return true;
    });
    return () => sub.remove();
  }, [onPayShellHandoff, shellHandoffTick]);

  useEffect(() => {
    if (!onProfileShellHandoff) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      void returnToNativeShellAfterProfile();
      return true;
    });
    return () => sub.remove();
  }, [onProfileShellHandoff, shellHandoffTick]);
  const tabBarHeight = 52 + (insets.bottom > 0 ? insets.bottom : 8);
  const showTabBar =
    signedIn && !user?.needsOnboarding && !hideTabBarForIsland;

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
        lazy: true,
        freezeOnBlur: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: showTabBar
            ? {
              backgroundColor: colors.tabBar,
              borderTopWidth: 1,
              borderTopColor: colors.tabBarBorder,
              height: tabBarHeight,
              paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
              paddingTop: 8,
            }
            : { display: "none", height: 0 },
        tabBarItemStyle: showTabBar ? { flex: 1 } : undefined,
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
        name="messages"
        options={{
          href: null,
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
