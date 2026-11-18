import type { MerchantPayRxSource } from "./merchantPayTrace.types";

export function merchantPayRx(
  _source: MerchantPayRxSource,
  _txId?: string,
): void {}

export function merchantPayApplied(_txId?: string): void {}

export function merchantPayVoiceDone(_txId?: string): void {}

export function merchantPayUiFlash(_txId?: string): void {}
