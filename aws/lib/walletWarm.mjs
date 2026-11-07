import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getDocClient, getTableName } from "./dynamodb.mjs";
import { ensurePayReceiptPrivateKeyLoaded } from "./payReceiptSecret.mjs";

/** Lecture légère — garde connexion Dynamo + cache côté Lambda chaude. */
export async function warmWalletLedger() {
  const doc = getDocClient();
  await Promise.all([
    doc.send(
      new GetCommand({
        TableName: getTableName(),
        Key: { PK: "BLYP#WARM", SK: "LEDGER" },
        ConsistentRead: false,
      }),
    ),
    ensurePayReceiptPrivateKeyLoaded().catch((err) => {
      console.warn("[wallet] pay receipt secret warm skipped", err?.message ?? err);
    }),
  ]);
}
