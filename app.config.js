const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

/**
 * Injecte EXPO_PUBLIC_API_URL dans `extra` (l’app ne reste pas en mode démo).
 * Autorise le HTTP clair sur Android seulement si l’URL API est en http:// (dev local).
 */
module.exports = ({ config }) => {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim() ?? "";
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
      EXPO_PUBLIC_API_URL: apiUrl,
    },
  };
};
