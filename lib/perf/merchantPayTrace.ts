export type { MerchantPayRxSource } from "./merchantPayTrace.types";

type MerchantPayTraceModule = typeof import("./merchantPayTrace.dev");

const merchantPayTrace: MerchantPayTraceModule = __DEV__
  ? require("./merchantPayTrace.dev")
  : require("./merchantPayTrace.stub");

export const merchantPayRx = merchantPayTrace.merchantPayRx;
export const merchantPayApplied = merchantPayTrace.merchantPayApplied;
export const merchantPayVoiceDone = merchantPayTrace.merchantPayVoiceDone;
export const merchantPayUiFlash = merchantPayTrace.merchantPayUiFlash;
