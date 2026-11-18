/**
 * Android 12+ : scan BLE sans localisation (`neverForLocation`).
 * Localisation déclarée seulement jusqu’à Android 11 (exigée par l’OS pour scanner).
 */
const { withAndroidManifest } = require("@expo/config-plugins");

const LOCATION_PERMS = [
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
];
const SCAN = "android.permission.BLUETOOTH_SCAN";

function withBleNoLocation(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$ = manifest.$ || {};
    manifest.$["xmlns:tools"] = manifest.$["xmlns:tools"] || "http://schemas.android.com/tools";
    const perms = manifest["uses-permission"] || [];
    manifest["uses-permission"] = perms;

    const upsert = (name) => {
      let p = perms.find((x) => x.$["android:name"] === name);
      if (!p) {
        p = { $: { "android:name": name } };
        perms.push(p);
      }
      return p;
    };

    const scan = upsert(SCAN);
    scan.$["android:usesPermissionFlags"] = "neverForLocation";
    scan.$["tools:targetApi"] = "s";
    scan.$["tools:replace"] = "android:usesPermissionFlags";

    for (const name of LOCATION_PERMS) {
      const p = upsert(name);
      p.$["android:maxSdkVersion"] = "30";
      p.$["tools:replace"] = "android:maxSdkVersion";
    }
    return cfg;
  });
}

module.exports = withBleNoLocation;
