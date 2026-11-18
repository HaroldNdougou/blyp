import { useTheme } from "@/contexts/ThemeContext";
import {
  isNativeShellProfileHandoff,
  returnToNativeShellAfterProfile,
} from "@/lib/nativeShell";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, Text } from "react-native";

/** Retour coque native quand Profil RN est ouvert depuis la coque. */
export function ShellProfileIslandBack() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (Platform.OS !== "android" || !isNativeShellProfileHandoff()) return null;

  return (
    <Pressable
      onPress={() => {
        void returnToNativeShellAfterProfile();
      }}
      accessibilityRole="button"
      accessibilityLabel={t("nativeShell.backToApp")}
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 4,
        paddingBottom: 6,
        gap: 2,
      }}
    >
      <Text style={{ fontSize: 22, color: colors.accent, lineHeight: 26 }}>‹</Text>
      <Text style={{ fontSize: 17, fontWeight: "600", color: colors.accent }}>
        {t("nativeShell.backToApp")}
      </Text>
    </Pressable>
  );
}
