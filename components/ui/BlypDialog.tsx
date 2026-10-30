import { createBlypDialogStyles } from "@/components/ui/blypDialogStyles";
import { useTheme } from "@/contexts/ThemeContext";
import { modalPresentation } from "@/lib/perf/instantMotion";
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";

export type BlypDialogButton = {
  text: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "destructive";
  loading?: boolean;
  disabled?: boolean;
};

export type BlypDialogProps = {
  visible: boolean;
  title: string;
  message?: string;
  /** Nom Ionicons ou nœud custom au-dessus du titre. */
  icon?: React.ComponentProps<typeof Ionicons>["name"] | ReactNode;
  iconColor?: string;
  buttons: BlypDialogButton[];
  onBackdropPress?: () => void;
  cancelable?: boolean;
};

export function BlypDialog({
  visible,
  title,
  message,
  icon,
  iconColor,
  buttons,
  onBackdropPress,
  cancelable = true,
}: BlypDialogProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createBlypDialogStyles(colors), [colors]);

  const handleBackdrop = () => {
    if (!cancelable) return;
    onBackdropPress?.();
  };

  const renderIcon = () => {
    if (!icon) return null;
    if (typeof icon !== "string") {
      return <View style={styles.iconWrap}>{icon}</View>;
    }
    return (
      <View style={styles.iconWrap}>
        <Ionicons
          name={icon}
          size={26}
          color={iconColor ?? colors.textMuted}
        />
      </View>
    );
  };

  const renderButton = (btn: BlypDialogButton, index: number) => {
    const variant = btn.variant ?? "secondary";
    const disabled = btn.disabled || btn.loading;
    const onPress = () => {
      if (disabled) return;
      btn.onPress?.();
    };

    if (variant === "primary") {
      return (
        <Pressable
          key={`${btn.text}-${index}`}
          style={({ pressed }) => [
            styles.btnPrimary,
            pressed && !disabled && styles.btnPrimaryPressed,
            disabled && styles.btnDestructiveDisabled,
          ]}
          onPress={onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={btn.text}
        >
          {btn.loading ? (
            <ActivityIndicator color={colors.textInverse} size="small" />
          ) : (
            <Text style={styles.btnPrimaryText}>{btn.text}</Text>
          )}
        </Pressable>
      );
    }

    if (variant === "destructive") {
      return (
        <Pressable
          key={`${btn.text}-${index}`}
          style={({ pressed }) => [
            styles.btnDestructive,
            pressed && !disabled && styles.btnDestructivePressed,
            disabled && styles.btnDestructiveDisabled,
          ]}
          onPress={onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={btn.text}
        >
          {btn.loading ? (
            <ActivityIndicator color={colors.destructive} size="small" />
          ) : (
            <Text style={styles.btnDestructiveText}>{btn.text}</Text>
          )}
        </Pressable>
      );
    }

    return (
      <Pressable
        key={`${btn.text}-${index}`}
        style={({ pressed }) => [
          styles.btnSecondary,
          pressed && !disabled && styles.btnSecondaryPressed,
          disabled && styles.btnDestructiveDisabled,
        ]}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={btn.text}
      >
        <Text style={styles.btnSecondaryText}>{btn.text}</Text>
      </Pressable>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType={modalPresentation}
      onRequestClose={cancelable ? handleBackdrop : undefined}
      statusBarTranslucent
    >
      <Pressable
        style={styles.backdrop}
        onPress={handleBackdrop}
        accessibilityRole="button"
        accessibilityLabel={t("common.background")}
      >
        <View style={styles.wrap} pointerEvents="box-none">
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            {renderIcon()}
            <Text style={styles.title}>{title}</Text>
            {message ? (
              <Text style={styles.message}>{message}</Text>
            ) : null}
            <View style={styles.actions}>
              {buttons.map((b, i) => renderButton(b, i))}
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
