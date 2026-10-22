/**
 * Galerie Android 13/14+ : permissions MediaLibrary (expo) + legacy storage cap.
 * Sans READ_MEDIA_IMAGES dans le manifest, getAssetsAsync renvoie toujours 0.
 */
const { withAndroidManifest, AndroidConfig } = require("@expo/config-plugins");

const READ_MEDIA_IMAGES = "android.permission.READ_MEDIA_IMAGES";
const READ_MEDIA_VIDEO = "android.permission.READ_MEDIA_VIDEO";
const READ_MEDIA_AUDIO = "android.permission.READ_MEDIA_AUDIO";
const READ_MEDIA_VISUAL_USER_SELECTED =
  "android.permission.READ_MEDIA_VISUAL_USER_SELECTED";
const READ_EXTERNAL_STORAGE = "android.permission.READ_EXTERNAL_STORAGE";

function capLegacyExternalStorage(manifest) {
  const perms = manifest.manifest["uses-permission"];
  if (!perms) return;
  for (const p of perms) {
    if (p.$["android:name"] === READ_EXTERNAL_STORAGE) {
      p.$["android:maxSdkVersion"] = "32";
    }
  }
}

function withGalleryMediaPermissions(config) {
  config = AndroidConfig.Permissions.withPermissions(config, [
    READ_MEDIA_IMAGES,
    READ_MEDIA_VIDEO,
    READ_MEDIA_AUDIO,
    READ_MEDIA_VISUAL_USER_SELECTED,
  ]);

  return withAndroidManifest(config, (cfg) => {
    capLegacyExternalStorage(cfg.modResults);
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$["android:requestLegacyExternalStorage"] = "true";
    return cfg;
  });
}

module.exports = withGalleryMediaPermissions;
