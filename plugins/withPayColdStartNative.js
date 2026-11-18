/**
 * Ressources Pay partagées (layout clavier, couleurs, styles) — `native-android/cold-start/res`.
 * L’ancien overlay Pay au boot RN n’existe plus : nettoie aussi son code déjà présent dans `android/`.
 */
const {
  withMainApplication,
  withMainActivity,
  withDangerousMod,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
}

function withPayColdStartSources(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const platformRoot = cfg.modRequest.platformProjectRoot;
      fs.rmSync(
        path.join(platformRoot, "app/src/main/java/com/haroldndougou/blyp/coldstart"),
        { recursive: true, force: true },
      );
      const srcRes = path.join(projectRoot, "native-android", "cold-start", "res");
      if (fs.existsSync(srcRes)) {
        copyDirRecursive(srcRes, path.join(platformRoot, "app/src/main/res"));
      }
      return cfg;
    },
  ]);
}

function withoutColdStartMainActivity(config) {
  return withMainActivity(config, (cfg) => {
    cfg.modResults.contents = cfg.modResults.contents
      .replace(/^import com\.haroldndougou\.blyp\.coldstart\.PayColdStartOverlay\n/m, "")
      .replace(/\n\s*PayColdStartOverlay\.attach\(this\)/g, "");
    return cfg;
  });
}

function withoutColdStartPackage(config) {
  return withMainApplication(config, (cfg) => {
    cfg.modResults.contents = cfg.modResults.contents
      .replace(/^import com\.haroldndougou\.blyp\.coldstart\.BlypColdStartPackage\n/m, "")
      .replace(/\n\s*add\(BlypColdStartPackage\(\)\)/g, "");
    return cfg;
  });
}

module.exports = function withPayColdStartNative(config) {
  config = withPayColdStartSources(config);
  config = withoutColdStartMainActivity(config);
  config = withoutColdStartPackage(config);
  return config;
};
