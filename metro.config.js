const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { FileStore } = require("metro-cache");

const config = getDefaultConfig(__dirname);

/**
 * Windows : cache disque (1 dossier) pour éviter de recompiler 80s+ à chaque chunk.
 * Si EMFILE revient : `set BLYP_METRO_WORKERS=1` puis relancer Metro.
 */
if (process.platform === "win32") {
  const workers = Number(process.env.BLYP_METRO_WORKERS ?? "2");
  config.maxWorkers = Number.isFinite(workers) && workers > 0 ? workers : 2;
  config.cacheStores = [
    new FileStore({
      root: path.join(__dirname, "node_modules", ".cache", "metro"),
    }),
  ];
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
