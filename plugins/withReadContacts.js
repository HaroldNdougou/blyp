/**
 * Garantit READ_CONTACTS dans AndroidManifest (liste + popup runtime).
 * Sans cette ligne, Android / MIUI n’affiche pas « Contacts » dans les autorisations.
 */
const { withAndroidManifest } = require("@expo/config-plugins");

const READ_CONTACTS = "android.permission.READ_CONTACTS";

function ensurePermission(manifest, name) {
  if (!manifest.manifest["uses-permission"]) {
    manifest.manifest["uses-permission"] = [];
  }
  const perms = manifest.manifest["uses-permission"];
  if (!perms.some((p) => p.$["android:name"] === name)) {
    perms.push({ $: { "android:name": name } });
  }
}

function withReadContacts(config) {
  return withAndroidManifest(config, (cfg) => {
    ensurePermission(cfg.modResults, READ_CONTACTS);
    return cfg;
  });
}

module.exports = withReadContacts;
