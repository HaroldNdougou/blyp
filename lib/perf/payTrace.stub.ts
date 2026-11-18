/** Stubs release — aucune logique, bundle minimal. */
export function payTraceStart(_reason: string): void {}

export function payTraceLap(_step: string): void {}

export function payTraceMilestone(_step: string, _keepOpen?: boolean): void {}

export function payTraceAbort(_reason?: string): void {}

export function payTraceLogTxId(_txId: string | null | undefined): void {}
