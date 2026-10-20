import {
  confirmKycSubmission,
  presignKycDocument,
} from "@/lib/api/client";
import type { KycDocType, KycDocumentSide } from "@/lib/kyc/types";
import { uploadImageFile } from "@/lib/image/upload";

async function uploadSide(
  token: string,
  docType: KycDocType,
  side: KycDocumentSide,
  localUri: string,
  contentType: string,
): Promise<string> {
  const signed = await presignKycDocument(token, docType, side, contentType);
  if (signed.uploadUrl.startsWith("mock://")) {
    return signed.key;
  }
  await uploadImageFile(signed.uploadUrl, localUri, signed.contentType);
  return signed.key;
}

export async function submitKycApplication(
  token: string,
  input: {
    docType: KycDocType;
    frontUri: string;
    frontContentType: string;
    backUri?: string | null;
    backContentType?: string | null;
    selfieUri: string;
    selfieContentType: string;
  },
): Promise<import("@/lib/api/types").ApiUser> {
  const frontKey = await uploadSide(
    token,
    input.docType,
    "front",
    input.frontUri,
    input.frontContentType,
  );
  let backKey: string | null = null;
  if (input.backUri?.trim()) {
    backKey = await uploadSide(
      token,
      input.docType,
      "back",
      input.backUri,
      input.backContentType ?? "image/jpeg",
    );
  }
  const selfieKey = await uploadSide(
    token,
    input.docType,
    "selfie",
    input.selfieUri,
    input.selfieContentType,
  );
  const { user } = await confirmKycSubmission(token, {
    docType: input.docType,
    frontKey,
    backKey,
    selfieKey,
  });
  return user;
}
