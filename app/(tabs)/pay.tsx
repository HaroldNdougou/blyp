import { CommerceHomeScreen } from "@/components/pay/CommerceHomeScreen";
import PayHomeScreen from "@/components/pay/PayHomeScreen";
import { useAuth } from "@/contexts/authContextBase";
import { Redirect } from "expo-router";

/** Onglet Pay (perso) ou encaissement (mode commerce). */
export default function PayTabScreen() {
  const { user, token } = useAuth();
  if (!token || user?.needsOnboarding) {
    return <Redirect href="/(tabs)/welcome" />;
  }
  if (user?.activeContext?.type === "commerce") {
    return <CommerceHomeScreen />;
  }
  return <PayHomeScreen />;
}
