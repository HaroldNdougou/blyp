import {
  confirmVaultDocument,
  presignVaultDocument,
} from "@/lib/api/client";
import { uploadDocumentFile } from "@/lib/document/upload";

export async function uploadVaultDocument(
  token: string,
  input: {
    name: string;
    localUri: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  },
): Promise<import("@/lib/api/types").VaultDocument> {
  const presign = await presignVaultDocument(token, {
    name: input.name,
    fileName: input.fileName,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });
  if (presign.uploadUrl.startsWith("mock://")) {
    const mock = await import("@/lib/api/mockBackend");
    mock.mockStageVaultLocalUri(presign.docId, input.localUri);
  } else {
    await uploadDocumentFile(
      presign.uploadUrl,
      input.localUri,
      presign.contentType,
    );
  }
  const { document } = await confirmVaultDocument(token, {
    docId: presign.docId,
    key: presign.key,
    name: input.name,
    sizeBytes: input.sizeBytes,
    contentType: presign.contentType,
  });
  return document;
}
