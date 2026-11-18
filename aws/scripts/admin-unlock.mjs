#!/usr/bin/env node
/**
 * Lève le verrou après trop d'échecs de connexion admin (15 min auto, ou tout de suite avec cette commande).
 *
 *   TABLE_NAME=blyp-dev AWS_REGION=af-south-1 node aws/scripts/admin-unlock.mjs
 */
import { clearFailures } from "../lib/adminAuth.mjs";

if (!process.env.TABLE_NAME?.trim()) {
  console.error("Indique TABLE_NAME (ex. blyp-dev) et AWS_REGION=af-south-1");
  process.exit(1);
}

await clearFailures();
console.log("Verrou admin levé : tu peux te reconnecter.");