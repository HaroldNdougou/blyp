import ConversationsScreen from "@/components/messages/ConversationsScreen";
import PayTabScreen from "./pay";
import { useAuth } from "@/contexts/authContextBase";

/** Accueil : Messages si connecté, Pay sinon (index = route par défaut Expo Router). */
export default function TabsHomeScreen() {
  const { token } = useAuth();
  if (token) return <ConversationsScreen />;
  return <PayTabScreen />;
}
