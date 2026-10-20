const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { FileStore } = require("metro-cache");

const config = getDefaultConfig(__dirname);

/** Windows : EMFILE + OOM si Metro ouvre trop de fichiers en parallèle (cache %TEMP%). */
if (process.platform === "win32") {
  config.maxWorkers = 1;
  config.cacheStores = [
    new FileStore({ root: path.join(__dirname, ".metro-cache") }),
  ];
}

config.transformer.unstable_allowRequireContext = true;
config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: true,
  },
});

module.exports = config;
