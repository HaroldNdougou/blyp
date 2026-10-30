import ConversationsScreen from "@/components/messages/ConversationsScreen";
import { useAuth } from "@/contexts/authContextBase";
import { Redirect } from "expo-router";

/** Onglet Messages (2ᵉ) — accueil Pay = route `pay`. */
export default function TabsMessagesScreen() {
  const { token, user } = useAuth();
  if (!token || user?.needsOnboarding) {
    return <Redirect href="/(tabs)/welcome" />;
  }
  return <ConversationsScreen />;
}
