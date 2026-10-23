# Checklist perf — Redmi 9C (~3 min)

Appareil de référence : **Redmi 9C**, USB, **pas d’émulateur**.  
Objectif : valider la fluidité « WhatsApp-like » après changements messagerie / perf.

---

## Préparation (une fois par session)

- [ ] `npm run metro:usb` (reverse 8081)
- [ ] App **dev client** installée (`expo run:android` si besoin)
- [ ] Metro : `npm run start:clean` (ou `npx expo start -c` si tu préfères)
- [ ] Compte connecté, **cache chaud** : ouvrir Messages une fois, revenir Pay, puis lancer les tests
- [ ] Console Metro visible : les marks `[perf] …` s’affichent en **`__DEV__`**

**Note** : le dev (Metro, HMR) est plus lent que la **release**. Un lag uniquement en dev ≠ régression prod ; refaire les points critiques en build release si doute.

**Metro Windows (dev)** : `devMetroLite` coupe prefetch + repousse ~45 s : contacts, push/notifications, BLE, WS, `api/client` (auth/sync), outboxes. Liste Messages : pas de sync réseau si cache RAM. Fil chat : bundle seulement au clic. Cache : `node_modules/.cache/metro`. Redémarrer Metro après `metro.config.js`. `EMFILE` → `BLYP_METRO_WORKERS=1`.

**Release Redmi** (comparer `chunk` / `chat_open`) : `npx expo run:android --variant release` (USB), puis même scénario B — les marks `[perf]` sont absents hors `__DEV__` ; juger à l’œil + éventuellement `adb logcat` si tu ajoutes un profil staging.

---

## Budgets indicatifs (cache chaud, `__DEV__`)

| Mark | Déclencheur | Cible perçue | Log `[perf]` |
|------|-------------|--------------|--------------|
| `tab_messages` | Focus onglet Messages | Pas de spinner si liste déjà visitée | &lt; 80 ms |
| `chat_open` | `onPressIn` liste → 1er paint fil | Transition + header/composer **immédiats** ; pas de freeze au clic | &lt; 120 ms jusqu’au 1er paint fil (messages RAM ou vides OK) |
| `history_open` | Focus Historique | Liste cache instantanée | &lt; 100 ms |
| `pay_home_open` | Focus Pay | Inchangé (référence) | &lt; 80 ms |

`chat_open` : `markChatOpenOnNavigate` au **`router.push`** (pas au `pressIn` — sinon ~400 ms « fantômes » doigt enfoncé). Prefetch reste sur `onPressIn`. `perfMarkEnd` quand le fil a peint (`ChatThreadScreenBody`).

### Lire les sous-étapes `chat_open→…` (ordre typique)

| Lap | Signification | Si c’est gros (~300 ms+) |
|-----|----------------|---------------------------|
| `chunk` | Fin du `import()` **entrée** `ChatThreadScreen` (coquille + Suspense) | Doit être **bas** ; sinon Metro bloqué sur l’ancien monolithe |
| `inner_chunk` | Chunk `ChatThreadScreenBody` (fil complet) | Gros mais **après** shell ; prefetch `onPressIn` + `eagerRoutes` |
| `inner_module_parsed` | Parse du body (imports liste / live / FlashList…) | Pay/voice/attach/emoji en chunks **séparés** (`chatThreadDeferredUi`) |
| `sqlite` | Fin hydrate SQLite tail (40 msgs) | I/O disque ; doit être **après** paint (`runAfterPaint`) |
| `route_layout` | Route `app/chat/[id]` montée | Navigation / stack |
| `render_start` | 1er render React du fil | Hooks + `createMessagesStyles` + état initial |
| `screen_layout` | `useLayoutEffect` fil | Layout natif header/composer |
| `shell` | +2 frames après mount | Délai volontaire avant fin du mark |
| `list` | FlashList autorisée (`listPaintReady`) | |
| `list_model` | Recalcul modèle liste (dates, types FlashList) | Beaucoup de messages en RAM d’un coup |
| `chat_open: Nms` | Total clic → fin budget | |

**Écart `chunk` → `render_start`** : surtout **animation stack** (désactivée via `lib/perf/instantMotion.ts` : `animation: none` sur fil, register, défaut stack).

**Motion** : `INSTANT_MOTION` = stack + modales RN + pastille onglet sans Reanimated (~470 ms économisés au changement d’onglet).  
**Écart `render_start` → `shell`** : coût du premier render (gros arbre JSX) + 2 `rAF`.

---

## Scénarios (cocher)

### A. Onglets (mémoire vivante)

- [ ] Messages → Pay → Messages : **aucun** rechargement visible type « écran vide » si la liste était déjà là
- [ ] Pay → Historique → Pay : idem
- [ ] Changement d’onglet : **pas** de saccade &gt; 1 frame perceptible

### B. Ouverture discussion (zéro blocage au clic)

- [ ] Sur une conv **déjà en cache** : tap → **navigation tout de suite** (pas d’attente SQLite avant l’écran)
- [ ] Header (nom, avatar) visible **avant** que tout l’historique soit peint
- [ ] Conv **jamais ouverte** : shell fil + composer tout de suite ; messages arrivent après (pas plein écran spinner)
- [ ] `onPressIn` : log `[perf] chat_open: …ms` raisonnable

### C. Fil long (scroll)

- [ ] Conv avec **beaucoup** de messages (ou simuler en remontant) : scroll vers le haut **sans** freeze prolongé
- [ ] Remonter déclenche chargement par paquets (fenêtre UI + `before` API si besoin) : pas de trou blanc de plusieurs secondes
- [ ] Revenir en bas (pill / scroll) : instantané

### D. Photos (thumb → HD)

- [ ] **Nouvelle** photo envoyée : bulle tout de suite ; upload en arrière-plan
- [ ] Photo **reçue** (après deploy messaging) : flou / miniature puis HD sans gros saut blanc
- [ ] Réouvrir le fil : image en cache **expo-image** (`memory-disk`) → affichage quasi immédiat

### E. Gestes & réseau

- [ ] Swipe droite → répondre : réaction sans bloquer le scroll vertical
- [ ] Hors ligne : bandeau discret ; message texte avec horloge ; pas de gros bandeau rouge
- [ ] Pay après erreur réseau : sheet « payer hors ligne ? » (pas échec silencieux)

---

## Si échec : où regarder

1. **Clic conv lent** : `ConversationsScreen.openChat` attend-il encore quelque chose avant `router.push` ? Prefetch `onPressIn` ?
2. **Fil lag au focus** : refetch full au focus, `setState` inutile, parse SQLite sur le thread JS ?
3. **Scroll** : travail O(n) sur tout le tableau au render ; fenêtre FlashList ; pagination API
4. **Images** : 12 MP non compressées ; thumb/blurhash manquants côté serveur (anciens messages)

Références : `blyp-perf-light.mdc`, `blyp-feature-gates.mdc`, `docs/HYBRIDE-RN-NATIF.md`.

---

## Architecture « UI / logique lourde » (rappel)

| Zone | Implémentation Blyp |
|------|------------------------|
| Scroll fil | FlashList + fenêtre 20 + API `limit` / `before` |
| Liste conversations | FlashList |
| SQLite fil | **Tail** (`THREAD_SQLITE_TAIL`) puis historique complet en `runAfterPaint` |
| Images | Compression + thumb S3 + blurhash ; `expo-image` `memory-disk` |
| Gestes / menus | Reanimated (`SwipeToReplyWrap`) + stack native chat |
| Appels vidéo | **Hors scope** — WebRTC natif si un jour VoIP (voir `HYBRIDE-RN-NATIF.md`) |

---

## Après une grosse PR perf

- [ ] Cette checklist sur **Redmi 9C**
- [ ] Optionnel : **release** build + mêmes scénarios B et C
- [ ] AWS messaging déployé si thumbs / pagination API touchés
