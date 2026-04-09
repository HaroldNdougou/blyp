/**
 * Une seule promesse partagée : démarre le chargement du chunk dès le premier import
 * (ex. root layout), en parallèle du reste du boot. React.lazy réutilise cette promesse.
 */
export const payHomeScreenPromise = import("@/components/pay/PayHomeScreen");
