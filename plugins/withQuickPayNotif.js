/**
 * Expo config plugin — notif persistante paiement rapide (Android).
 */
const {
  withAndroidManifest,
  withMainApplication,
  withMainActivity,
  withAppBuildGradle,
  withDangerousMod,
  AndroidConfig,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PACKAGE = "com.haroldndougou.blyp.quickpaynotif";
const SERVICE = ".quickpaynotif.QuickPayNotifService";
const RECEIVER = ".quickpaynotif.QuickPayActionReceiver";

function ensurePermission(manifest, name) {
  if (!manifest.manifest["uses-permission"]) {
    manifest.manifest["uses-permission"] = [];
  }
  const perms = manifest.manifest["uses-permission"];
  if (!perms.some((p) => p.$["android:name"] === name)) {
    perms.push({ $: { "android:name": name } });
  }
}

function withQuickPayPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    ensurePermission(manifest, "android.permission.FOREGROUND_SERVICE");
    ensurePermission(manifest, "android.permission.FOREGROUND_SERVICE_DATA_SYNC");
    return cfg;
  });
}

function withQuickPayManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    if (!app.service) app.service = [];
    if (!app.receiver) app.receiver = [];
    if (!app.activity) app.activity = [];

    if (!app.service.some((s) => s.$["android:name"] === SERVICE)) {
      app.service.push({
        $: {
          "android:name": SERVICE,
          "android:exported": "false",
          "android:foregroundServiceType": "dataSync",
        },
      });
    }

    const recvName = RECEIVER;
    if (!app.receiver.some((r) => r.$["android:name"] === recvName)) {
      app.receiver.push({
        $: {
          "android:name": recvName,
          "android:exported": "false",
        },
      });
    }

    const authActivity = ".quickpaynotif.QuickPayAuthActivity";
    if (!app.activity.some((a) => a.$["android:name"] === authActivity)) {
      app.activity.push({
        $: {
          "android:name": authActivity,
          "android:exported": "false",
          "android:theme": "@style/QuickPayAuthTheme",
          "android:excludeFromRecents": "true",
          "android:taskAffinity": "",
          "android:launchMode": "singleInstance",
          "android:showWhenLocked": "true",
          "android:turnScreenOn": "true",
        },
      });
    }

    return cfg;
  });
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

function withQuickPayNativeSources(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const srcDir = path.join(projectRoot, "native-android", "quick-pay-notif");
      const destDir = path.join(
        platformRoot,
        "app",
        "src",
        "main",
        "java",
        "com",
        "haroldndougou",
        "blyp",
        "quickpaynotif",
      );
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of fs.readdirSync(srcDir)) {
        if (!file.endsWith(".kt")) continue;
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
      }
      const srcRes = path.join(srcDir, "res");
      if (fs.existsSync(srcRes)) {
        copyDirRecursive(
          srcRes,
          path.join(platformRoot, "app", "src", "main", "res"),
        );
      }
      return cfg;
    },
  ]);
}

function withQuickPayGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes("androidx.biometric:biometric")) return cfg;
    src = src.replace(
      'implementation("com.facebook.react:react-android")',
      `implementation("com.facebook.react:react-android")
    implementation "androidx.biometric:biometric:1.1.0"
    implementation "androidx.security:security-crypto:1.1.0-alpha06"
    implementation "androidx.appcompat:appcompat:1.7.0"`,
    );
    cfg.modResults.contents = src;
    return cfg;
  });
}

function withQuickPayMainActivity(config) {
  return withMainActivity(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes("deliverQuickPayIntent")) return cfg;

    if (!src.includes("import android.content.Intent")) {
      src = src.replace(
        "import android.os.Bundle",
        "import android.content.Intent\nimport android.os.Bundle",
      );
    }
    src = src.replace(
      /^package .+\n/m,
      (m) =>
        `${m}import ${PACKAGE}.QuickPayActionReceiver\nimport ${PACKAGE}.QuickPayNotifBridge\n`,
    );

    src = src.replace(
      "super.onCreate(null)\n  }",
      "super.onCreate(null)\n    deliverQuickPayIntent(intent)\n  }",
    );

    const extraMethods = `
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    deliverQuickPayIntent(intent)
  }

  private fun deliverQuickPayIntent(intent: Intent?) {
    val amount = intent?.getIntExtra(QuickPayActionReceiver.EXTRA_AMOUNT, 0) ?: 0
    if (amount > 0) {
      QuickPayNotifBridge.emitPayRequested(this, amount)
    }
  }
`;
    src = src.replace(/\n}\s*$/, `${extraMethods}\n}\n`);
    cfg.modResults.contents = src;
    return cfg;
  });
}

function withQuickPayPackage(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    const importLine = `import ${PACKAGE}.QuickPayNotifPackage`;
    if (!src.includes(importLine)) {
      src = src.replace(/^package .+\n/m, (m) => `${m}${importLine}\n`);
    }
    if (!src.includes("QuickPayNotifPackage()")) {
      if (src.includes("PackageList(this).packages.apply {")) {
        src = src.replace(
          "PackageList(this).packages.apply {",
          "PackageList(this).packages.apply {\n              add(QuickPayNotifPackage())",
        );
      } else if (src.includes("// Packages that cannot be autolinked")) {
        src = src.replace(
          "// Packages that cannot be autolinked",
          "add(QuickPayNotifPackage())\n              // Packages that cannot be autolinked",
        );
      }
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withQuickPayNotif(config) {
  config = withQuickPayPermissions(config);
  config = withQuickPayManifest(config);
  config = withQuickPayNativeSources(config);
  config = withQuickPayGradle(config);
  config = withQuickPayPackage(config);
  return config;
};
