import {
  createSoaCarHomeStyles,
  createSoaSeatSheetStyles,
} from "@/components/soa/soaCarHomeStyles";
import { SoaSeatMap } from "@/components/soa/SoaSeatMap";
import { useTheme } from "@/contexts/ThemeContext";
import { modalPresentation } from "@/lib/perf/instantMotion";
import { formatFcfa } from "@/lib/formatFcfa";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  visible: boolean;
  amountFcfa: number;
  recipientAccountId: string;
  recipientName: string;
  onCancel: () => void;
  onConfirm: (seatNumber: number) => void;
};

export function SoaSeatPaySheet({
  visible,
  amountFcfa,
  recipientAccountId,
  recipientName,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const sheetStyles = useMemo(
    () => createSoaSeatSheetStyles(colors),
    [colors],
  );
  const mapStyles = useMemo(() => createSoaCarHomeStyles(colors), [colors]);
  const [selected, setSelected] = useState<number | null>(null);
  const taken = useMemo(() => new Set<number>(), []);

  useEffect(() => {
    if (!visible) setSelected(null);
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={modalPresentation}
      onRequestClose={onCancel}
    >
      <Pressable style={sheetStyles.backdrop} onPress={onCancel}>
        <Pressable
          style={[
            sheetStyles.sheet,
            { paddingBottom: Math.max(insets.bottom, 20) },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={sheetStyles.title}>{t("soaCar.seatTitle")}</Text>
          <Text style={sheetStyles.sub}>
            {t("soaCar.seatSub", {
              amount: formatFcfa(amountFcfa),
              name: recipientName,
            })}
          </Text>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <SoaSeatMap
              mode="picker"
              styles={mapStyles}
              taken={taken}
              selected={selected}
              chipsDisabled={false}
              onSelect={setSelected}
            />
          </ScrollView>
          <View style={sheetStyles.actions}>
            <Pressable
              style={sheetStyles.cancelBtn}
              onPress={onCancel}
              accessibilityRole="button"
            >
              <Text style={sheetStyles.cancelText}>{t("common.cancel")}</Text>
            </Pressable>
            <Pressable
              style={[
                sheetStyles.confirmBtn,
                selected == null && sheetStyles.confirmDisabled,
              ]}
              disabled={selected == null}
              onPress={() => {
                if (selected != null) onConfirm(selected);
              }}
              accessibilityRole="button"
            >
              <Text style={sheetStyles.confirmText}>
                {t("soaCar.seatContinue")}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
