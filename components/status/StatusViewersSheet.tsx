import { PeerAvatar } from "@/components/peers/PeerAvatar";
import { createStatusStyles } from "@/components/status/statusStyles";
import { useTheme } from "@/contexts/ThemeContext";
import { useStatusPublishedWhen } from "@/hooks/useStatusPublishedWhen";
import type { StatusPostViewer } from "@/lib/api/types";
import { modalPresentation } from "@/lib/perf/instantMotion";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type RowProps = {
  viewer: StatusPostViewer;
  styles: ReturnType<typeof createStatusStyles>;
};

function StatusViewerRow({ viewer, styles }: RowProps) {
  const when = useStatusPublishedWhen(viewer.viewedAt);
  return (
    <View style={styles.statusViewersRow}>
      <PeerAvatar
        name={viewer.displayName}
        remoteUrl={viewer.avatarUrl}
        size={44}
      />
      <View style={styles.statusViewersRowMeta}>
        <Text style={styles.statusViewersRowName} numberOfLines={1}>
          {viewer.displayName}
        </Text>
        {when ? (
          <Text style={styles.statusViewersRowWhen} numberOfLines={1}>
            {when}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

type Props = {
  visible: boolean;
  loading: boolean;
  viewers: StatusPostViewer[];
  onDismiss: () => void;
};

export function StatusViewersSheet({
  visible,
  loading,
  viewers,
  onDismiss,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStatusStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType={modalPresentation}
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.statusViewersBackdrop} onPress={onDismiss}>
        <Pressable
          style={[
            styles.statusViewersSheet,
            { paddingBottom: Math.max(insets.bottom, 16) },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={styles.statusViewersTitle}>
            {t("status.viewersSheetTitle")}
          </Text>
          {loading ? (
            <View style={styles.statusViewersLoading}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : viewers.length === 0 ? (
            <Text style={styles.statusViewersEmpty}>
              {t("status.viewersEmpty")}
            </Text>
          ) : (
            <ScrollView
              style={styles.statusViewersList}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {viewers.map((v) => (
                <StatusViewerRow key={v.userId} viewer={v} styles={styles} />
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
