/** Affichage montant FCFA type "12 500" */
export function formatFcfa(amount: number): string {
  return Math.max(0, Math.floor(amount)).toLocaleString("fr-FR");
}
