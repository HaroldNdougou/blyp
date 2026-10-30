import { CheckGlyph } from "@/components/pay/PayGlyphs";
import { createBlypActionFlashStyles } from "@/components/ui/blypActionFlashStyles";
import { useTheme } from "@/contexts/ThemeContext";
import {
  dismissBlypActionFlash,
  getCurrentBlypActionFlash,
  subscribeBlypActionFlash,
  type BlypActionFlashEvent,
} from "@/lib/ui/blypActionFlash";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function BlypActionFlashHost() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createBlypActionFlashStyles(colors), [colors]);
  const [flash, setFlash] = useState<BlypActionFlashEvent | null>(() =>
    getCurrentBlypActionFlash(),
  );

  useEffect(() => subscribeBlypActionFlash(setFlash), []);

  if (!flash) return null;

  return (
    <View
      style={[styles.host, { paddingTop: Math.max(insets.top, 8) + 6 }]}
      pointerEvents="box-none"
    >
      <Pressable
        style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
        onPress={dismissBlypActionFlash}
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        accessibilityLabel={flash.message}
      >
        <CheckGlyph color={colors.accent} size={18} />
        <Text style={styles.pillText} numberOfLines={3}>
          {flash.message}
        </Text>
      </Pressable>
    </View>
  );
}
