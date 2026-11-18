/**
 * Point d’entrée pay trace — impl `.dev` ou stubs selon le build (Metro inline `__DEV__`).
 */
type PayTraceModule = typeof import("./payTrace.dev");

const payTrace: PayTraceModule = __DEV__
  ? require("./payTrace.dev")
  : require("./payTrace.stub");

export const payTraceStart = payTrace.payTraceStart;
export const payTraceLap = payTrace.payTraceLap;
export const payTraceMilestone = payTrace.payTraceMilestone;
export const payTraceAbort = payTrace.payTraceAbort;
export const payTraceLogTxId = payTrace.payTraceLogTxId;
