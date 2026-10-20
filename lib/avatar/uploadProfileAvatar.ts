import { confirmProfileAvatar, presignProfileAvatar } from "@/lib/api/client";
import { uploadImageFile } from "@/lib/image/upload";

export async function uploadProfileAvatar(
  token: string,
  localUri: string,
  contentType = "image/jpeg",
): Promise<import("@/lib/api/types").ApiUser> {
  const signed = await presignProfileAvatar(token, contentType);
  if (signed.uploadUrl.startsWith("mock://")) {
    const mock = await import("@/lib/api/mockBackend");
    mock.mockStageAvatarLocalUri(localUri);
  } else {
    await uploadImageFile(signed.uploadUrl, localUri, signed.contentType, {
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  }
  const { user } = await confirmProfileAvatar(token, signed.key);
  return user;
}
