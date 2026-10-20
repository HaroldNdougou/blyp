/**
 * Import statique — évite `import()` + inlineRequires (Metro « unknown module 2024 »).
 */
import * as ImagePicker from "expo-image-picker";

export type PickedImage = {
  uri: string;
  width: number;
  height: number;
  contentType: string;
};

const SELECTION_LIMIT = 10;

let cachedLibraryGranted: boolean | null = null;
let cachedCameraGranted: boolean | null = null;

/** Lecture seule — pas de prompt ; à appeler en fond (liste / thread). */
export async function warmImageLibraryPermission(): Promise<void> {
  try {
    const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    cachedLibraryGranted = perm.granted;
  } catch {
    cachedLibraryGranted = null;
  }
}

export async function requestImageLibraryPermission(): Promise<boolean> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  cachedLibraryGranted = perm.granted;
  return perm.granted;
}

/** Prompt seulement si nécessaire ; évite un round-trip si déjà accordé. */
export async function ensureImageLibraryPermission(): Promise<boolean> {
  if (cachedLibraryGranted === true) return true;
  try {
    const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (perm.granted) {
      cachedLibraryGranted = true;
      return true;
    }
  } catch {
    /* demande classique */
  }
  return requestImageLibraryPermission();
}

export async function ensureCameraPermission(): Promise<boolean> {
  if (cachedCameraGranted === true) return true;
  try {
    const perm = await ImagePicker.getCameraPermissionsAsync();
    if (perm.granted) {
      cachedCameraGranted = true;
      return true;
    }
  } catch {
    /* demande classique */
  }
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  cachedCameraGranted = perm.granted;
  return perm.granted;
}

/** Une photo prise sur le vif — même format que la galerie pour l’envoi chat. */
export async function pickImageFromCamera(): Promise<PickedImage | null> {
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    quality: 0.85,
    exif: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const uri = String(asset.uri ?? "").trim();
  if (!uri) return null;
  return {
    uri,
    width: Math.max(0, Math.floor(Number(asset.width) || 0)),
    height: Math.max(0, Math.floor(Number(asset.height) || 0)),
    contentType: String(asset.mimeType ?? "").trim() || "image/jpeg",
  };
}

export async function pickImagesFromLibrary(): Promise<PickedImage[] | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: SELECTION_LIMIT,
    quality: 0.85,
    exif: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  const out: PickedImage[] = [];
  for (const asset of result.assets) {
    const uri = String(asset.uri ?? "").trim();
    if (!uri) continue;
    out.push({
      uri,
      width: Math.max(0, Math.floor(Number(asset.width) || 0)),
      height: Math.max(0, Math.floor(Number(asset.height) || 0)),
      contentType: String(asset.mimeType ?? "").trim() || "image/jpeg",
    });
  }
  return out.length > 0 ? out : null;
}
