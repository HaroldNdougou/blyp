let active = false;

export function isCommerceReceiptScanActive(): boolean {
  return active;
}

export function setCommerceReceiptScanActive(on: boolean): void {
  active = on;
}
