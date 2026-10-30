import { Redirect } from "expo-router";

/** Accueil produit = Pay (pas Messages / `/(tabs)/index`). */
export default function RootIndex() {
  return <Redirect href="/(tabs)/pay" />;
}
