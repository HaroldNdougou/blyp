import * as ImagePicker from "expo-image-picker";

export type PickedKycPhoto = {
  uri: string;
  contentType: string;
};

export async function pickKycPhotoFromCamera(options?: {
  /** Selfie = caméra avant. */
  selfie?: boolean;
}): Promise<PickedKycPhoto | null> {
  const cam = await ImagePicker.requestCameraPermissionsAsync();
  if (!cam.granted) return null;
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    quality: 0.88,
    exif: false,
    cameraType: options?.selfie
      ? ImagePicker.CameraType.front
      : ImagePicker.CameraType.back,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const uri = String(asset.uri ?? "").trim();
  if (!uri) return null;
  return {
    uri,
    contentType: String(asset.mimeType ?? "").trim() || "image/jpeg",
  };
}
