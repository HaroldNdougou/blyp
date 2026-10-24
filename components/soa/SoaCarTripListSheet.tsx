import {
  createSoaReportStyles,
  createSoaSeatSheetStyles,
} from "@/components/soa/soaCarHomeStyles";
import { SoaReportTripListRow } from "@/components/soa/SoaReportTripListRow";
import { useTheme } from "@/contexts/ThemeContext";
import { modalPresentation } from "@/lib/perf/instantMotion";
import type { SoaReportTripListItem } from "@/lib/soa/soaReportTripList";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  visible: boolean;
  dayLabel: string;
  trips: SoaReportTripListItem[];
  onDismiss: () => void;
  onSelectTrip: (trip: SoaReportTripListItem) => void;
};

export function SoaCarTripListSheet({
  visible,
  dayLabel,
  trips,
  onDismiss,
  onSelectTrip,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const sheetStyles = useMemo(
    () => createSoaSeatSheetStyles(colors),
    [colors],
  );
  const reportStyles = useMemo(() => createSoaReportStyles(colors), [colors]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={modalPresentation}
      onRequestClose={onDismiss}
    >
      <Pressable style={sheetStyles.backdrop} onPress={onDismiss}>
        <Pressable
          style={[
            sheetStyles.sheet,
            reportStyles.tripListSheet,
            { paddingBottom: Math.max(insets.bottom, 20) },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={reportStyles.tripListSheetTitle}>
            {t("soaCar.reportTripCountLabel")}
          </Text>
          <Text style={reportStyles.tripListSheetDay}>{dayLabel}</Text>
          <ScrollView
            style={reportStyles.tripListSheetScroll}
            contentContainerStyle={reportStyles.tripListSheetScrollContent}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {trips.length === 0 ? (
              <View style={reportStyles.empty}>
                <Text style={reportStyles.emptyText}>
                  {t("soaCar.reportEmpty")}
                </Text>
              </View>
            ) : (
              trips.map((item) => {
                const title = item.isActive
                  ? t("soaCar.reportTripActive")
                  : t("soaCar.reportTripLineNumber", {
                      n: item.courseNumber ?? 0,
                    });
                return (
                  <SoaReportTripListRow
                    key={item.tripId}
                    item={item}
                    title={title}
                    styles={reportStyles}
                    onPress={() => onSelectTrip(item)}
                  />
                );
              })
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
