const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

/**
 * Windows : EMFILE + OOM — le cache disque Metro ouvre des milliers de fichiers
 * (surtout pendant HMR). Cache transform en RAM uniquement sur win32.
 */
if (process.platform === "win32") {
  config.maxWorkers = 1;
  config.cacheStores = [];
  config.watcher = {
    ...config.watcher,
    healthCheck: { enabled: false },
  };
}

config.transformer.unstable_allowRequireContext = true;
config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: true,
  },
});

module.exports = config;
