import { Redirect } from "expo-router";

/** MVP : pas d’onglet Messages — route legacy redirige vers Pay. */
export default function TabsIndexRedirect() {
  return <Redirect href="/(tabs)/pay" />;
}
