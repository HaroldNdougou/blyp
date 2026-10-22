import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import type { ModalProps } from "react-native";

/**
 * Pas d’animations de navigation / modales sur les chemins chauds (fil, onglets, pay).
 * Réduit ~120–300 ms de délai perçu sur Redmi (stack slide + modales).
 */
export const INSTANT_MOTION = true;

export const stackScreenOptions: NativeStackNavigationOptions = INSTANT_MOTION
  ? {
      animation: "none",
      animationDuration: 0,
    }
  : {};

export const modalPresentation: ModalProps["animationType"] = INSTANT_MOTION
  ? "none"
  : "fade";
