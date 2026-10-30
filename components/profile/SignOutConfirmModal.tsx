import { BlypDialog } from "@/components/ui/BlypDialog";
import { useTheme } from "@/contexts/ThemeContext";
import React from "react";
import { useTranslation } from "react-i18next";

type Props = {
  visible: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function SignOutConfirmModal({
  visible,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <BlypDialog
      visible={visible}
      title={t("profile.signOutTitle")}
      message={t("profile.signOutMessage")}
      icon="log-out-outline"
      iconColor={colors.textMuted}
      cancelable={!busy}
      onBackdropPress={onCancel}
      buttons={[
        {
          text: t("common.cancel"),
          variant: "secondary",
          onPress: onCancel,
          disabled: busy,
        },
        {
          text: t("profile.signOutConfirm"),
          variant: "destructive",
          onPress: onConfirm,
          loading: busy,
          disabled: busy,
        },
      ]}
    />
  );
}
