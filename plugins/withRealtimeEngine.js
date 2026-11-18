/**
 * Moteur WebSocket binaire Android (OkHttp) — decode hors thread JS.
 */
const {
  withMainApplication,
  withDangerousMod,
  withAppBuildGradle,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PACKAGE = "com.haroldndougou.blyp.realtime";

function copyDir(srcDir, destDir) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    if (!file.endsWith(".kt")) continue;
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  }
}

function withRealtimeEngineSources(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const srcDir = path.join(projectRoot, "native-android", "realtime-engine");
      const destDir = path.join(
        platformRoot,
        "app/src/main/java/com/haroldndougou/blyp/realtime",
      );
      copyDir(srcDir, destDir);
      return cfg;
    },
  ]);
}

function withRealtimeEnginePackage(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    const importLine = `import ${PACKAGE}.BlypRealtimePackage`;
    if (!src.includes(importLine)) {
      src = src.replace(/^package .+\n/m, (m) => `${m}${importLine}\n`);
    }
    if (!src.includes("BlypRealtimePackage()")) {
      src = src.replace(
        "PackageList(this).packages.apply {",
        "PackageList(this).packages.apply {\n              add(BlypRealtimePackage())",
      );
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

function withRealtimeEngineGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes("okhttp:4.12.0")) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        `dependencies {
    implementation "com.squareup.okhttp3:okhttp:4.12.0"`,
      );
    }
    return cfg;
  });
}

module.exports = function withRealtimeEngine(config) {
  config = withRealtimeEngineSources(config);
  config = withRealtimeEnginePackage(config);
  config = withRealtimeEngineGradle(config);
  return config;
};
