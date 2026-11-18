/** Fermeture écran RN ouvert depuis la coque (reçus, documents, dépôt). */
export async function leaveNativeRouteScreen(): Promise<boolean> {
  const { returnToNativeShellFromRouteScreen } = await import("@/lib/nativeShell");
  return returnToNativeShellFromRouteScreen();
}
