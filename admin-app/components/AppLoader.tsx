import { ActivityIndicator, View } from "react-native";
import { useTheme } from "../contexts/ThemeContext";

export function AppLoader() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}