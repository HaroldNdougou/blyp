/**
 * Le scan / la popup permission BLE ne vivent que sur Pay (onglet focus).
 * Messages, Historique, chat : pas de demande, pas de scan.
 */

let payFocused = false;

export function setPayScanFocused(on: boolean): void {
  payFocused = on;
}

export function isPayScanFocused(): boolean {
  return payFocused;
}
