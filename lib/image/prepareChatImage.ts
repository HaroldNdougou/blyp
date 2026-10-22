/** Compression + BlurHash avant envoi chat (hors chemin Pay). */

import { encode } from "blurhash";
import {
  manipulateAsync,
  SaveFormat,
} from "expo-image-manipulator";
import jpeg from "jpeg-js";
import FS from "@/lib/voice/fileSystemLegacy";

const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.82;
const BLUR_COMPONENTS_X = 4;
const BLUR_COMPONENTS_Y = 3;
const BLUR_THUMB_WIDTH = 32;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function encodeBlurhashFromUri(uri: string): Promise<string | null> {
  try {
    const thumb = await manipulateAsync(
      uri,
      [{ resize: { width: BLUR_THUMB_WIDTH } }],
      { compress: 0.65, format: SaveFormat.JPEG },
    );
    const b64 = await FS.readAsStringAsync(thumb.uri, {
      encoding: FS.EncodingType.Base64,
    });
    const decoded = jpeg.decode(base64ToBytes(b64), { useTArray: true });
    if (!decoded?.data || decoded.width <= 0 || decoded.height <= 0) {
      return null;
    }
    const pixels = new Uint8ClampedArray(decoded.data.buffer);
    return encode(
      pixels,
      decoded.width,
      decoded.height,
      BLUR_COMPONENTS_X,
      BLUR_COMPONENTS_Y,
    );
  } catch {
    return null;
  }
}

const THUMB_EDGE_PX = 64;

export type PreparedChatImage = {
  uri: string;
  thumbUri: string;
  width: number;
  height: number;
  contentType: string;
  blurhash: string | null;
};

export async function prepareChatImage(
  localUri: string,
): Promise<PreparedChatImage> {
  const source = String(localUri ?? "").trim();
  if (!source) {
    throw new Error("prepareChatImage: missing uri");
  }
  const resized = await manipulateAsync(
    source,
    [{ resize: { width: MAX_EDGE_PX } }],
    { compress: JPEG_QUALITY, format: SaveFormat.JPEG },
  );
  const thumb = await manipulateAsync(
    resized.uri,
    [{ resize: { width: THUMB_EDGE_PX } }],
    { compress: 0.72, format: SaveFormat.JPEG },
  );
  const blurhash = await encodeBlurhashFromUri(thumb.uri);
  return {
    uri: resized.uri,
    thumbUri: thumb.uri,
    width: Math.max(1, Math.floor(resized.width || 0)),
    height: Math.max(1, Math.floor(resized.height || 0)),
    contentType: "image/jpeg",
    blurhash,
  };
}
