import { useAuth } from "@/contexts/AuthContext";
import { ApiError, listTransactions } from "@/lib/api/client";
import { formatFcfa, formatTransactionDate } from "@/lib/format";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  ListRenderItem,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
}: {
  data: HistoryRow[];
  renderItem: ListRenderItem<HistoryRow>;
  keyExtractor: (item: HistoryRow) => string;
  contentContainerStyle: object;
  showsVerticalScrollIndicator: boolean;
  ListEmptyComponent?: React.ComponentType | React.ReactElement | null;
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
        style={[listAnimatedStyle, styles.listFlex]}
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

const HistoryScreen = () => {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
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
      setLoading(true);
      setError(null);
      listTransactions(token)
        .then(({ items }) => {
          if (cancelled) return;
          setRows(
            items.map((t) => ({
              id: t.id,
              name: t.counterpartyName,
              amount: formatFcfa(t.amountFcfa),
              date: formatTransactionDate(t.createdAt),
              type: t.type,
            })),
          );
        })
        .catch((e) => {
          if (!cancelled) {
            setError(
              e instanceof ApiError ? e.message : "Chargement impossible.",
            );
            setRows([]);
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [token]),
  );

  const renderItem: ListRenderItem<HistoryRow> = ({ item }) => (
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
          <ActivityIndicator color="#5dc705" size="large" />
        </View>
      );
    }
    if (!token) {
      return (
        <Text style={styles.emptyText}>
          Connectez-vous pour voir vos transactions.
        </Text>
      );
    }
    return (
      <Text style={styles.emptyText}>Aucune transaction pour l’instant.</Text>
    );
  }, [error, loading, token]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Transactions</Text>
      </View>

      {Platform.OS === "android" ? (
        <AndroidElasticFlatList
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={listContentStyle}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={ListEmpty}
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
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  header: {
    paddingHorizontal: 25,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#000",
  },
  listFlex: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  emptyWrap: {
    paddingTop: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    marginTop: 32,
    textAlign: "center",
    paddingHorizontal: 24,
    fontSize: 15,
    color: "#999",
    lineHeight: 22,
  },
  transactionItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#F9F9F9",
  },
  leftContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatarSmall: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    backgroundColor: "#F0F4F2",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 15,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#4CAF50",
  },
  nameText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  dateText: {
    fontSize: 12,
    color: "#999",
    marginTop: 2,
  },
  amountText: {
    fontSize: 16,
    fontWeight: "700",
  },
  greenText: { color: "#4CAF50" },
  blackText: { color: "#000" },
});

export default HistoryScreen;
