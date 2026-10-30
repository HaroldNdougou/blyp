import { createSoaReportStyles } from "@/components/soa/soaCarHomeStyles";
import type { StatusMenuAnchor } from "@/components/status/MyStatusRowMenu";
import { useTheme } from "@/contexts/ThemeContext";
import type { SoaReportExportPayload } from "@/lib/soa/soaReportExport";
import {
  exportSoaReportPdf,
  forwardSoaReportFileViaBlyp,
  shareSoaReportSystem,
} from "@/lib/soa/soaReportExportActions";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { blypAlert } from "@/lib/ui/blypAlert";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

const MENU_WIDTH = 220;
const MENU_GAP_BELOW_ANCHOR = 4;

type Props = {
  visible: boolean;
  anchor: StatusMenuAnchor | null;
  periodKey: string;
  payload: SoaReportExportPayload | null;
  onDismiss: () => void;
};

export function SoaCarReportShareMenu({
  visible,
  anchor,
  periodKey,
  payload,
  onDismiss,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createSoaReportStyles(colors), [colors]);
  const { width: screenW } = useWindowDimensions();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) setBusy(false);
  }, [visible]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (!payload || busy) return;
      setBusy(true);
      try {
        await fn();
        onDismiss();
      } catch {
        blypAlert(t("common.genericError"), t("soaCar.reportExportFailed"));
      } finally {
        setBusy(false);
      }
    },
    [payload, busy, onDismiss, t],
  );

  if (!visible || !anchor) return null;

  const top = anchor.y + anchor.height + MENU_GAP_BELOW_ANCHOR;
  const left = Math.min(
    Math.max(12, anchor.x + anchor.width - MENU_WIDTH),
    screenW - MENU_WIDTH - 12,
  );

  const items = [
    {
      key: "transfer",
      label: t("soaCar.reportMenuTransfer"),
      onPress: () =>
        void run(async () => {
          const file = await exportSoaReportPdf(payload!, periodKey);
          await forwardSoaReportFileViaBlyp(file, periodKey);
        }),
    },
    {
      key: "share",
      label: t("soaCar.reportMenuShare"),
      onPress: () =>
        void run(async () => {
          const file = await exportSoaReportPdf(payload!, periodKey);
          await shareSoaReportSystem(
            file.uri,
            "application/pdf",
            t("soaCar.reportExportShareMessage", {
              period: payload!.periodLabel,
            }),
          );
        }),
    },
  ] as const;

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.shareMenuOverlay]}
      pointerEvents="box-none"
    >
      <Pressable style={styles.shareMenuBackdrop} onPress={onDismiss} />
      <View
        style={[
          styles.shareMenuCard,
          {
            top,
            left,
            width: MENU_WIDTH,
            backgroundColor: colors.modal,
          },
        ]}
        collapsable={false}
        renderToHardwareTextureAndroid={Platform.OS === "android"}
      >
        {busy ? (
          <View style={styles.shareMenuBusy}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : null}
        {items.map((item) => (
          <Pressable
            key={item.key}
            style={({ pressed }) => [
              styles.shareMenuItem,
              pressed && styles.shareMenuItemPressed,
            ]}
            disabled={busy || !payload}
            onPress={() => {
              if (busy || !payload) return;
              item.onPress();
            }}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || !payload }}
          >
            <Text style={styles.shareMenuItemText}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
