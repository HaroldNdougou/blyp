/** Scan BLE autorisé pour la notif rapide (hors focus Pay). */
let wanted = false;

export function setQuickPayBleScanWanted(on: boolean): void {
  wanted = on;
}

export function isQuickPayBleScanActive(): boolean {
  return wanted;
}
