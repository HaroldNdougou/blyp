import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { createHistoryStyles } from "@/components/history/historyStyles";
import { ApiError } from "@/lib/api/errors";
import { formatFcfa, formatTransactionDate } from "@/lib/format";
import {
  getTransactionsSnapshot,
  setTransactionsSnapshot,
} from "@/lib/transactionsCache";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  ListRenderItem,
  Platform,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

type HistoryRow = {
  id: string;
  name: string;
  amount: string;
  date: string;
  type: "sent" | "received";
};

function rubberBandDelta(dy: number) {
  "worklet";
  return dy * 0.42;
}

function AndroidElasticFlatList({
  data,
  renderItem,
  keyExtractor,
  contentContainerStyle,
  showsVerticalScrollIndicator,
  ListEmptyComponent,
  listFlexStyle,
}: {
  data: HistoryRow[];
  renderItem: ListRenderItem<HistoryRow>;
  keyExtractor: (item: HistoryRow) => string;
  contentContainerStyle: object;
  showsVerticalScrollIndicator: boolean;
  ListEmptyComponent?: React.ComponentType | React.ReactElement | null;
  listFlexStyle: ViewStyle;
}) {
  const scrollY = useSharedValue(0);
  const contentH = useSharedValue(0);
  const layoutH = useSharedValue(0);
  const pullTranslate = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const listAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pullTranslate.value }],
  }));

  const composed = useMemo(() => {
    const pan = Gesture.Pan()
      .activeOffsetY([-14, 14])
      .onUpdate((e) => {
        const maxS = Math.max(0, contentH.value - layoutH.value);
        const y = scrollY.value;
        const ty = e.translationY;

        if (maxS <= 0) {
          pullTranslate.value = rubberBandDelta(ty);
          return;
        }
        if (y <= 0 && ty > 0) {
          pullTranslate.value = rubberBandDelta(ty);
        } else if (y >= maxS - 1 && ty < 0) {
          pullTranslate.value = rubberBandDelta(ty);
        } else {
          pullTranslate.value = 0;
        }
      })
      .onEnd(() => {
        pullTranslate.value = withSpring(0, { damping: 16, stiffness: 240 });
      })
      .onFinalize(() => {
        pullTranslate.value = withSpring(0, { damping: 16, stiffness: 240 });
      });

    return Gesture.Simultaneous(Gesture.Native(), pan);
  }, [pullTranslate, scrollY, contentH, layoutH]);

  return (
    <GestureDetector gesture={composed}>
      <Animated.FlatList
        data={data}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        style={[listAnimatedStyle, listFlexStyle]}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        bounces={false}
        overScrollMode="never"
        onContentSizeChange={(_, h) => {
          contentH.value = h;
        }}
        onLayout={(ev) => {
          layoutH.value = ev.nativeEvent.layout.height;
        }}
        contentContainerStyle={contentContainerStyle}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        ListEmptyComponent={ListEmptyComponent}
      />
    </GestureDetector>
  );
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createHistoryStyles(colors), [colors]);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!token) {
        setRows([]);
        setError(null);
        setLoading(false);
        return;
      }
      let cancelled = false;
      const cached = getTransactionsSnapshot(token);
      if (cached) {
        setRows(
          cached.map((t) => ({
            id: t.id,
            name: t.counterpartyName,
            amount: formatFcfa(t.amountFcfa),
            date: formatTransactionDate(t.createdAt),
            type: t.type,
          })),
        );
        setLoading(false);
        setError(null);
      } else {
        setLoading(true);
        setError(null);
      }

      void (async () => {
        const { listTransactions } = await import("@/lib/api/client");
        if (cancelled) return;
        try {
          const { items } = await listTransactions(token);
          if (cancelled) return;
          setTransactionsSnapshot(token, items);
          setRows(
            items.map((t) => ({
              id: t.id,
              name: t.counterpartyName,
              amount: formatFcfa(t.amountFcfa),
              date: formatTransactionDate(t.createdAt),
              type: t.type,
            })),
          );
          setError(null);
        } catch (e) {
          if (!cancelled) {
            setError(
              e instanceof ApiError ? e.message : t("history.loadFailed"),
            );
            if (!cached) setRows([]);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [token, t]),
  );

  const renderItem: ListRenderItem<HistoryRow> = useCallback(
    ({ item }) => (
      <View style={styles.transactionItem}>
        <View style={styles.leftContent}>
          <View style={styles.avatarSmall}>
            <Text style={styles.avatarText}>
              {(item.name.trim().charAt(0) || "?").toUpperCase()}
            </Text>
          </View>
          <View>
            <Text style={styles.nameText}>{item.name}</Text>
            <Text style={styles.dateText}>{item.date}</Text>
          </View>
        </View>
        <Text
          style={[
            styles.amountText,
            item.type === "received" ? styles.greenText : styles.blackText,
          ]}
        >
          {item.type === "received" ? "+" : "-"}
          {item.amount} F
        </Text>
      </View>
    ),
    [styles],
  );

  const listContentStyle = [
    styles.listContent,
    {
      paddingBottom: insets.bottom + 20,
      flexGrow: 1,
    },
  ];

  const ListEmpty = useMemo(() => {
    if (error) {
      return (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      );
    }
    if (loading) {
      return (
        <View style={styles.emptyWrap}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      );
    }
    if (!token) {
      return (
        <Text style={styles.emptyText}>
          {t("history.signInRequired")}
        </Text>
      );
    }
    return (
      <Text style={styles.emptyText}>{t("history.empty")}</Text>
    );
  }, [error, loading, token, styles, colors.accent, t]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("history.title")}</Text>
      </View>

      {Platform.OS === "android" ? (
        <AndroidElasticFlatList
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={listContentStyle}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={ListEmpty}
          listFlexStyle={styles.listFlex}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          style={styles.listFlex}
          bounces
          alwaysBounceVertical
          contentContainerStyle={listContentStyle}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={ListEmpty}
        />
      )}
    </SafeAreaView>
  );
}

