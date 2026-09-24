export type BleTaxiPeer = {
  /** ID public Blyp, ex. BLYP-U-7KQ9XM2A4B */
  accountId: string;
  /** 9 chiffres locaux (6XXXXXXXX), sans indicatif. */
  phoneDigits: string;
  displayName: string;
  rssi: number;
  lastSeenAt: number;
};

export type BlePermissionStatus =
  | "granted"
  | "denied"
  | "blocked"
  | "unavailable";

export type BleScanStatus =
  | "idle"
  | "starting"
  | "scanning"
  | "denied"
  | "powered_off"
  | "unavailable"
  | "error";

export type BleAdvertiseStatus =
  | "idle"
  | "broadcasting"
  | "denied"
  | "powered_off"
  | "unavailable"
  | "error";
