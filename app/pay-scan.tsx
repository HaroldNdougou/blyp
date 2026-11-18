import { useTheme } from "@/contexts/ThemeContext";
import { blypPayQrToRecipient, parseBlypPayQr } from "@/lib/pay/blypPayQr";
import { setPendingPayQr } from "@/lib/pay/payQrHandoff";
import { stackScreenOptions } from "@/lib/perf/instantMotion";
import { blypAlert } from "@/lib/ui/blypAlert";
import { router, Stack } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type CameraModule = typeof import("expo-camera");

function PayScanCamera(props: {
  camera: CameraModule;
  insets: { top: number; bottom: number };
  colors: ReturnType<typeof useTheme>["colors"];
  t: ReturnType<typeof import("react-i18next").useTranslation>["t"];
}) {
  const { camera, insets, colors, t } = props;
  const { CameraView, useCameraPermissions } = camera;
  const [permission, requestPermission] = useCameraPermissions();
  const handledRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const onBarcode = useCallback(
    (data: string) => {
      if (handledRef.current || busy) return;
      const payload = parseBlypPayQr(data);
      if (!payload) return;
      handledRef.current = true;
      setBusy(true);
      setPendingPayQr(payload);
      router.back();
    },
    [busy],
  );

  if (!permission) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View
        style={{
          flex: 1,
          padding: 24,
          paddingTop: insets.top + 24,
          backgroundColor: colors.background,
          gap: 16,
        }}
      >
        <Stack.Screen options={{ ...stackScreenOptions, title: t("pay.qrScanTitle") }} />
        <Text style={{ color: colors.text, fontSize: 16 }}>{t("pay.qrScanPermission")}</Text>
        <Pressable
          onPress={() => void requestPermission()}
          style={{
            backgroundColor: colors.accent,
            paddingVertical: 14,
            borderRadius: 12,
            alignItems: "center",
          }}
        >
          <Text style={{ color: colors.accentOn, fontWeight: "700" }}>
            {t("common.continue")}
          </Text>
        </Pressable>
        <Pressable onPress={() => router.back()} accessibilityRole="button">
          <Text style={{ color: colors.textMuted, textAlign: "center" }}>
            {t("common.cancel")}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <Stack.Screen options={{ ...stackScreenOptions, headerShown: false }} />
      <CameraView
        style={{ flex: 1 } as ViewStyle}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={(ev) => {
          if (!ev.data) return;
          const payload = parseBlypPayQr(ev.data);
          if (!payload) {
            if (!handledRef.current) {
              handledRef.current = true;
              blypAlert(t("pay.qrScanTitle"), t("pay.qrInvalid"));
              setTimeout(() => {
                handledRef.current = false;
              }, 1200);
            }
            return;
          }
          onBarcode(ev.data);
        }}
      />
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          top: insets.top + 8,
          left: 0,
          right: 0,
          alignItems: "center",
        }}
      >
        <Text
          style={{
            color: "#fff",
            fontSize: 15,
            fontWeight: "600",
            textShadowColor: "rgba(0,0,0,0.8)",
            textShadowRadius: 6,
          }}
        >
          {t("pay.qrScanHint")}
        </Text>
      </View>
      <Pressable
        onPress={() => router.back()}
        style={{
          position: "absolute",
          bottom: insets.bottom + 24,
          alignSelf: "center",
          paddingHorizontal: 24,
          paddingVertical: 12,
          borderRadius: 999,
          backgroundColor: "rgba(0,0,0,0.55)",
        }}
        accessibilityRole="button"
        accessibilityLabel={t("common.cancel")}
      >
        <Text style={{ color: "#fff", fontWeight: "700" }}>{t("common.cancel")}</Text>
      </Pressable>
    </View>
  );
}

export default function PayScanScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [cameraMod, setCameraMod] = useState<CameraModule | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing">(
    "loading",
  );

  useEffect(() => {
    let alive = true;
    void import("expo-camera")
      .then((mod) => {
        if (!alive) return;
        setCameraMod(mod);
        setLoadState("ready");
      })
      .catch(() => {
        if (!alive) return;
        setLoadState("missing");
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loadState === "loading") {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.background }}>
        <Stack.Screen options={{ ...stackScreenOptions, title: t("pay.qrScanTitle") }} />
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (loadState === "missing" || !cameraMod) {
    return (
      <View
        style={{
          flex: 1,
          padding: 24,
          paddingTop: insets.top + 24,
          backgroundColor: colors.background,
          gap: 16,
        }}
      >
        <Stack.Screen options={{ ...stackScreenOptions, title: t("pay.qrScanTitle") }} />
        <Text style={{ color: colors.text, fontSize: 16, lineHeight: 22 }}>
          {t("pay.qrScanRebuild")}
        </Text>
        <Pressable onPress={() => router.back()} accessibilityRole="button">
          <Text style={{ color: colors.accent, fontWeight: "700", textAlign: "center" }}>
            {t("common.cancel")}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <PayScanCamera camera={cameraMod} insets={insets} colors={colors} t={t} />
  );
}