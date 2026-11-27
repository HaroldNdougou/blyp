const fs = require("fs");
const path = require("path");
const appJson = require("./app.json");

const keyPath = path.join(__dirname, ".device-key");
const adminDeviceKey = fs.existsSync(keyPath) ? fs.readFileSync(keyPath, "utf8").trim() : "";

module.exports = {
  expo: {
    ...appJson.expo,
    extra: {
      ...appJson.expo.extra,
      adminDeviceKey,
    },
  },
};
