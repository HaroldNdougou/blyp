import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export function getTableName() {
  const name = process.env.TABLE_NAME?.trim();
  if (!name) throw new Error("TABLE_NAME missing");
  return name;
}

export function getDocClient() {
  return doc;
}

/** Epoch seconds for DynamoDB TTL attribute `expiresAt`. */
export function ttlFromNowMs(ms) {
  return Math.floor((Date.now() + ms) / 1000);
}
