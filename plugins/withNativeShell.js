/**
 * Coque native Android (squelette v1) + pont îlot RN Messages.
 */
const {
  withAndroidManifest,
  withMainApplication,
  withMainActivity,
  withDangerousMod,
  withAppBuildGradle,
  AndroidConfig,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PACKAGE = "com.haroldndougou.blyp.shell";
const SHELL_ACTIVITY = ".shell.BlypNativeShellActivity";

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function readExpoPublicUrl(cfg, key) {
  const extra = cfg.extra || {};
  const fromEnv = process.env[key]?.trim() ?? "";
  const fromExtra = extra[key]?.trim() ?? "";
  return (fromEnv || fromExtra).replace(/\/$/, "");
}

/** Natif au lancement sauf EXPO_PUBLIC_NATIVE_SHELL=0|false. */
function useNativeLauncher() {
  const v = process.env.EXPO_PUBLIC_NATIVE_SHELL;
  return v !== "0" && v !== "false";
}

function withNativeShellConfig(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const api = readExpoPublicUrl(cfg, "EXPO_PUBLIC_API_URL");
      const ws = readExpoPublicUrl(cfg, "EXPO_PUBLIC_REALTIME_WS_URL");
      const cdn = readExpoPublicUrl(cfg, "EXPO_PUBLIC_ASSETS_CDN_URL");
      const dest = path.join(
        platformRoot,
        "app/src/main/res/values/blyp_shell_config.xml",
      );
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="blyp_api_base_url" translatable="false">${escapeXml(api)}</string>
    <string name="blyp_realtime_ws_url" translatable="false">${escapeXml(ws)}</string>
    <string name="blyp_assets_cdn_url" translatable="false">${escapeXml(cdn)}</string>
</resources>
`;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, xml, "utf8");
      return cfg;
    },
  ]);
}

function withNativeShellSources(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const srcDir = path.join(projectRoot, "native-android", "shell");
      const destDir = path.join(
        platformRoot,
        "app/src/main/java/com/haroldndougou/blyp/shell",
      );
      fs.mkdirSync(destDir, { recursive: true });

      function rmKtRecursive(dir) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, entry.name);
          if (entry.isDirectory()) rmKtRecursive(p);
          else if (entry.name.endsWith(".kt")) fs.rmSync(p);
        }
      }

      function copyKtRecursive(fromDir, toDir) {
        fs.mkdirSync(toDir, { recursive: true });
        for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
          const from = path.join(fromDir, entry.name);
          const to = path.join(toDir, entry.name);
          if (entry.isDirectory()) copyKtRecursive(from, to);
          else if (entry.name.endsWith(".kt")) fs.copyFileSync(from, to);
        }
      }

      rmKtRecursive(destDir);
      copyKtRecursive(srcDir, destDir);
      const srcRes = path.join(srcDir, "res");
      if (fs.existsSync(srcRes)) {
        copyDirRecursive(
          srcRes,
          path.join(platformRoot, "app/src/main/res"),
        );
      }
      fs.writeFileSync(
        path.join(platformRoot, "app/src/main/res/values/blyp_shell_bools.xml"),
        `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <bool name="blyp_native_shell_launcher">${useNativeLauncher() ? "true" : "false"}</bool>
</resources>
`,
        "utf8",
      );
      return cfg;
    },
  ]);
}

function withNativeShellManifest(config) {
  const nativeLauncher = useNativeLauncher();

  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    if (!app.activity) app.activity = [];

    const SHELL_PAY_AUTH = ".shell.ShellPayAuthActivity";
    const SHELL_DEPOSIT = ".shell.ShellDepositActivity";
    const SHELL_SIGN_IN = ".shell.ShellSignInActivity";
    const SHELL_RECEIPTS = ".shell.ShellReceiptsActivity";
    const SHELL_DOCUMENTS = ".shell.ShellDocumentsActivity";
    const SHELL_KYC = ".shell.ShellKycActivity";
    const SHELL_PROFILE_SETTINGS = ".shell.ShellProfileSettingsActivity";
    const SHELL_KYC_CAPTURE = ".shell.ShellKycCaptureActivity";
    const SHELL_RECEIPT_ADD = ".shell.ShellReceiptAddActivity";
    const SHELL_ONBOARDING = ".shell.ShellNativeOnboardingActivity";
    const SHELL_PIN_BOOTSTRAP = ".shell.ShellPinBootstrapActivity";
    const SHELL_PICK_RECIPIENT = ".shell.ShellPickRecipientActivity";
    const SHELL_COMMERCE_SWITCH = ".shell.ShellCommerceSwitchActivity";
    const SHELL_COMMERCE_CREATE = ".shell.ShellCommerceCreateActivity";
    const fpAuth = "${applicationId}.blyp.shell.fileprovider";

    app.activity = app.activity.filter(
      (a) => a.$["android:name"] !== SHELL_ACTIVITY,
    );
    app.activity.push({
      $: {
        "android:name": SHELL_ACTIVITY,
        "android:exported": nativeLauncher ? "true" : "false",
        "android:theme": "@style/AppTheme",
        "android:launchMode": "singleTask",
        "android:configChanges": "keyboard|keyboardHidden|orientation|screenSize|uiMode",
        "android:windowSoftInputMode": "adjustResize",
      },
      ...(nativeLauncher
        ? {
            "intent-filter": [
              {
                action: [{ $: { "android:name": "android.intent.action.MAIN" } }],
                category: [
                  { $: { "android:name": "android.intent.category.LAUNCHER" } },
                ],
              },
            ],
          }
        : {}),
    });

    if (!app.activity.some((a) => a.$["android:name"] === SHELL_PAY_AUTH)) {
      app.activity.push({
        $: {
          "android:name": SHELL_PAY_AUTH,
          "android:exported": "false",
          "android:theme": "@style/QuickPayAuthTheme",
          "android:excludeFromRecents": "true",
          "android:taskAffinity": "",
          "android:launchMode": "singleInstance",
        },
      });
    }

    for (const [name, theme] of [
      [SHELL_DEPOSIT, "@style/AppTheme"],
      [SHELL_SIGN_IN, "@style/AppTheme"],
      [SHELL_RECEIPTS, "@style/AppTheme"],
      [SHELL_DOCUMENTS, "@style/AppTheme"],
      [SHELL_KYC, "@style/AppTheme"],
      [SHELL_PROFILE_SETTINGS, "@style/AppTheme"],
      [SHELL_KYC_CAPTURE, "@style/AppTheme"],
      [SHELL_RECEIPT_ADD, "@style/AppTheme"],
      [SHELL_ONBOARDING, "@style/AppTheme"],
      [SHELL_PIN_BOOTSTRAP, "@style/AppTheme"],
      [SHELL_PICK_RECIPIENT, "@style/AppTheme"],
      [".shell.ShellPayScanActivity", "@style/AppTheme"],
      [".shell.ShellMerchantQrActivity", "@style/AppTheme"],
      [SHELL_COMMERCE_SWITCH, "@style/AppTheme"],
      [SHELL_COMMERCE_CREATE, "@style/AppTheme"],
      [".shell.ShellSoaReportActivity", "@style/AppTheme"],
      [".shell.ShellChatThreadActivity", "@style/AppTheme"],
      [".shell.ShellNewChatActivity", "@style/AppTheme"],
      [".shell.ShellChatMoneyActivity", "@style/AppTheme"],
      [".shell.ShellChatMoneyReceiptActivity", "@style/AppTheme"],
      [".shell.ShellForwardChatActivity", "@style/AppTheme"],
      [".shell.ShellStatusViewActivity", "@style/Theme.AppCompat.NoActionBar"],
      [".shell.ShellStatusCreateActivity", "@style/AppTheme"],
    ]) {
      if (!app.activity.some((a) => a.$["android:name"] === name)) {
        const extra =
          name === ".shell.ShellChatThreadActivity"
            ? { "android:windowSoftInputMode": "adjustResize" }
            : {};
        app.activity.push({
          $: {
            "android:name": name,
            "android:exported": "false",
            "android:theme": theme,
            ...extra,
          },
        });
      }
    }
    for (const a of app.activity) {
      if (a.$["android:name"] === SHELL_ONBOARDING) {
        a.$["android:launchMode"] = "singleTask";
        a.$["android:taskAffinity"] = "${applicationId}.onboarding";
      }
    }

    if (!app.provider) app.provider = [];
    if (!app.provider.some((p) => p.$["android:authorities"] === fpAuth)) {
      app.provider.push({
        $: {
          "android:name": "androidx.core.content.FileProvider",
          "android:authorities": fpAuth,
          "android:exported": "false",
          "android:grantUriPermissions": "true",
        },
        "meta-data": [
          {
            $: {
              "android:name": "android.support.FILE_PROVIDER_PATHS",
              "android:resource": "@xml/blyp_shell_file_paths",
            },
          },
        ],
      });
    }

    if (nativeLauncher) {
      const main = app.activity.find(
        (a) =>
          a.$["android:name"] === ".MainActivity" ||
          a.$["android:name"] === "com.haroldndougou.blyp.MainActivity",
      );
      if (main && main["intent-filter"]) {
        main["intent-filter"] = main["intent-filter"].filter((filter) => {
          const actions = filter.action ?? [];
          const categories = filter.category ?? [];
          const isLauncher =
            actions.some(
              (a) => a.$["android:name"] === "android.intent.action.MAIN",
            ) &&
            categories.some(
              (c) => c.$["android:name"] === "android.intent.category.LAUNCHER",
            );
          return !isLauncher;
        });
        if (main["intent-filter"].length === 0) delete main["intent-filter"];
      }
    }

    /** Portrait uniquement, sur tous les écrans de l’app (jamais paysage). */
    for (const a of app.activity) {
      if (String(a.$["android:name"] ?? "").startsWith(".")) {
        a.$["android:screenOrientation"] = "portrait";
      }
    }

    return cfg;
  });
}

function withNativeShellMainActivity(config) {
  return withMainActivity(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes("BlypShellLaunchBridge.captureFromIntent")) return cfg;

    if (!src.includes("import android.content.Intent")) {
      src = src.replace(
        "import android.os.Bundle",
        "import android.content.Intent\nimport android.os.Bundle",
      );
    }
    src = src.replace(
      /^package .+\n/m,
      (m) => `${m}import ${PACKAGE}.BlypShellLaunchBridge\n`,
    );

    const hookCreate =
      "BlypShellLaunchBridge.captureFromIntent(intent)";
    if (src.includes("super.onCreate(null)")) {
      src = src.replace(
        "super.onCreate(null)",
        `super.onCreate(null)\n    ${hookCreate}`,
      );
    } else if (src.includes("super.onCreate(savedInstanceState)")) {
      src = src.replace(
        "super.onCreate(savedInstanceState)",
        `super.onCreate(savedInstanceState)\n    ${hookCreate}`,
      );
    }

    const extraMethods = `
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    BlypShellLaunchBridge.captureFromIntent(intent)
  }
`;
    if (!src.includes("override fun onNewIntent(intent: Intent)")) {
      src = src.replace(/\n}\s*$/, `${extraMethods}\n}\n`);
    }

    cfg.modResults.contents = src;
    return cfg;
  });
}

function withMessagesLoadingOverlay(config) {
  return withMainActivity(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes("BlypShellMessagesLoading.attach")) return cfg;
    if (!src.includes("import com.haroldndougou.blyp.shell.BlypShellMessagesLoading")) {
      src = src.replace(
        /^package .+\n/m,
        (m) => `${m}import com.haroldndougou.blyp.shell.BlypShellMessagesLoading\n`,
      );
    }
    if (src.includes("BlypShellLaunchBridge.captureFromIntent(intent)")) {
      src = src.replace(
        "BlypShellLaunchBridge.captureFromIntent(intent)",
        "BlypShellLaunchBridge.captureFromIntent(intent)\n    BlypShellMessagesLoading.attach(this)",
      );
    } else if (src.includes("super.onCreate(null)")) {
      src = src.replace(
        "super.onCreate(null)",
        "super.onCreate(null)\n    BlypShellMessagesLoading.attach(this)",
      );
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

function withNativeShellPackage(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    const importLine = `import ${PACKAGE}.BlypNativeShellPackage`;
    if (!src.includes(importLine)) {
      src = src.replace(/^package .+\n/m, (m) => `${m}${importLine}\n`);
    }
    if (!src.includes("BlypNativeShellPackage()")) {
      src = src.replace(
        "PackageList(this).packages.apply {",
        "PackageList(this).packages.apply {\n              add(BlypNativeShellPackage())",
      );
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withNativeShell(config) {
  config = withNativeShellSources(config);
  config = withNativeShellConfig(config);
  config = withNativeShellManifest(config);
  config = withNativeShellMainActivity(config);
  config = withMessagesLoadingOverlay(config);
  config = withNativeShellPackage(config);
  config = withNativeShellGradle(config);
  return config;
};

const BLYP_LINT_GRADLE = `
// Blyp: bloque toute fonction Android trop récente pour les vieux téléphones (min Android 7).
android {
    compileOptions {
        coreLibraryDesugaringEnabled true
    }
    lint {
        lintConfig file("../../native-android/lint.xml")
        checkOnly "NewApi"
        fatal "NewApi"
        abortOnError true
        checkDependencies false
        checkReleaseBuilds true
        ignoreTestSources true
    }
}
dependencies {
    coreLibraryDesugaring "com.android.tools:desugar_jdk_libs:2.1.5"
}
`;

function withNativeShellGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('checkOnly "NewApi"')) {
      src = src.trimEnd() + "\n" + BLYP_LINT_GRADLE;
    }
    if (!src.includes("androidx.biometric:biometric")) {
      src = src.replace(
        /dependencies\s*\{/,
        `dependencies {
    implementation "androidx.biometric:biometric:1.1.0"`,
      );
    }
    if (!src.includes("androidx.recyclerview:recyclerview")) {
      src = src.replace(
        /dependencies\s*\{/,
        `dependencies {
    implementation "androidx.recyclerview:recyclerview:1.3.2"`,
      );
    }
    if (!src.includes("androidx.swiperefreshlayout:swiperefreshlayout")) {
      src = src.replace(
        /dependencies\s*\{/,
        `dependencies {
    implementation "androidx.swiperefreshlayout:swiperefreshlayout:1.1.0"`,
      );
    }
    if (!src.includes("androidx.viewpager2:viewpager2")) {
      src = src.replace(
        /dependencies\s*\{/,
        `dependencies {
    implementation "androidx.viewpager2:viewpager2:1.1.0"`,
      );
    }
    if (!src.includes("security-crypto")) {
      src = src.replace(
        /dependencies\s*\{/,
        `dependencies {
    implementation "androidx.security:security-crypto:1.1.0-alpha06"`,
      );
    }
    if (!src.includes("com.google.zxing:core")) {
      src = src.replace(
        /dependencies\s*\{/,
        `dependencies {
    implementation "com.google.zxing:core:3.5.3"`,
      );
    }
    if (!src.includes("com.google.mlkit:barcode-scanning")) {
      src = src.replace(
        /dependencies\s*\{/,
        `dependencies {
    implementation "androidx.camera:camera-core:1.5.0-rc01"
    implementation "androidx.camera:camera-camera2:1.5.0-rc01"
    implementation "androidx.camera:camera-lifecycle:1.5.0-rc01"
    implementation "androidx.camera:camera-view:1.5.0-rc01"
    implementation "com.google.mlkit:barcode-scanning:17.3.0"`,
      );
    }
    if (!src.includes("play-services-location")) {
      src = src.replace(
        /dependencies\s*\{/,
        `dependencies {
    implementation "com.google.android.gms:play-services-location:21.0.1"`,
      );
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}
