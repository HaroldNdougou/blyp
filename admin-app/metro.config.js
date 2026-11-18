const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.projectRoot = __dirname;

module.exports = config;
