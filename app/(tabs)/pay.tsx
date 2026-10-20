import { CommerceHomeScreen } from "@/components/pay/CommerceHomeScreen";
import PayHomeScreen from "@/components/pay/PayHomeScreen";
import { useAuth } from "@/contexts/authContextBase";

/** Onglet Pay (perso) ou encaissement (mode commerce). */
export default function PayTabScreen() {
  const { user } = useAuth();
  if (user?.activeContext?.type === "commerce") {
    return <CommerceHomeScreen />;
  }
  return <PayHomeScreen />;
}
