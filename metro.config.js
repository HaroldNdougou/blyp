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

/** Référence / archive : jamais dans le bundle app. */
const blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : config.resolver.blockList
      ? [config.resolver.blockList]
      : []),
  /docs\/archive\/.*/,
  /[/\\]archived[/\\].*/,
];
config.resolver.blockList = blockList;

/**
 * Bundle embarqué (release) = îlot Messages seul (cf. `app.config.js`) :
 * écrans RN Pay / Historique / Profil / dépôt… hors bundle, préchauffage RN neutralisé.
 */
const messagesOnlyBundle =
  process.argv.includes("export:embed") && process.env.BLYP_RN_FULL_BUNDLE !== "1";
if (messagesOnlyBundle) {
  const legacyRoute =
    /^@\/app\/(\(tabs\)\/(pay|history|profile|welcome|index)|deposit|kyc|register|receipts|documents|pocket\/.*|pay-qr|pay-scan)$/;
  const legacyWarm = /^@\/lib\/perf\/(aggressiveWarm|floodAllTabs)$/;
  const upstream = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (legacyRoute.test(moduleName)) return { type: "empty" };
    const name = legacyWarm.test(moduleName)
      ? "@/lib/perf/messagesIslandWarm"
      : moduleName;
    return upstream
      ? upstream(context, name, platform)
      : context.resolveRequest(context, name, platform);
  };
}

module.exports = config;
