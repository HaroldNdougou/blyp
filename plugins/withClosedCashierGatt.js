/**
 * Expo config plugin — serveur GATT caisse fermée (Android).
 */
const {
  withMainApplication,
  withDangerousMod,
} = require("@expo/config-plugins");

const PACKAGE = "com.haroldndougou.blyp.cashiergatt";

function withCashierGattNativeSources(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const fs = require("fs");
      const path = require("path");
      const projectRoot = cfg.modRequest.projectRoot;
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const srcDir = path.join(projectRoot, "native-android", "cashier-gatt");
      const destDir = path.join(
        platformRoot,
        "app",
        "src",
        "main",
        "java",
        "com",
        "haroldndougou",
        "blyp",
        "cashiergatt",
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

function withCashierGattPackage(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    const importLine = `import ${PACKAGE}.CashierGattPackage`;
    if (!src.includes(importLine)) {
      src = src.replace(/^package .+\n/m, (m) => `${m}${importLine}\n`);
    }
    if (!src.includes("CashierGattPackage()")) {
      if (src.includes("PackageList(this).packages.apply {")) {
        src = src.replace(
          "PackageList(this).packages.apply {",
          "PackageList(this).packages.apply {\n              add(CashierGattPackage())",
        );
      }
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withClosedCashierGatt(config) {
  config = withCashierGattNativeSources(config);
  config = withCashierGattPackage(config);
  return config;
};
