import ConversationsScreen from "@/components/messages/ConversationsScreen";
import { useAuth } from "@/contexts/authContextBase";
import { lazy, Suspense } from "react";

const PayTabScreen = lazy(() => import("./pay"));

/** Accueil : Messages si connecté, Pay sinon (index = route par défaut Expo Router). */
export default function TabsHomeScreen() {
  const { token } = useAuth();
  if (token) return <ConversationsScreen />;
  return (
    <Suspense fallback={null}>
      <PayTabScreen />
    </Suspense>
  );
}
