const { getDefaultConfig } = require('expo/metro-config');
const { mergeConfig } = require('@react-native/metro-config');

const config = getDefaultConfig(__dirname);

config.transformer.unstable_allowRequireContext = true;
/** Reporte l’exécution des require : accélère le cold start (bundle initial plus léger). */
config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: true,
  },
});

module.exports = config;