import { BlypDialog } from "@/components/ui/BlypDialog";
import {
  dismissBlypAlert,
  getCurrentBlypAlert,
  subscribeBlypAlert,
  type BlypAlertPayload,
} from "@/lib/ui/blypAlert";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function BlypAlertHost() {
  const { t } = useTranslation();
  const [alert, setAlert] = useState<BlypAlertPayload | null>(() =>
    getCurrentBlypAlert(),
  );

  useEffect(() => subscribeBlypAlert(setAlert), []);

  if (!alert) return null;

  const buttons = alert.buttons.map((b) => ({
    ...b,
    text: b.text === "OK" && alert.buttons.length === 1 ? t("common.ok") : b.text,
  }));

  return (
    <BlypDialog
      visible
      title={alert.title}
      message={alert.message}
      buttons={buttons}
      cancelable={alert.cancelable}
      onBackdropPress={() => dismissBlypAlert()}
    />
  );
}
