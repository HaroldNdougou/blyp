#!/usr/bin/env node
/**
 * Configuration du tableau de bord fondateur (une seule fois, en local).
 *
 *   node aws/scripts/admin-setup.mjs --email a@x.com,b@x.com --sender alertes@blyppay.com --push-phone 6AAAAAAAA,6BBBBBBBB [--write]
 *
 * Génère : empreinte du mot de passe (scrypt), secret TOTP (application d'authentification),
 * secret de session. Rien n'est envoyé nulle part. Avec --write, les paramètres sont ajoutés à
 * infra/samconfig.toml (gitignoré) ; sinon ils sont affichés.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { generateTotpSecret, hashPassword, otpauthUri } from "../lib/adminAuth.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : null;
}
const flag = (name) => process.argv.includes(`--${name}`);

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const orig = rl._writeToOutput;
    process.stdout.write(question);
    rl._writeToOutput = (s) => {
      if (s.includes("\n") || s.includes("\r")) orig.call(rl, s);
    };
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

function checkPassword(pw) {
  if (pw.length < 14) return "14 caractères minimum.";
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) {
    return "Mélangez minuscules, majuscules et chiffres.";
  }
  return null;
}

/** Plusieurs fondateurs : adresses et téléphones séparés par des virgules, mêmes droits pour tous. */
const emails = [
  ...new Set(
    (arg("email") ?? "")
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  ),
];
if (!emails.length || emails.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) {
  console.error("Indiquez vos emails : --email a@exemple.com,b@exemple.com");
  process.exit(1);
}
const email = emails[0];
const sender = (arg("sender") ?? email).trim();
const pushPhones = [
  ...new Set(
    (arg("push-phone") ?? "")
      .split(/[,;\s]+/)
      .map((p) => p.replace(/\D/g, "").slice(-9))
      .filter(Boolean),
  ),
];
if (pushPhones.some((p) => p.length !== 9)) {
  console.error("Chaque téléphone doit avoir 9 chiffres.");
  process.exit(1);
}

let password = arg("password") ?? process.env.ADMIN_PASSWORD ?? "";
if (!password) {
  password = await promptHidden("Choisissez un mot de passe (14+ caractères) : ");
  const again = await promptHidden("Retapez-le : ");
  if (password !== again) {
    console.error("Les deux saisies diffèrent.");
    process.exit(1);
  }
}
const weak = checkPassword(password);
if (weak) {
  console.error(`Mot de passe trop faible : ${weak}`);
  process.exit(1);
}

const passwordHash = await hashPassword(password);
const totpSecret = generateTotpSecret();
const jwtSecret = randomBytes(48).toString("base64url");

const params = {
  AdminEmail: emails.join(","),
  ...(emails[1] ? { AdminAlarmEmail2: emails[1] } : {}),
  AdminSenderEmail: sender,
  AdminPasswordHash: passwordHash,
  AdminTotpSecret: totpSecret,
  AdminJwtSecret: jwtSecret,
  ...(pushPhones.length ? { AdminPushPhone: pushPhones.join(",") } : {}),
};
const line = Object.entries(params)
  .map(([k, v]) => `${k}=${v}`)
  .join(" ");

console.log("\n=== 1) Application d'authentification (Google Authenticator, Authy, 1Password…) ===");
console.log("Ajoutez un compte « saisie manuelle » avec cette clé (type : temporel) :\n");
console.log(`   ${totpSecret}\n`);
console.log("ou ouvrez ce lien depuis un lecteur compatible :\n");
console.log(`   ${otpauthUri(totpSecret, email)}\n`);

const samPath = join(root, "infra", "samconfig.toml");
if (flag("write")) {
  if (!existsSync(samPath)) {
    console.error(`infra/samconfig.toml introuvable — copiez d'abord samconfig.toml.example.`);
    process.exit(1);
  }
  let cfg = readFileSync(samPath, "utf8");
  const re = /^(parameter_overrides\s*=\s*")(.*)("\s*)$/m;
  const m = cfg.match(re);
  if (!m) {
    console.error("parameter_overrides absent de infra/samconfig.toml");
    process.exit(1);
  }
  const kept = m[2]
    .split(" ")
    .filter((tok) => tok && !/^Admin[A-Za-z]*=/.test(tok))
    .join(" ");
  cfg = cfg.replace(re, `$1${kept} ${line}$3`);
  writeFileSync(samPath, cfg);
  console.log("=== 2) Paramètres ajoutés à infra/samconfig.toml (fichier gitignoré) ===");
} else {
  console.log("=== 2) Ajoutez ceci à parameter_overrides dans infra/samconfig.toml (ou relancez avec --write) ===\n");
  console.log(`${line}\n`);
}
console.log("\n=== 3) Dernières étapes ===");
console.log(" - Vérifiez dans Amazon SES l'adresse expéditrice ET chaque adresse destinataire (région af-south-1).");
console.log(" - Chaque numéro doit être un compte Blyp existant, connecté sur le téléphone concerné.");
console.log(" - Déployez : node infra/scripts/sam-deploy.mjs (après sam build).");
console.log(" - L'adresse du tableau de bord s'affiche dans les sorties du déploiement (AdminDashboardUrl).");
console.log(" - Gardez le mot de passe et la clé de l'application d'authentification dans un coffre sûr.\n");
