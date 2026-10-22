import { PermissionsAndroid, Platform } from "react-native";

const READ_MEDIA_VISUAL_USER_SELECTED =
  "android.permission.READ_MEDIA_VISUAL_USER_SELECTED";

export function androidApiLevel(): number {
  const v = Platform.Version;
  return typeof v === "number" ? v : parseInt(String(v), 10) || 0;
}

/** Déjà accordé (plein accès ou sélection partielle Android 14+). */
export async function androidGalleryImagesAccessGranted(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const api = androidApiLevel();
  try {
    if (api >= 33) {
      if (
        await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
        )
      ) {
        return true;
      }
      if (api >= 34) {
        if (await PermissionsAndroid.check(READ_MEDIA_VISUAL_USER_SELECTED)) {
          return true;
        }
      }
      return false;
    }
    if (api >= 23) {
      return PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
      );
    }
  } catch {
    return false;
  }
  return true;
}

/**
 * Demande runtime Android 13/14+ (READ_MEDIA_IMAGES), comme sur Redmi / HyperOS.
 * À appeler avant CameraRoll.getPhotos ou MediaLibrary.getAssetsAsync.
 */
export async function requestAndroidGalleryImagesPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const api = androidApiLevel();

  try {
    if (api >= 33) {
      if (await androidGalleryImagesAccessGranted()) return true;

      const full = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
      );
      if (full === PermissionsAndroid.RESULTS.GRANTED) return true;

      if (api >= 34) {
        const partial = await PermissionsAndroid.request(
          READ_MEDIA_VISUAL_USER_SELECTED as PermissionsAndroid.Permission,
        );
        if (partial === PermissionsAndroid.RESULTS.GRANTED) return true;
      }
      return false;
    }

    if (api >= 23) {
      const perm = PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
      if (await PermissionsAndroid.check(perm)) return true;
      const res = await PermissionsAndroid.request(perm);
      return res === PermissionsAndroid.RESULTS.GRANTED;
    }
  } catch {
    return false;
  }
  return true;
}
