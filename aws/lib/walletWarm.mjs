import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getDocClient, getTableName } from "./dynamodb.mjs";

/** Lecture légère — garde connexion Dynamo + cache côté Lambda chaude. */
export async function warmWalletLedger(): Promise<void> {
  const doc = getDocClient();
  await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: "BLYP#WARM", SK: "LEDGER" },
      ConsistentRead: false,
    }),
  );
}
