export type MerchantReceiptCategory = "manual" | "shop" | "service";

export type MerchantReceipt = {
  id: string;
  accountId: string;
  name: string;
  merchantName: string | null;
  category: MerchantReceiptCategory;
  localUri: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
};
