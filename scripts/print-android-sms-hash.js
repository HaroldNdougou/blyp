#!/usr/bin/env node
/**
 * Hash 11 caractères Google SMS Retriever (même algorithme qu’expo-otp-autofill / Play Services).
 * Usage :
 *   node scripts/print-android-sms-hash.js
 *   node scripts/print-android-sms-hash.js --keystore chemin.jks --alias monalias
 *
 * Nécessite `keytool` (JDK) dans le PATH.
 */

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function loadPackageName() {
  const appJson = path.join(__dirname, "..", "app.json");
  const j = JSON.parse(fs.readFileSync(appJson, "utf8"));
  const pkg = j?.expo?.android?.package;
  if (!pkg) {
    console.error("Impossible de lire expo.android.package dans app.json");
    process.exit(1);
  }
  return pkg;
}

function defaultDebugKeystore() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  return path.join(home, ".android", "debug.keystore");
}

function exportCertDer(keystorePath, alias, storePass, keyPass) {
  try {
    return execFileSync(
      "keytool",
      [
        "-exportcert",
        "-keystore",
        keystorePath,
        "-alias",
        alias,
        "-storepass",
        storePass,
        "-keypass",
        keyPass,
      ],
      { encoding: "buffer", maxBuffer: 2 * 1024 * 1024 },
    );
  } catch (e) {
    console.error(
      "Échec keytool. Vérifie que le JDK est dans le PATH et que le keystore / alias / mots de passe sont corrects.\n",
      e.message,
    );
    process.exit(1);
  }
}

function smsRetrieverHash11(packageName, certDerBuffer) {
  const certHex = Buffer.from(certDerBuffer).toString("hex");
  const appInfo = `${packageName} ${certHex}`;
  const digest = crypto.createHash("sha256").update(appInfo, "utf8").digest();
  const b64 = digest
    .toString("base64")
    .replace(/=+$/u, "")
    .replace(/\n/g, "");
  return b64.slice(0, 11);
}

function parseArgs() {
  const a = process.argv.slice(2);
  const out = {
    keystore: process.env.ANDROID_KEYSTORE || defaultDebugKeystore(),
    alias: process.env.ANDROID_KEY_ALIAS || "androiddebugkey",
    storePass: process.env.ANDROID_STORE_PASSWORD || "android",
    keyPass: process.env.ANDROID_KEY_PASSWORD || "android",
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--keystore" && a[i + 1]) out.keystore = a[++i];
    else if (a[i] === "--alias" && a[i + 1]) out.alias = a[++i];
    else if (a[i] === "--store-pass" && a[i + 1]) out.storePass = a[++i];
    else if (a[i] === "--key-pass" && a[i + 1]) out.keyPass = a[++i];
  }
  return out;
}

const pkg = loadPackageName();
const { keystore, alias, storePass, keyPass } = parseArgs();

if (!fs.existsSync(keystore)) {
  console.error("Keystore introuvable :", keystore);
  console.error(
    "Pour le debug Android standard, lance au moins une fois un build Android pour générer ~/.android/debug.keystore",
  );
  process.exit(1);
}

const der = exportCertDer(keystore, alias, storePass, keyPass);
const hash = smsRetrieverHash11(pkg, der);

console.log("");
console.log("Package     :", pkg);
console.log("Keystore    :", keystore);
console.log("Alias       :", alias);
console.log("");
console.log("Ajoute dans .env (racine ou server/) puis redémarre l’API :");
console.log("");
console.log("ANDROID_SMS_OTP_APP_HASH=" + hash);
console.log("");
console.log("(Plusieurs builds : HASH_DEBUG,HASH_RELEASE sur une seule ligne.)");
console.log("");
