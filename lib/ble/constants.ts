/** Préfixe du nom / payload BLE taxi. */
export const BLYP_BLE_NAME_PREFIX = "BLYP";

/** Service UUID diffusé par l’app (Profil → interrupteur). */
export const BLYP_BLE_SERVICE_UUID =
  "b1b70001-b1b7-4111-8000-00805f9b34fb";

/** Company ID manufacturer (hors registre SIG). */
export const BLYP_BLE_COMPANY_ID = 0x0b1b;

/** Compte démo si payload minimal « BLYP ». */
export const BLYP_BLE_DEMO_ACCOUNT_ID = "BLYP-U-7KQ9XM2A4B";
export const BLYP_BLE_DEMO_PHONE = "698256896";

/**
 * Sans pub depuis tant de ms → pair retiré (selon RSSI — voir selectPeer).
 * Trop court = salon→chambre impossible (trous de scan / murs).
 * Proche = OFF diffusion un peu plus lent mais acceptable.
 */
export const BLYP_PEER_STALE_MS_NEAR = 18_000;
export const BLYP_PEER_STALE_MS_FAR = 45_000;
/** Sous ce RSSI : on garde l’affichage plus longtemps entre deux pubs perdues. */
export const BLYP_PEER_STALE_RSSI_SPLIT = -82;

/**
 * Dernière vue valide : garder le pair à l’écran sur Pay tant que le scan tourne
 * (trous MIUI / murs / ~10 m) même si le sélecteur interne a expiré.
 */
export const BLYP_PEER_UI_HOLD_MS = 55_000;

/** Relance scan Android (MIUI) sans vider la sélection. */
export const BLYP_BLE_SCAN_KICK_MS = 12_000;

/** Seuil très bas : tout signal Blyp valide est capté (pas de filtre « trop loin »). */
export const BLYP_PEER_MIN_RSSI = -110;

/**
 * Un autre taxi ne prend la place que s’il est un peu plus fort (dB).
 * Bas = bascule vite vers le plus proche ; assez pour éviter le flash.
 */
export const BLYP_PEER_RSSI_HYSTERESIS_DB = 3;

/** N’émettre un refresh UI RSSI que si l’écart atteint ce seuil (dB). */
export const BLYP_PEER_RSSI_EMIT_DELTA_DB = 2;

/** Fréquence du prune stale (ms) — court = disparition / reprise plus snappy. */
export const BLYP_PEER_STALE_TICK_MS = 150;

/**
 * Android `ScanMode.LowLatency` — duty cycle max au premier plan.
 * Sans ça, le défaut LowPower retarde fortement le 1er captage.
 */
export const BLYP_BLE_SCAN_MODE_LOW_LATENCY = 2;

/** Android `ScanCallbackType.AllMatches` — chaque pub reportée. */
export const BLYP_BLE_SCAN_CALLBACK_ALL_MATCHES = 1;
