# Paiement hors ligne (référence — hors bundle app)

Code **non compilé** par Metro. Réintégration future :

1. Restaurer file SQLite `offline_queue` + PIN SecureStore par op (`blyp.offline.pay.pin.{id}`).
2. UI `PayOutcomeSheet` : kinds `offline_offer` / `offline_queued`.
3. `RealtimeSync` : drain après `syncTransactionsFromNetwork`.

Les sources TypeScript d’origine étaient dans `paymentQueue` + `paymentDrain` (enqueue type `pay`, rejeu `api.pay`).

Clés i18n conservées : `pay.offlineOffer*`, `pay.offlineQueue*`, `pay.offlineQueued*`.
