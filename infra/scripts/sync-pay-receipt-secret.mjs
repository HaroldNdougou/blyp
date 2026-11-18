/**
 * Écrit le PEM reçu paiement dans Secrets Manager (blyp/{stage}/pay-receipt-ed25519-private-key-pem).
 * Utilise AWS CLI (même credentials que sam deploy).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "af-south-1";
const stage = (process.env.BLYP_STAGE || "dev").trim();
const pem = (process.env.BLYP_PAY_RECEIPT_PEM_SYNC || "").trim().replace(/\\n/g, "\n");

const secretName = `blyp/${stage}/pay-receipt-ed25519-private-key-pem`;

function aws(args) {
  const result = spawnSync("aws", [...args, "--region", region], {
    shell: true,
    stdio: "inherit",
    windowsHide: true,
  });
  return result.status ?? 1;
}

function main() {
  if (!pem) {
    console.log("sync-pay-receipt-secret: pas de PEM dans samconfig — rien à écrire.");
    return 0;
  }
  if (!pem.includes("BEGIN") || pem.length < 32) {
    console.error("sync-pay-receipt-secret: PEM invalide ou trop court.");
    return 1;
  }

  const dir = mkdtempSync(join(tmpdir(), "blyp-pem-"));
  const pemPath = join(dir, "pay-receipt.pem");
  writeFileSync(pemPath, pem, "utf8");

  const describe = spawnSync(
    "aws",
    ["secretsmanager", "describe-secret", "--secret-id", secretName, "--region", region],
    { shell: true, encoding: "utf8", windowsHide: true },
  );

  if (describe.status !== 0) {
    const code = aws([
      "secretsmanager",
      "create-secret",
      "--name",
      secretName,
      "--description",
      "Ed25519 PEM — signature reçus paiement commerce (v2)",
      "--secret-string",
      `file://${pemPath.replace(/\\/g, "/")}`,
    ]);
    rmSync(dir, { recursive: true, force: true });
    if (code === 0) {
      console.log(`sync-pay-receipt-secret: secret créé (${secretName}).`);
    }
    return code;
  }

  const code = aws([
    "secretsmanager",
    "put-secret-value",
    "--secret-id",
    secretName,
    "--secret-string",
    `file://${pemPath.replace(/\\/g, "/")}`,
  ]);
  rmSync(dir, { recursive: true, force: true });
  if (code === 0) {
    console.log(`sync-pay-receipt-secret: secret mis à jour (${secretName}).`);
  }
  return code;
}

process.exit(main());
