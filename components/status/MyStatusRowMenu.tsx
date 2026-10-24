import { createStatusStyles } from "@/components/status/statusStyles";
import { useTheme } from "@/contexts/ThemeContext";
import type { StatusPost } from "@/lib/api/types";
import { modalPresentation } from "@/lib/perf/instantMotion";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

export type StatusMenuAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Props = {
  visible: boolean;
  post: StatusPost | null;
  anchor: StatusMenuAnchor | null;
  onDismiss: () => void;
  onForward: (post: StatusPost) => void;
  onEdit: (post: StatusPost) => void;
  onShare: (post: StatusPost) => void;
  onDelete: (post: StatusPost) => void;
};

const MENU_WIDTH = 240;

export function MyStatusRowMenu({
  visible,
  post,
  anchor,
  onDismiss,
  onForward,
  onEdit,
  onShare,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStatusStyles(colors), [colors]);
  const { width: screenW } = useWindowDimensions();

  if (!post || !anchor) return null;

  const top = anchor.y + anchor.height + 4;
  const left = Math.min(
    Math.max(12, anchor.x + anchor.width - MENU_WIDTH),
    screenW - MENU_WIDTH - 12,
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType={modalPresentation}
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.myStatusMenuBackdrop} onPress={onDismiss}>
        <Pressable
          style={[
            styles.myStatusMenuCard,
            { top, left, width: MENU_WIDTH },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <Pressable
            style={styles.myStatusMenuItem}
            onPress={() => {
              onDismiss();
              onForward(post);
            }}
            accessibilityRole="button"
          >
            <Text style={styles.myStatusMenuItemText}>
              {t("status.menuForward")}
            </Text>
          </Pressable>
          <Pressable
            style={styles.myStatusMenuItem}
            onPress={() => {
              onDismiss();
              onEdit(post);
            }}
            accessibilityRole="button"
          >
            <Text style={styles.myStatusMenuItemText}>
              {t("status.menuEdit")}
            </Text>
          </Pressable>
          <Pressable
            style={styles.myStatusMenuItem}
            onPress={() => {
              onDismiss();
              onShare(post);
            }}
            accessibilityRole="button"
          >
            <Text style={styles.myStatusMenuItemText}>
              {t("status.menuShare")}
            </Text>
          </Pressable>
          <Pressable
            style={styles.myStatusMenuItem}
            onPress={() => {
              onDismiss();
              onDelete(post);
            }}
            accessibilityRole="button"
          >
            <Text style={styles.myStatusMenuItemTextDestructive}>
              {t("status.menuDelete")}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
