import { IncomingPaymentFlashSheet } from "@/components/pay/IncomingPaymentFlashSheet";
import { createSoaCarHomeStyles } from "@/components/soa/soaCarHomeStyles";
import { useAuth } from "@/contexts/authContextBase";
import { useTheme } from "@/contexts/ThemeContext";
import { useTaxiBroadcast } from "@/hooks/useTaxiBroadcast";
import { resolveBleBroadcastAccount } from "@/lib/ble/broadcastAccount";
import { formatFcfa } from "@/lib/formatFcfa";
import type { IncomingPaymentFlash } from "@/lib/pay/incomingFlash";
import { subscribeIncomingPaymentFlash } from "@/lib/pay/incomingFlash";
import { SoaSeatMap } from "@/components/soa/SoaSeatMap";
import { SoaSeatPaymentDetailSheet } from "@/components/soa/SoaSeatPaymentDetailSheet";
import {
  buildSoaSeatAggregateMap,
  type SoaSeatAggregate,
} from "@/lib/soa/seatAggregates";
import type { SoaCarTrip } from "@/lib/soa/soaCar";
import {
  fetchSoaTripForCommerce,
  resetSoaTripForCommerce,
} from "@/lib/soa/soaTripClient";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

const POLL_MS = 4000;
/** Aligné sur `onlineSwitchWrap` (hauteur du switch). */
const SOA_ONLINE_ROW_HEIGHT = 44;
/** Espace sous Hors ligne, avant « Total de la course ». */
const SOA_GAP_BELOW_ONLINE_ROW = 10;

type Props = {
  commerceId: string;
  commerceName: string;
};

export function SoaCarCommerceHome({ commerceId, commerceName }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createSoaCarHomeStyles(colors), [colors]);
  const { user, token } = useAuth();
  const bleBroadcastAccount = useMemo(
    () => resolveBleBroadcastAccount(user),
    [user],
  );
  const broadcast = useTaxiBroadcast(bleBroadcastAccount);
  const [trip, setTrip] = useState<SoaCarTrip | null>(null);
  const [resetting, setResetting] = useState(false);
  const [receivedFlash, setReceivedFlash] =
    useState<IncomingPaymentFlash | null>(null);
  const [seatPaymentDetail, setSeatPaymentDetail] =
    useState<SoaSeatAggregate | null>(null);
  const focusedRef = useRef(false);
  const commerceIdRef = useRef(commerceId);
  commerceIdRef.current = commerceId;

  const seatAggregateMap = useMemo(
    () => buildSoaSeatAggregateMap(trip?.seats ?? []),
    [trip?.seats],
  );

  const seatAggregate = useCallback(
    (n: number) => seatAggregateMap.get(n),
    [seatAggregateMap],
  );

  const refreshTrip = useCallback(async () => {
    if (!token) return;
    try {
      const next = await fetchSoaTripForCommerce(token, commerceId);
      setTrip((prev) => {
        const prevLen = prev?.seats?.length ?? 0;
        const nextLen = next.seats?.length ?? 0;
        if (prev && prev.totalFcfa === next.totalFcfa && prevLen === nextLen) {
          return prev;
        }
        return next;
      });
    } catch {
      /* cache inchangé */
    }
  }, [token, commerceId]);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      void refreshTrip();
      const id = setInterval(() => {
        if (focusedRef.current) void refreshTrip();
      }, POLL_MS);
      return () => {
        focusedRef.current = false;
        clearInterval(id);
      };
    }, [refreshTrip]),
  );

  useEffect(() => {
    return subscribeIncomingPaymentFlash((event) => {
      if (!focusedRef.current) return;
      if (event.contextType !== "commerce") return;
      if (event.commerceId && event.commerceId !== commerceIdRef.current) {
        return;
      }
      setReceivedFlash(event);
      void refreshTrip();
    });
  }, [refreshTrip]);

  const onBroadcastToggle = useCallback(
    async (enabled: boolean) => {
      const { status, message } = await broadcast.setEnabled(enabled);
      if (!enabled || status === "broadcasting") return;
      const msg =
        status === "denied"
          ? t("profile.broadcastDenied")
          : status === "unavailable"
            ? t("profile.broadcastUnavailable")
            : message && __DEV__
              ? `${t("profile.broadcastError")}\n${message}`
              : t("profile.broadcastError");
      Alert.alert(t("commerce.onlineLabel"), msg);
    },
    [broadcast.setEnabled, t],
  );

  const onNewTrip = useCallback(() => {
    if (!token || resetting) return;
    Alert.alert(t("soaCar.newTripTitle"), t("soaCar.newTripMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("soaCar.newTripConfirm"),
        style: "destructive",
        onPress: () => {
          setResetting(true);
          void resetSoaTripForCommerce(token, commerceId)
            .then((next) => setTrip(next))
            .catch(() => {
              Alert.alert(t("common.genericError"), t("soaCar.newTripFailed"));
            })
            .finally(() => setResetting(false));
        },
      },
    ]);
  }, [token, commerceId, resetting, t]);

  return (
    <View style={[styles.safe, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.topBar,
          { paddingTop: insets.top },
        ]}
        pointerEvents="box-none"
      >
        <Pressable
          style={styles.onlineRow}
          onPress={() => {
            if (broadcast.busy) return;
            void onBroadcastToggle(!broadcast.on);
          }}
          disabled={broadcast.busy}
          accessibilityRole="switch"
          accessibilityState={{ checked: broadcast.on, disabled: broadcast.busy }}
          accessibilityLabel={t("commerce.onlineLabel")}
          hitSlop={{ top: 8, bottom: 8, left: 12, right: 8 }}
        >
          <Text
            style={[styles.onlineLabel, broadcast.on && styles.onlineLabelOn]}
          >
            {broadcast.on ? t("commerce.onlineOn") : t("commerce.onlineOff")}
          </Text>
          {broadcast.busy ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <View style={styles.onlineSwitchWrap} pointerEvents="none">
              <Switch
                value={broadcast.on}
                trackColor={{
                  false: colors.switchTrackOff,
                  true: colors.switchTrackOn,
                }}
                thumbColor={
                  broadcast.on ? colors.switchThumbOn : colors.switchThumbOff
                }
                ios_backgroundColor={colors.switchTrackOff}
              />
            </View>
          )}
        </Pressable>
      </View>

      <SafeAreaView style={styles.bodySafe} edges={["left", "right", "bottom"]}>
        <View
          style={[
            styles.body,
            {
              paddingTop:
                insets.top +
                SOA_ONLINE_ROW_HEIGHT +
                SOA_GAP_BELOW_ONLINE_ROW,
            },
          ]}
        >
          <View style={styles.tripTotalBlock}>
            <Text style={styles.tripTotalLabel}>
              {t("soaCar.tripTotalLabel")}
            </Text>
            <View style={styles.tripTotalAmountRow}>
              <Text style={styles.tripTotalValue}>
                {formatFcfa(trip?.totalFcfa ?? 0)}
              </Text>
              <Text style={styles.tripTotalCurrency}>{t("common.fcfa")}</Text>
            </View>
          </View>

          <Text style={styles.driverHint}>{t("soaCar.seatMapHint")}</Text>
          <SoaSeatMap
            mode="driver"
            styles={styles}
            seatAggregate={seatAggregate}
            onSeatWithMultiplePayments={setSeatPaymentDetail}
          />

          <View style={styles.seatMapFooterSpacer} />

          <View style={styles.footer}>
            <Pressable
              style={styles.resetBtn}
              onPress={onNewTrip}
              disabled={resetting}
              accessibilityRole="button"
            >
              {resetting ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <Text style={styles.resetBtnText}>
                  {t("soaCar.newTripCta")}
                </Text>
              )}
            </Pressable>
            <Text style={styles.metaLine} numberOfLines={1}>
              {t("commerce.homeEyebrow")}
              {" · "}
              {commerceName}
            </Text>
          </View>
        </View>
      </SafeAreaView>

      {receivedFlash ? (
        <IncomingPaymentFlashSheet
          amountFcfa={receivedFlash.amountFcfa}
          onDismiss={() => setReceivedFlash(null)}
        />
      ) : null}

      <SoaSeatPaymentDetailSheet
        visible={seatPaymentDetail != null}
        aggregate={seatPaymentDetail}
        onDismiss={() => setSeatPaymentDetail(null)}
      />
    </View>
  );
}
