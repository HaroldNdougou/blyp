# Checklist — nouvelle feature Blyp (vitesse non négociable)

À cocher **avant de merger** toute feature qui touche UI, navigation, listes, réseau ou stockage local.  
Contrat agents : `.cursor/rules/blyp-feature-gates.mdc` (`alwaysApply`).

---

## 1. Cache (affichage immédiat)

- [ ] L’écran / la liste a une **source locale** (RAM snapshot, SQLite, cache dédié).
- [ ] État initial React = **dernière vérité connue**, pas `[]` + spinner si le cache existe.
- [ ] Aucun `await` réseau **avant** le premier rendu utile quand le cache est disponible.
- [ ] Envoi / action utilisateur : **UI optimiste** puis confirmation / rollback.

---

## 2. Defer (réseau et travail lourd après le paint)

- [ ] Sync API au focus : **`InteractionManager.runAfterInteractions`** si l’UI affiche déjà le cache.
- [ ] Modules lourds : **`import()` dynamique** + prefetch sur parcours probable (`onPressIn`, `aggressiveWarm`, `eagerRoutes`).
- [ ] Pas de decode PDF / image massive / gros JSON **sur le chemin du clic** sans defer.
- [ ] Splash **non** bloqué par cette feature (fonts, réseau, SQLite, nouveau chunk).

---

## 3. Gates (pas de refetch bête)

- [ ] Focus : **pas** de full list si delta + cache suffisent.
- [ ] Intervalle ou gate si pull répété (ex. fil messages : `lib/messages/threadPullGate.ts`).
- [ ] Après sync : **`setState` seulement si** données changées (égalité / référence).
- [ ] Push / realtime met à jour le **cache** ; HTTP = filet, pas moteur principal.

---

## 4. Navigation & onglets

- [ ] Nouvel onglet / écran fréquent : enregistré dans le **prefetch** post–1er frame Pay si pertinent.
- [ ] `detachInactiveScreens={false}` respecté pour les onglets déjà en mémoire (pas de démontage agressif sans raison).
- [ ] Retour sur l’écran : **aucun flash** « rechargement » si snapshot identique.

---

## 5. Listes & gestes

- [ ] FlashList (ou équivalent) ; rows **`memo`** ; props stables.
- [ ] Pan + long-press : RNGH, `Gesture.Native()` si conflit swipe / press.
- [ ] Scroll : pas de travail synchrone lourd dans `renderItem`.

---

## 6. Qualité produit transverse

- [ ] Thème : `useTheme()` / `createXStyles(colors)` — pas de hex en dur (`blyp-theme`).
- [ ] Texte UI : `t("…")` FR + EN (`blyp-i18n`).
- [ ] `__DEV__` : mark perf sur ouverture critique (`lib/perf/marks.ts`) si nouvel écran clé.

---

## 7. Test manuel (Redmi 9C, USB)

- [ ] Parcours : ouvrir → quitter → **revenir** : instantané, pas de spinner inutile.
- [ ] Mode avion avec cache : l’écran reste **utilisable** ; erreur réseau en fond.
- [ ] Cold start Pay : inchangé ou meilleur ; pas de régression visible.

---

## 8. Si la feature reste lente après les 3 gates

- [ ] Mesurer (marks + ressenti) ; documenter le hotspot.
- [ ] Envisager **natif chirurgical** — voir `docs/HYBRIDE-RN-NATIF.md` — pas « on optimisera plus tard ».

---

## Phrase de revue

> « Cette feature affiche le cache au clic, sync après transition, et ne refetch pas au focus sans gate. »

Si une case ne peut pas être cochée honnêtement, la feature **n’est pas prête** pour un produit « insolent » sur la vitesse.
