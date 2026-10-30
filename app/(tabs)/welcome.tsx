import WelcomeSignInScreen from "@/components/auth/WelcomeSignInScreen";
import { useAuth } from "@/contexts/authContextBase";
import { Redirect } from "expo-router";

/** Accueil déconnecté ou onboarding (pas Pay). */
export default function WelcomeTabScreen() {
  const { token, user, isLoading } = useAuth();
  if (isLoading) return null;
  if (token && user && !user.needsOnboarding) {
    return <Redirect href="/(tabs)/pay" />;
  }
  return <WelcomeSignInScreen />;
}
