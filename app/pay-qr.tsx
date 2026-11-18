import { BlypPayQrCard } from "@/components/pay/BlypPayQrCard";
import { useAuth } from "@/contexts/authContextBase";
import { useTheme } from "@/contexts/ThemeContext";
import { resolveBleBroadcastAccount } from "@/lib/ble/broadcastAccount";
import { stackScreenOptions } from "@/lib/perf/instantMotion";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function PayQrScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ amount?: string }>();
  const amountRaw = params.amount ? Math.floor(Number(params.amount)) : NaN;
  const amountFcfa =
    Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : null;

  const broadcast = resolveBleBroadcastAccount(user);
  const accountId = broadcast.accountId ?? "";
  const name =
    user?.activeContext?.type === "commerce"
      ? (user.activeContext.name ?? user.firstName ?? t("commerce.homeEyebrow"))
      : [user?.personalFirstName ?? user?.firstName, user?.personalLastName ?? user?.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() || t("pay.qrShowFallbackName");

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 16,
        paddingHorizontal: 20,
      }}
    >
      <Stack.Screen options={{ ...stackScreenOptions, title: t("pay.qrShowTitle") }} />
      <View style={{ flex: 1, justifyContent: "center" }}>
        {accountId ? (
          <BlypPayQrCard
            accountId={accountId}
            name={name}
            amountFcfa={amountFcfa}
            title={t("pay.qrShowTitle")}
            hint={t("pay.qrShowHint")}
          />
        ) : (
          <Text style={{ color: colors.textMuted, textAlign: "center" }}>
            {t("common.genericError")}
          </Text>
        )}
      </View>
      <Pressable
        onPress={() => router.back()}
        style={{
          alignSelf: "center",
          paddingVertical: 12,
          paddingHorizontal: 28,
        }}
        accessibilityRole="button"
      >
        <Text style={{ color: colors.accent, fontWeight: "700" }}>{t("common.close")}</Text>
      </Pressable>
    </View>
  );
}
