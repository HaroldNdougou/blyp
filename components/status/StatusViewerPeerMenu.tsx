import { createStatusStyles } from "@/components/status/statusStyles";
import type { StatusMenuAnchor } from "@/components/status/MyStatusRowMenu";
import { useTheme } from "@/contexts/ThemeContext";
import React, { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  Text,
  useWindowDimensions,
} from "react-native";

export type StatusViewerPeerMenuAction =
  | "message"
  | "voiceCall"
  | "videoCall"
  | "viewContact"
  | "notifications"
  | "mute"
  | "report";

type Props = {
  visible: boolean;
  anchor: StatusMenuAnchor | null;
  onDismiss: () => void;
  onAction: (action: StatusViewerPeerMenuAction) => void;
};

const MENU_WIDTH = 268;
const SLIDE_MS = 220;
const SLIDE_OFFSET = 32;

const ITEMS: StatusViewerPeerMenuAction[] = [
  "message",
  "voiceCall",
  "videoCall",
  "viewContact",
  "notifications",
  "mute",
  "report",
];

const LABEL_KEYS: Record<StatusViewerPeerMenuAction, string> = {
  message: "status.viewerMenuMessage",
  voiceCall: "status.viewerMenuVoiceCall",
  videoCall: "status.viewerMenuVideoCall",
  viewContact: "status.viewerMenuViewContact",
  notifications: "status.viewerMenuNotifications",
  mute: "status.viewerMenuMute",
  report: "status.viewerMenuReport",
};

export function StatusViewerPeerMenu({
  visible,
  anchor,
  onDismiss,
  onAction,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStatusStyles(colors), [colors]);
  const { width: screenW, height: screenH } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      return;
    }
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: SLIDE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, progress]);

  if (!anchor) return null;

  const preferredTop = anchor.y + anchor.height + 6;
  const menuHeightEstimate = ITEMS.length * 46 + 8;
  const top =
    preferredTop + menuHeightEstimate > screenH - 24
      ? Math.max(12, anchor.y - menuHeightEstimate - 6)
      : preferredTop;
  const left = Math.min(
    Math.max(12, anchor.x + anchor.width - MENU_WIDTH),
    screenW - MENU_WIDTH - 12,
  );

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-SLIDE_OFFSET, 0],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.viewerPeerMenuBackdrop} onPress={onDismiss}>
        <Animated.View
          style={[
            styles.viewerPeerMenuCard,
            {
              top,
              left,
              width: MENU_WIDTH,
              opacity,
              transform: [{ translateY }],
            },
          ]}
        >
          {ITEMS.map((action) => (
            <Pressable
              key={action}
              style={styles.viewerPeerMenuItem}
              onPress={() => {
                onDismiss();
                onAction(action);
              }}
              accessibilityRole="button"
            >
              <Text style={styles.viewerPeerMenuItemText}>
                {t(LABEL_KEYS[action])}
              </Text>
            </Pressable>
          ))}
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
