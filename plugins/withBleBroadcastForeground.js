/**
 * Expo config plugin — foreground service diffusion BLE taxi (Android).
 */
const {
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
  AndroidConfig,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PACKAGE = "com.haroldndougou.blyp.bleforeground";
const SERVICE = ".bleforeground.BleBroadcastForegroundService";

function ensurePermission(manifest, name) {
  if (!manifest.manifest["uses-permission"]) {
    manifest.manifest["uses-permission"] = [];
  }
  const perms = manifest.manifest["uses-permission"];
  if (!perms.some((p) => p.$["android:name"] === name)) {
    perms.push({ $: { "android:name": name } });
  }
}

function withBleBroadcastPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    ensurePermission(manifest, "android.permission.FOREGROUND_SERVICE");
    ensurePermission(
      manifest,
      "android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE",
    );

    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    if (!app.service) app.service = [];
    const exists = app.service.some(
      (s) => s.$["android:name"] === SERVICE,
    );
    if (!exists) {
      app.service.push({
        $: {
          "android:name": SERVICE,
          "android:exported": "false",
          "android:foregroundServiceType": "connectedDevice",
        },
      });
    }
    return cfg;
  });
}

function withBleBroadcastNativeSources(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const srcDir = path.join(projectRoot, "native-android", "ble-foreground");
      const destDir = path.join(
        platformRoot,
        "app",
        "src",
        "main",
        "java",
        "com",
        "haroldndougou",
        "blyp",
        "bleforeground",
      );
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of fs.readdirSync(srcDir)) {
        if (!file.endsWith(".kt")) continue;
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
      }
      return cfg;
    },
  ]);
}

function withBleBroadcastPackage(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    const importLine = `import ${PACKAGE}.BleBroadcastForegroundPackage`;
    if (!src.includes(importLine)) {
      src = src.replace(
        /^package .+\n/m,
        (m) => `${m}${importLine}\n`,
      );
    }
    if (!src.includes("BleBroadcastForegroundPackage()")) {
      if (src.includes("PackageList(this).packages.apply {")) {
        src = src.replace(
          "PackageList(this).packages.apply {",
          "PackageList(this).packages.apply {\n              add(BleBroadcastForegroundPackage())",
        );
      } else if (src.includes("// Packages that cannot be autolinked")) {
        src = src.replace(
          "// Packages that cannot be autolinked",
          "add(BleBroadcastForegroundPackage())\n              // Packages that cannot be autolinked",
        );
      } else if (src.includes("return packages")) {
        src = src.replace(
          /(\s+)(return packages)/,
          "$1packages.add(BleBroadcastForegroundPackage())\n$1$2",
        );
      }
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withBleBroadcastForeground(config) {
  config = withBleBroadcastPermissions(config);
  config = withBleBroadcastNativeSources(config);
  config = withBleBroadcastPackage(config);
  return config;
};
