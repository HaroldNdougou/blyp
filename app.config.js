const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

/**
 * Injecte EXPO_PUBLIC_API_URL dans `extra` (l’app ne reste pas en mode démo).
 * Autorise le HTTP clair sur Android seulement si l’URL API est en http:// (dev local).
 */
const DEFAULT_INVITE_URL = "https://blyppay.com/download/blyp-pay.apk";

/**
 * Bundle embarqué (release) : seul l’îlot Messages (`app-messages/`) ; l’ancienne app RN
 * complète (`app/`) reste en dev (Metro). `BLYP_RN_FULL_BUNDLE=1` pour la réembarquer.
 */
const embedsReleaseBundle = process.argv.includes("export:embed");
const messagesOnlyBundle =
  embedsReleaseBundle && process.env.BLYP_RN_FULL_BUNDLE !== "1";

module.exports = ({ config }) => {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim() ?? "";
  const assetsCdn = process.env.EXPO_PUBLIC_ASSETS_CDN_URL?.trim() ?? "";
  const realtimeWsUrl = process.env.EXPO_PUBLIC_REALTIME_WS_URL?.trim() ?? "";
  const inviteUrl =
    process.env.EXPO_PUBLIC_INVITE_URL?.trim() || DEFAULT_INVITE_URL;
  const allowCleartext = apiUrl.startsWith("http://");

  return {
    ...config,
    android: {
      ...config.android,
      ...(allowCleartext ? { usesCleartextTraffic: true } : {}),
    },
    ios: {
      ...config.ios,
      ...(allowCleartext
        ? {
            infoPlist: {
              ...config.ios?.infoPlist,
              NSAppTransportSecurity: {
                NSAllowsLocalNetworking: true,
              },
            },
          }
        : {}),
    },
    extra: {
      ...config.extra,
      ...(messagesOnlyBundle
        ? { router: { ...config.extra?.router, root: "app-messages" } }
        : {}),
      EXPO_PUBLIC_API_URL: apiUrl,
      EXPO_PUBLIC_ASSETS_CDN_URL: assetsCdn,
      EXPO_PUBLIC_REALTIME_WS_URL: realtimeWsUrl,
    },
  };
};
