import { BlypDialog } from "@/components/ui/BlypDialog";
import { useTheme } from "@/contexts/ThemeContext";
import React from "react";
import { useTranslation } from "react-i18next";

type Props = {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function MyStatusDeleteConfirmModal({
  visible,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <BlypDialog
      visible={visible}
      title={t("status.deleteOneTitle")}
      message={t("status.deleteOneMessage")}
      icon="trash-outline"
      iconColor={colors.destructive}
      onBackdropPress={onCancel}
      buttons={[
        {
          text: t("common.cancel"),
          variant: "secondary",
          onPress: onCancel,
        },
        {
          text: t("status.menuDelete"),
          variant: "destructive",
          onPress: onConfirm,
        },
      ]}
    />
  );
}
