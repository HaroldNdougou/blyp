import type { BlypDialogButton } from "@/components/ui/BlypDialog";

export type BlypAlertButtonStyle = "default" | "cancel" | "destructive";

export type BlypAlertButton = {
  text: string;
  onPress?: () => void;
  style?: BlypAlertButtonStyle;
  isPreferred?: boolean;
};

export type BlypAlertOptions = {
  cancelable?: boolean;
  onDismiss?: () => void;
};

export type BlypAlertPayload = {
  title: string;
  message?: string;
  buttons: BlypDialogButton[];
  cancelable: boolean;
  onDismiss?: () => void;
};

type Listener = (payload: BlypAlertPayload | null) => void;

const listeners = new Set<Listener>();
let current: BlypAlertPayload | null = null;

function emit() {
  for (const l of listeners) l(current);
}

function mapAlertStyle(
  style: BlypAlertButtonStyle | undefined,
): BlypDialogButton["variant"] {
  if (style === "destructive") return "destructive";
  if (style === "cancel") return "secondary";
  return "primary";
}

function normalizeButtons(
  buttons: BlypAlertButton[] | undefined,
  fallbackOk: string,
): BlypDialogButton[] {
  if (!buttons?.length) {
    return [{ text: fallbackOk, variant: "primary" }];
  }
  return buttons.map((b) => ({
    text: b.text,
    variant: mapAlertStyle(b.style),
    onPress: b.onPress,
  }));
}

export function subscribeBlypAlert(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

export function dismissBlypAlert() {
  const onDismiss = current?.onDismiss;
  current = null;
  emit();
  onDismiss?.();
}

/** Remplacement thémé de `Alert.alert` (API compatible). */
export function blypAlert(
  title: string,
  message?: string,
  buttons?: BlypAlertButton[],
  options?: BlypAlertOptions,
) {
  const fallbackOk = "OK";
  const normalized = normalizeButtons(buttons, fallbackOk).map((b) => ({
    ...b,
    onPress: () => {
      dismissBlypAlert();
      b.onPress?.();
    },
  }));

  current = {
    title,
    message,
    buttons: normalized,
    cancelable: options?.cancelable ?? true,
    onDismiss: options?.onDismiss,
  };
  emit();
}

export function getCurrentBlypAlert(): BlypAlertPayload | null {
  return current;
}
