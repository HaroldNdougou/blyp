import type { ApiToastPayload } from "./api/types";

export type ToastVariant = "success" | "info" | "warning" | "error";

export type ShowToastOptions = {
  title?: string;
  message: string;
  emoji?: string;
  variant?: ToastVariant;
  /** Durée d’affichage avant disparition (ms). */
  durationMs?: number;
  /** Si présent, marque la notification comme lue côté API après fermeture. */
  notificationId?: string;
};

export function toastOptionsFromApi(
  payload: ApiToastPayload,
  variant: ToastVariant = "success",
): ShowToastOptions {
  return {
    title: payload.title,
    message: payload.body,
    emoji: payload.emoji ?? undefined,
    variant,
    notificationId: payload.id,
  };
}
