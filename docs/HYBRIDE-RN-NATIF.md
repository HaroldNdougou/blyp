# Blyp — stratégie hybride (React Native + natif + infra)

Document de référence pour l’équipe et les agents Cursor.  
Complète `docs/ARCHITECTURE-CIBLE.md`, `blyp-perf-light.mdc` et `blyp-architecture-cible.mdc`.

**Objectif** : viser une réactivité perçue **WhatsApp / Telegram** sur wallet + messagerie, sans réécrire toute l’app en natif — **RN pour le produit**, **natif pour les moteurs**, **infra pour le réseau invisible**, **tuning continu** pour ne pas régresser.

---

## 1. Principe directeur

| Couche | Rôle |
|--------|------|
| **React Native (Expo)** | Écrans, navigation, business, i18n, thème, cache-first, UI optimiste |
| **Natif (modules ciblés)** | Chemins où le doigt ou l’oreille sentent le lag (&lt; 100 ms, scroll/gesture continu, decode média) |
| **Infra AWS** | Delta sync, push → cache, médias CDN, idempotence wallet, région Afrique |
| **Tuning continu** | Budgets mesurés sur appareil réel, revue PR, pas de « polish plus tard » |

**Ce que l’hybride n’est pas** : refonte Kotlin/Swift complète ; empiler des modules natifs sans métriques ; abandonner cache-first en attendant le natif.

---

## 2. Matrice RN vs natif

| Zone | Par défaut | Passer au natif si… | Exemples Blyp |
|------|------------|---------------------|---------------|
| Pay, solde, historique formaté | **RN** | Jank persistant après cache + memo + skip setState | `historyUiCache`, `transactionsCache` |
| Profil, réglages, register | **RN** | Rarement | — |
| Liste conversations | **RN** | Scroll jank avec 500+ lignes malgré FlashList | Prefetch fil au `onPressIn` |
| **Fil de chat** (scroll inversé) | **RN** (RNGH + Reanimated) | Swipe / long-press / scroll encore conflictuels après 2 itérations | `SwipeToReplyWrap`, `threadPullGate` |
| Voix (record / play / waveform) | **Lib native** | Latence buffer, background | Modules audio existants |
| Images chat | **RN** (`expo-image` + CDN) | Decode massif sur fil long | Cache disque, tailles fixes |
| Documents / PDF | **Hybride** | Thumb + page count : natif (`pdf-thumbnail`) ; open : Intent Android | `lib/document/*` |
| BLE / taxi / radio | **Natif** | Timing radio, OS | `lib/ble/*` |
| Keypad montant / PIN | **RN léger** | Re-render ou latence clavier custom | Glyphes Views, pas Ionicons sur chemin critique |

**Règle de décision** :  
1. Appliquer d’abord `blyp-perf-light.mdc` (cache, defer réseau, prefetch).  
2. Mesurer sur **Redmi 9C** (`lib/perf/marks.ts` + ressenti).  
3. Si le hotspot reste → **ticket module natif minimal** (une liste, un player), pas « refaire Messages ».

---

## 3. Infra (réseau invisible)

Ordre aligné avec l’architecture cible :

1. **Téléphone** — SQLite/MMKV, snapshots RAM, lignes UI préformatées, file offline ; **l’écran lit le cache**, pas l’API.
2. **API** — Réponses petites ; pagination / delta ; pas de full refetch au focus ; idempotence sur crédit/débit et envois.
3. **Push + realtime** — Mettre à jour le cache **avant** l’ouverture d’écran ; HTTP = filet (gates type `threadPullGate`), pas moteur principal.
4. **Médias** — S3 + CloudFront ; **fichier + thumb séparés** (modèle WhatsApp pour docs) ; pas de gros binaire pour une preview.
5. **Observabilité** — Latence **par action utilisateur** (ouvrir fil, envoyer, swipe), P50/P95, alarmes région `af-south-1`.

Sans (3) et (4), le natif ne compense pas un refetch systématique.

---

## 4. Budgets perçus (cibles produit)

Mesures de référence sur **appareil physique** (pas émulateur). En `__DEV__`, utiliser `lib/perf/marks.ts`.

| Action | Cible (avec cache chaud) |
|--------|---------------------------|
| Clic onglet Historique / Messages | Liste visible **immédiate** (RAM) ; spinner **interdit** si snapshot existe |
| Clic conversation → fil | 1er frame avec messages cache ; pas d’`await` réseau avant paint |
| Long-press message | Haptic + sélection &lt; **~150 ms** (`CHAT_LONG_PRESS_MS` + pas de travail JS lourd sur le chemin) |
| Swipe reply | Gesture fluide ; haptic au seuil ; pas de conflit avec scroll |
| Envoi texte | Bulle optimiste **au tap** ; rollback si échec |
| Ouverture doc (thumb en cache) | Preview sans télécharger le PDF entier |

Régression sur un budget = **bug bloquant** (même priorité que `blyp-perf-light.mdc`).

---

## 5. Tuning continu (process)

**Blyp accumule des features** : la vitesse ne se négocie pas à chaque ajout. Contrat obligatoire **cache · defer · gates** — `.cursor/rules/blyp-feature-gates.mdc` + **`docs/CHECKLIST-NOUVELLE-FEATURE.md`**.

### Chaque feature touchant listes, gestes ou réseau

- [ ] Cache-first : affichage RAM/SQLite avant tout `await` API  
- [ ] Focus : sync réseau après `InteractionManager` si données déjà affichées  
- [ ] Skip `setState` si snapshot inchangé (référence ou égalité métier)  
- [ ] Prefetch du parcours probable depuis Pay (1er frame)  
- [ ] Marks perf sur ouvertures critiques  
- [ ] Thème + i18n  

### Revue PR (checklist courte)

- Pas de `useFocusEffect` qui refetch sans gate ni cache  
- Pas de decode PDF / gros JSON sur le thread UI au focus  
- Gestes : RNGH + `Gesture.Native()` si pan + long-press sur même zone  
- Nouveau module natif : justification **métrique** dans la PR  

### Release / profiling Android

Parcours à profiler avant montée en charge :

1. Cold start → Pay  
2. Pay → Messages → ouvrir fil → scroll 200+ messages  
3. Swipe reply + long-press + envoi image/doc/voix  
4. Historique + détail reçu  

---

## 6. Ordre d’exécution recommandé

1. **Discipline globale** — cache-first, defer réseau, gates pull, prefetch (`aggressiveWarm`, `eagerRoutes`).  
2. **Push / realtime → cache** — réduire la dépendance au pull HTTP.  
3. **Profiler le fil** sur Redmi — identifier le hotspot #1.  
4. **Natif chirurgical** sur ce hotspot uniquement.  
5. **Infra** en parallèle — delta tx, thumbs CDN, alarmes latence API.

---

## 7. Liens repo

| Fichier | Rôle |
|---------|------|
| `.cursor/rules/blyp-hybrid-native.mdc` | Règle agent (résumé + matrice) |
| `.cursor/rules/blyp-perf-light.mdc` | Discipline quotidienne vitesse |
| `docs/ARCHITECTURE-CIBLE.md` | Vision AWS + caches serveur |
| `lib/perf/marks.ts` | Marks dev |
| `lib/perf/aggressiveWarm.ts` | Prefetch post–1er frame Pay |
| `docs/CHECKLIST-NOUVELLE-FEATURE.md` | Checklist merge par feature |
| `.cursor/rules/blyp-feature-gates.mdc` | Surveillance agents (alwaysApply) |

---

## 8. Phrase pour reprendre une session

> « Hybride Blyp : RN + cache-first partout ; natif seulement sur hotspot mesuré ; infra push/delta/CDN. Voir `docs/HYBRIDE-RN-NATIF.md` et `blyp-hybrid-native.mdc`. »

---

*Charte validée en session produit — stratégie long terme, pas un one-shot pré-release.*
