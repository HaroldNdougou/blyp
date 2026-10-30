import { BlypDialog } from "@/components/ui/BlypDialog";
import { useTheme } from "@/contexts/ThemeContext";
import React from "react";
import { useTranslation } from "react-i18next";

type Props = {
  visible: boolean;
  busy: boolean;
  onContinue: () => void;
  onConfirmCancel: () => void;
};

export function RegisterCancelConfirmModal({
  visible,
  busy,
  onContinue,
  onConfirmCancel,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <BlypDialog
      visible={visible}
      title={t("register.cancelRegistrationTitle")}
      message={t("register.cancelRegistrationMessage")}
      icon="close-circle-outline"
      iconColor={colors.textMuted}
      cancelable={!busy}
      onBackdropPress={onContinue}
      buttons={[
        {
          text: t("register.cancelRegistrationContinue"),
          variant: "secondary",
          onPress: onContinue,
          disabled: busy,
        },
        {
          text: t("register.cancelRegistrationConfirm"),
          variant: "destructive",
          onPress: onConfirmCancel,
          loading: busy,
          disabled: busy,
        },
      ]}
    />
  );
}
