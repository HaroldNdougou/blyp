import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { ok } from "../../lib/http.mjs";

const dynamo = new DynamoDBClient({});

export async function handler() {
  const tableName = process.env.TABLE_NAME?.trim();
  let dynamodb = "skipped";

  if (tableName) {
    try {
      await dynamo.send(new DescribeTableCommand({ TableName: tableName }));
      dynamodb = "ok";
    } catch (error) {
      console.error("[health] dynamodb:", error);
      dynamodb = "error";
    }
  } else {
    dynamodb = "missing_table";
  }

  return ok({
    ok: true,
    runtime: "aws-lambda",
    region: process.env.AWS_REGION ?? null,
    stage: process.env.STAGE ?? null,
    dynamodb,
  });
}
