/**
 * Expo config plugin — annonce vocale paiement en arrière-plan (Android).
 */
const {
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
  withAppBuildGradle,
  AndroidConfig,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const EXPO_FCM =
  "expo.modules.notifications.service.ExpoFirebaseMessagingService";
const BLYP_FCM =
  "com.haroldndougou.blyp.paymentannounce.BlypFirebaseMessagingService";
const ANNOUNCE_SERVICE =
  ".paymentannounce.PaymentAnnounceService";

function ensurePermission(manifest, name) {
  if (!manifest.manifest["uses-permission"]) {
    manifest.manifest["uses-permission"] = [];
  }
  const perms = manifest.manifest["uses-permission"];
  if (!perms.some((p) => p.$["android:name"] === name)) {
    perms.push({ $: { "android:name": name } });
  }
}

function withPaymentAnnouncePermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    ensurePermission(manifest, "android.permission.FOREGROUND_SERVICE");
    ensurePermission(
      manifest,
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
    );
    return cfg;
  });
}

function withPaymentAnnounceManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

    if (!app.service) app.service = [];

    app.service = app.service.filter(
      (s) => s.$["android:name"] !== EXPO_FCM,
    );

    const hasBlypFcm = app.service.some(
      (s) => s.$["android:name"] === BLYP_FCM,
    );
    if (!hasBlypFcm) {
      app.service.push({
        $: {
          "android:name": BLYP_FCM,
          "android:exported": "false",
        },
        "intent-filter": [
          {
            $: { "android:priority": "-1" },
            action: [{ $: { "android:name": "com.google.firebase.MESSAGING_EVENT" } }],
          },
        ],
      });
    }

    const hasAnnounceSvc = app.service.some(
      (s) => s.$["android:name"] === ANNOUNCE_SERVICE,
    );
    if (!hasAnnounceSvc) {
      app.service.push({
        $: {
          "android:name": ANNOUNCE_SERVICE,
          "android:exported": "false",
          "android:foregroundServiceType": "mediaPlayback",
        },
      });
    }

    return cfg;
  });
}

function withPaymentAnnounceNativeSources(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const srcDir = path.join(
        projectRoot,
        "native-android",
        "payment-announce",
      );
      const destDir = path.join(
        platformRoot,
        "app",
        "src",
        "main",
        "java",
        "com",
        "haroldndougou",
        "blyp",
        "paymentannounce",
      );
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of fs.readdirSync(srcDir)) {
        if (!file.endsWith(".kt")) continue;
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
      }

      const rawDir = path.join(
        platformRoot,
        "app",
        "src",
        "main",
        "res",
        "raw",
      );
      fs.mkdirSync(rawDir, { recursive: true });
      fs.copyFileSync(
        path.join(projectRoot, "assets", "sounds", "cash.wav"),
        path.join(rawDir, "blyp_cash.wav"),
      );

      const resSrc = path.join(projectRoot, "native-android", "res");
      const resDest = path.join(
        platformRoot,
        "app",
        "src",
        "main",
        "res",
      );
      if (fs.existsSync(resSrc)) {
        for (const entry of fs.readdirSync(resSrc, { withFileTypes: true })) {
          if (!entry.isDirectory() || !entry.name.startsWith("drawable")) {
            continue;
          }
          const srcDir = path.join(resSrc, entry.name);
          const destDir = path.join(resDest, entry.name);
          fs.mkdirSync(destDir, { recursive: true });
          for (const file of fs.readdirSync(srcDir)) {
            fs.copyFileSync(
              path.join(srcDir, file),
              path.join(destDir, file),
            );
          }
        }
      }

      return cfg;
    },
  ]);
}

function withPaymentAnnouncePackage(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    const importLine =
      "import com.haroldndougou.blyp.paymentannounce.PaymentAnnouncePackage";
    if (!src.includes(importLine)) {
      src = src.replace(/^package .+\n/m, (m) => `${m}${importLine}\n`);
    }
    if (!src.includes("PaymentAnnouncePackage()")) {
      if (src.includes("PackageList(this).packages.apply {")) {
        src = src.replace(
          "PackageList(this).packages.apply {",
          "PackageList(this).packages.apply {\n              add(PaymentAnnouncePackage())",
        );
      }
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

function withPaymentAnnounceGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes("firebase-messaging")) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        `dependencies {
    implementation platform("com.google.firebase:firebase-bom:33.7.0")
    implementation "com.google.firebase:firebase-messaging"`,
      );
    }
    return cfg;
  });
}

module.exports = function withPaymentAnnounceBackground(config) {
  config = withPaymentAnnouncePermissions(config);
  config = withPaymentAnnounceManifest(config);
  config = withPaymentAnnounceNativeSources(config);
  config = withPaymentAnnouncePackage(config);
  config = withPaymentAnnounceGradle(config);
  return config;
};
