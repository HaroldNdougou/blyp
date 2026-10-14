import * as Haptics from "expo-haptics";

/** Préchargé avec le fil (eagerRoutes) — pas de `import()` au 1er long press. */
export function fireChatLongPressHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

export function prefetchChatLongPressHaptic(): void {
  /* noop — le parse du module suffit */
}
