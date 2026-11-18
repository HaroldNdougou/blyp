# Blyp — client natif (cible produit)

Document de référence pour l’équipe et les agents Cursor.  
Remplace la posture « RN = coquille produit » de **`docs/HYBRIDE-RN-NATIF.md`** pour le **parcours cible**.  
Infra inchangée : **`docs/ARCHITECTURE-CIBLE.md`**, **`blyp-architecture-cible.mdc`**.

**Décision produit** : l’app utilisateur finit en **UI nativa** (Android puis iOS), pas en écrans React Native.  
**Exception v1** : **Messages (liste + fil)** reste en RN le temps de la migration — trop lourd à réécrire en premier.

---

## 1. Vision

| Avant (hybride) | Cible |
|-----------------|--------|
| Expo/RN = tous les écrans | **Kotlin / Swift** = écrans + navigation + métier UI |
| Natif = modules chirurgicaux | Natif = **produit** ; RN = **îlot temporaire Messages** |
| Handoff cold start → JS | Launcher + Pay **100 % natifs** sans handoff clavier |

Discipline **cache-first · defer · gates** reste valide en natif (`blyp-perf-light.mdc`, `blyp-feature-gates.mdc`).

---

## 2. Périmètre v1 (sans Messages)

### Inclus (natif Android en priorité — Redmi 9C)

- **Shell** : `MainActivity` natif, tabs, thème clair/sombre (système), i18n FR/EN.
- **Auth** : session, SecureStore équivalent, register overlay / flux inscription.
- **Pay** : keypad, destinataire, PIN, optimiste, BLE/cashier si déjà branché côté natif.
- **Historique** : liste cache-first, lignes préformatées (équivalent `historyUiCache`).
- **Profil** + réglages essentiels.
- **Dépôt** + parcours wallet liés au quotidien Pay.
- **Quick pay notif** + annonces paiement (modules `native-android/quick-pay-notif`, `payment-announce`).
- **Moteur local** : SQLite + sync delta tx/wallet + file offline (port des contrats `lib/sync/*`, `lib/offline/*`).
- **Realtime wallet** : WS binaire (`BlypWsFrame`, hub unique) — moteur déjà amorcé dans `native-android/realtime-engine`.

### Exclus v1 (reste RN)

- **Messages** : liste conversations, fil chat, pièces jointes, voix, swipe reply, typing/presence UI.
- Intégration v1 : **un seul écran / activité RN** (ou fragment) ouvert depuis la tab bar native — pas de réécriture du fil.

### Phase 2+ (après v1 stable)

- Fil + liste Messages natifs (ou liste native + fil RN intermédiaire).
- Retrait complet Expo / Hermes du parcours utilisateur.
- **iOS** : même périmètre, après Android quotidien validé.

---

## 3. Architecture client cible

```
┌─────────────────────────────────────────┐
│  App native (Android v1)                │
│  Compose / Views — tabs Pay · Hist · Prof │
│  + SQLite + sync + offline + WS wallet    │
└─────────────────┬───────────────────────┘
                  │ tab Messages (v1)
                  ▼
┌─────────────────────────────────────────┐
│  Îlot RN (Expo) — Messages uniquement   │
│  Réutilise lib/messages*, cache, hub chat│
└─────────────────────────────────────────┘
                  │
                  ▼
            API Gateway / WS (inchangé)
```

**Règle** : pas de **nouvelles** features produit lourdes en RN hors Messages tant que v1 natif n’est pas livré.

---

## 4. Réutilisation du repo actuel

| Existant | Usage migration |
|----------|-----------------|
| `aws/` | Contrats API, WS, Lambdas — source de vérité |
| `lib/realtime/blypWsFrame.ts` | Spec frames → `BlypWsFrame.kt` (déjà) |
| `native-android/*` | Briques : cold-start, realtime, BLE, quick pay, push |
| `app/(tabs)/pay`, historique, profil | **Spec UX + logique** à porter, pas à prolonger indéfiniment |
| `app/(tabs)/messages`, chat | **Seul code RN maintenu** en v1 |

---

## 5. Ordre de travail (Android-first)

1. **Projet shell natif** : navigation, thème, i18n, auth gate (sans RN au cold start Pay).
2. **Couche données** : SQLite schéma aligné app RN + sync tx + offline queue (API identiques).
3. **Pay + Historique + Profil** écrans natifs branchés sur la couche données.
4. **WS wallet** natif (étendre `realtime-engine`) ; push → cache local.
5. **Tab Messages** → lance l’îlot RN existant (bridge tokens / userId).
6. **Retrait progressif** du RN sur Pay/Historique/Profil dans le build release.
7. **Phase 2** : Messages natif — plan séparé (`docs/VOICE-MESSAGES.md` reste réf. métier).

---

## 6. Critères « v1 livrée »

- Cold start : Pay **interactif natif** sans handoff clavier obligatoire vers JS.
- Parcours Pay → PIN → succès avec cache offline et idempotence inchangés côté API.
- Historique + Profil natifs : **pas de spinner** si snapshot SQLite/RAM présent.
- Messages : ouverture depuis tab native ≤ perf actuelle (îlot RN acceptable).
- Mesures Redmi 9C : budgets `blyp-perf-light` ; logs **`BlypPerf`** en debug (`shell_open`, `commerce_open`, `soa_car_open`, `history_open`, `messages_handoff`).

### Smoke Redmi 9C (`EXPO_PUBLIC_NATIVE_SHELL=1`)

1. Profil → déconnexion : retour login natif, BLE/WS arrêtés (pas d’écran RN sign-out).
2. Commerce switch : appui long sur un commerce → changement de type ; mode pro → encaissement + flash WS ; **caisse sans connexion** (GATT + file encaissement).
3. Car Soa : grille 18 sièges, **tap siège payé** → détail paiements ; nouvelle course (reset POST).
4. Onglet Historique : liste cache immédiate ; filtrer sent/received ; vérifier `history_open` dans logcat si besoin.
5. Messages : handoff îlot RN depuis tab ; badge non lus **sans Metro** (WS `message_received` + kv_cache reçus).
6. Notif paiement : tap → **coque native** si `EXPO_PUBLIC_NATIVE_SHELL=1`.

---

## 7. Risques assumés

- **Deux stacks UI** temporaires (natif + îlot RN Messages) — discipline stricte sur les frontières.
- **Duplication logique** sync/cache jusqu’à port complet — minimiser en partageant **contrats** (types, endpoints, frames WS).
- **iOS retardé** — accepter Android-only produit v1 si marché prioritaire.

---

## 8. Agents Cursor

- Stratégie active : **`blyp-native-client-target.mdc`**
- Hybride historique : **`blyp-hybrid-native.mdc`** (maintenance RN restant + îlot Messages)
- Perf / gates / thème / i18n : inchangés sur tout code touché (natif ou RN)

---

## 9. Squelette shell (livré)

- Kotlin : `native-android/shell/` — `BlypNativeShellActivity`, placeholders Pay / Historique / Profil, onglet Messages → `MainActivity` (îlot RN `/(tabs)/messages`).
- Plugin : `plugins/withNativeShell.js` — enregistré dans `app.json`.
- **Tester (dev)** : Profil → « Ouvrir la coque native (dev) », puis onglet Messages.
- **Launcher natif** : `EXPO_PUBLIC_NATIVE_SHELL=1` dans `.env` **avant** `npx expo prebuild` / `npx expo run:android` → l’icône ouvre la coque (Pay natif par défaut). Voir `.env.example`.
- **Suite** : remplacer les placeholders par vrais écrans + brancher `ConversationsScreen` sur l’îlot Messages.

### Increment (coque Pay + îlot Messages)

- Onglet **Payer** natif : vrai clavier (`PayShellKeypadFragment`) ; **↑** ouvre Pay RN avec montant repris (`payHomeHandoff`).
- **Messages** : `ConversationsScreen` + routes `chat/[id]`, `new-chat`, `forward`.
- **Historique natif** : lecture SQLite `blyp.db` (cache RN) + gate session (`syncSession` depuis auth).
- **Profil natif** : initiale, nom, téléphone, solde (sync JS) ; déconnexion → app React welcome.
- **Sync delta Historique** : après 1er paint, requête `/transactions?since=…` en Kotlin → SQLite (throttle ~45 s).
- **Pay natif coque** : destinataire BLE + PIN sync JS ; ↑ → biométrie/PIN → `/payments/pay` sans React (sinon handoff Pay RN).
- **Destinataires coque** : liste sync (BLE + dernier mémorisé) ; tap ligne → choix natif ou « Plus dans l’app ».
- **Profil natif** : photo CDN (cache OkHttp) si `avatarUrl` sync.
- **Historique natif** : sections Aujourd’hui / Hier / date + heure sous chaque ligne.
- **Historique natif** : UI alignée React — titre « Transactions », cartes Envoyé/Reçu (filtre toggle), lignes carte + chip type.
- **Pay natif coque / cold start** : overlay aligné Pay RN (destinataire 52, label Montant, montant 50sp + F, touche ronde 64dp, solde au-dessus du pad en coque).
- **Pay natif** : montants rapides **100 / 350 / 500 / 600** ; proches sync (≤3) sous le pad en coque.
- **Historique natif** : tap ligne → fiche détail (type, contrepartie, date, réf.) ; avatar CDN sur envois si `EXPO_PUBLIC_ASSETS_CDN_URL` sync.
- **Historique natif** : pagination **Voir plus** (10 par page) ; détail **plein écran** type reçu RN (+ solde session sync).
- **Pay coque** : tap proche + montant déjà saisi → auth/paiement direct (comme Pay RN).
- **Pay coque** : tap **montant rapide** → paiement direct si destinataire + PIN sync.
- **Pay natif → React** : event `BlypShellPayCompleted` + file d’attente si RN pas encore monté (`NativeShellPayBootstrap` : solde, cache tx, `syncShellPayRuntime`).
- **Destinataire coque** : mémorisé après chaque paiement React ; paiement natif écrit la tx dans SQLite.
- **Proches coque** : lookup `/contacts/blyp-lookup` renvoie `accountId` si inscrit ; JS résout les proches sans BLE (`resolveAccountIdByPhone.ts`).
- **Pay coque** : solde insuffisant → dialogue **Recharger** (handoff `/deposit` RN) avant auth ; idem après échec API.
- **Pay coque** : `no_recipient` / `not_configured` → handoff Pay RN (montant + chiffres conservés).
- **Profil coque** : bouton **Recharger** → dépôt RN ; libellé déconnexion FR/EN.
- **Pay coque** : avatar CDN sur la ligne destinataire ; refresh solde / historique après paiement (`BlypShellUiRefresh`).
- **Pay natif → React** : `recipientAccountId` sur `BlypShellPayCompleted` → `rememberQuickPayRecipient` + sync proches.
- **Handoff dépôt** : coque → `/deposit` RN → fermeture ou succès → `returnToNativeShell` (solde sync JS avant retour).
- **Pay coque** : tap sur la ligne **solde** → dépôt RN.
- **Messages (îlot)** : bouton **Retour** + touche retour Android → coque native (`returnToNativeShell`).
- **Coque** : onglets Pay/Historique/Profil **gardés en mémoire** (show/hide) ; barre statut clair/sombre ; refresh UI au `onResume`.
- **Historique natif** : **tirer pour actualiser** (sync delta immédiate).
- **Pay (îlot RN)** : ouvert depuis coque (« plus dans l’app », handoff) → **Retour** vers coque ; clavier natif + succès paiement → retour haptique.
- **Tab Messages (coque)** : badge **non lus** sync depuis JS (`NativeShellBadgeBootstrap`).
- **Profil natif — Mes reçus** : même badge (compteur reçus non lus JS → `syncReceiptsUnread`).
- **Historique natif** : toast si le pull-to-refresh réseau échoue ; détail transaction suit le **mode sombre** système.
- **Historique détail** : tap **référence** → copie + confirmation courte.
- **Profil coque** : **déconnexion** avec confirmation (FR/EN système).
- **Profil coque** : **Réglages du compte** → écran Profil RN (photo, nom, options) + retour coque ; tap **numéro** → copie.
- **Retour réglages** : refresh profil JS avant retour coque (nom, photo, solde, KYC).
- **Retour dépôt / reçus / documents / KYC** : même refresh automatique avant la coque.
- **Retour Pay / réglages / dépôt** : resync **destinataire + PIN + solde** vers la coque native.
- **Retour Messages** : refresh profil avant la coque.
- **Coque** : barre statut suit le **changement clair/sombre** sans redémarrer l’app.
- **Cold start coque** : session miroir disque (`BlypShellAuthMirror`) — réouverture connectée **sans monter React** si déjà connecté une fois.

### Pay instant salle (commerce)

- **RN Pay / quick pay** : dossier local (`payEligibility`) → UI « payé » + solde/historique optimistes → `POST /payments/pay` en fond (clé idempotence) → reçu signé → GATT caisse (`relayCommercePaymentReceiptBleDeferred`). Échec réseau/5xx : file SecureStore (`pendingInstantPayQueue`) + retry (`InstantPayBootstrap`) ; refus métier : rollback solde + alerte (`pay.instantSettlementFailed`).
- **Coque native** : feedback immédiat (`ShellPayAuthActivity`) puis règlement async ; file chiffrée existante (`BlypShellOfflinePayQueue`) si retry ; en-tête `Idempotency-Key` sur pay coque ; reçu remonté à RN pour BLE si îlot monté.
- **Une seule connexion** : pas deux téléphones connectés en même temps. Nouvelle connexion → popup « l’autre sera déconnecté » → si OK, l’ancien reçoit déconnexion (RN + coque native `ShellSignInActivity`). Coque sans React : 401 session → écran connexion (`BlypShellSessionReplaced`).

- **Pay coque hors ligne** : solde optimiste + file chiffrée + rejeu auto (idempotence API) ; indicateur « X en attente » sous le solde.
- **Recharge native** : `ShellDepositActivity` (MoMo + poll solde) — plus de handoff RN pour le dépôt depuis la coque.
- **Connexion native** : `ShellSignInActivity` — téléphone + OTP WhatsApp (FR/EN), remplacement de session ; nouveaux comptes → `ShellNativeOnboardingActivity` (nom + **photo** + PIN). Comptes existants → **`ShellPinBootstrapActivity`** (PIN local pour Pay sans React). Proches fréquents depuis SQLite + `/contacts/blyp-lookup`. Pont îlot : `consumeShellAuthForJs` (+ `pendingPin` → coffre JS).
- **Déconnexion** : retour écran connexion natif (îlot RN efface la session en arrière-plan).
- **Mes reçus natif** : liste SQLite `merchant_receipts` + ouverture PDF/photo ; bouton **Ajouter** → îlot RN (scan).
- **Mes documents natif** : liste `/vault/documents` + ouverture lien signé.
- **KYC natif** : statut + CTA ; photos / envoi → îlot RN (`ShellKycActivity`).
- **Réglages compte natifs** : nom + photo (`ShellProfileSettingsActivity`).
- **Ajout reçu natif** : photo/fichier + SQLite (`ShellReceiptAddActivity`).
- **KYC capture natif** : recto / verso / selfie + envoi API (`ShellKycCaptureActivity`).
- **Coque** : dialogues + refresh historique **mode sombre** ; fond onglet Pay = fond coque ; strings shell **values-en** complets.
- **Pay coque — destinataire natif** : `ShellPickRecipientActivity` (récents, lookup `/contacts/blyp-lookup`) ; plus de handoff Pay RN pour le parcours perso (montant conservé → auth).
- **Pay coque** : « Plus dans l’app » remplacé par recherche numéro natif.
- **Profil coque** : tap **photo** → réglages du compte.
- **Pay coque** : tap **téléphone destinataire** → copie ; message serveur affiché si paiement refusé.
- **Historique vide** : bouton **Faire un paiement** → onglet Payer ; tap **téléphone** sur le détail → copie.
- **Profil coque** : **Mes reçus** / **Mes documents** natifs ; KYC capture natif.
- **Profil coque** : **Mes commerces** (switch, créer, **appui long** → type PATCH) ; déconnexion **100 % natif** (`BlypShellAuthSignOut`).
- **Pay pro** : `CommerceShellFragment` ou **`SoaCarShellFragment`** (export jour + **`ShellSoaReportActivity`** jour/semaine/mois) ; mode caisse offline miroir **`blyp.offlineCashier.v1`** ; file encaissement **`blyp.pendingReceiptEncash.v1`** + vérif Ed25519 (`BlypShellPaymentReceiptVerify`) + pont RN.
- **Messages** : notif push → `BlypShellDeepLink` (`blyp://chat/…`) → coque native ou `MainActivity` → îlot `/chat/[id]` (`transferId` optionnel).
- **Badges coque** : total Messages persisté `kv_cache` (`messages_unread_total`) + bump WS ; sync JS au retour îlot.
- **Commerce offline UI** : bandeau encaissements en attente + dialogue reçu rejeté (natif).
- **Soa rapport** : liste courses tap → détail période.
- **Perf debug** : `BlypShellPerfMarks` (`shell_open`, `commerce_open`, `soa_car_open`, `messages_handoff`).
- **Coque** : inscription **incomplète** → `ShellNativeOnboardingActivity` (plus welcome RN).
- **Pay coque** : bandeau vert **« Paiement envoyé »** ~3 s après succès natif.
- **Historique détail** : bouton **Partager** (SMS, WhatsApp, etc.).
