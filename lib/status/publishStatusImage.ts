import type { StatusPost, StatusTextPostStyle } from "@/lib/api/types";
import { normalizeStatusTextPostStyle } from "@/lib/status/textStatusPalette";
import { ApiError, presignStatusUpload, publishStatus } from "@/lib/api/client";
import { prepareChatImage } from "@/lib/image/prepareChatImage";
import { uploadImageFile } from "@/lib/image/upload";

export async function publishStatusImageFromLocalUri(
  token: string,
  localUri: string,
  caption: string | null,
): Promise<StatusPost> {
  const prepared = await prepareChatImage(localUri);
  const signed = await presignStatusUpload(token, prepared.contentType);
  await uploadImageFile(
    signed.uploadUrl,
    prepared.uri,
    signed.contentType,
  );
  const { post } = await publishStatus(token, {
    kind: "image",
    mediaKey: signed.key,
    text: caption,
  });
  if (!post?.id) {
    throw new ApiError("Réponse serveur invalide", 502);
  }
  return post;
}

export async function publishStatusText(
  token: string,
  text: string,
  textStyle: StatusTextPostStyle,
): Promise<StatusPost> {
  const body = String(text ?? "").trim();
  const style = normalizeStatusTextPostStyle(textStyle);
  const { post } = await publishStatus(token, {
    kind: "text",
    text: body,
    textStyle: style,
  });
  if (!post?.id) {
    throw new ApiError("Réponse serveur invalide", 502);
  }
  return post;
}
