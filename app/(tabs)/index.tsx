import { CommerceHomeScreen } from "@/components/pay/CommerceHomeScreen";
import PayHomeScreen from "@/components/pay/PayHomeScreen";
import { useAuth } from "@/contexts/authContextBase";

/**
 * Onglet principal : Pay (perso) ou encaissement (mode commerce).
 * Pas de 4ᵉ onglet — même slot, ultra light.
 */
export default function MainTabScreen() {
  const { user } = useAuth();
  if (user?.activeContext?.type === "commerce") {
    return <CommerceHomeScreen />;
  }
  return <PayHomeScreen />;
}
