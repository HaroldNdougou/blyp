import HistoryScreen from "@/components/history/HistoryScreen";
import { useAuth } from "@/contexts/authContextBase";
import { Redirect } from "expo-router";

export default function HistoryTabScreen() {
  const { token, user } = useAuth();
  if (!token || user?.needsOnboarding) {
    return <Redirect href="/(tabs)/welcome" />;
  }
  return <HistoryScreen />;
}
