# Blyp — messages vocaux (plan figé)

**Ne pas implémenter** tant que ce n’est pas demandé explicitement.  
Quand on s’y met : **partir de ce fichier**, pas réinventer.

Décidé en session (2026-09-25). Cœur produit = payer vite ; le vocal est un **wow / demande users**, pas le jour 1.

---

## Pourquoi pas tout de suite

- Chat déjà là : texte, Message Money, ticks WhatsApp, notif, `delivered` app tuée.
- Infra media **absente** : ce n’est pas un après-midi.
- Sans S3 media, on construit de l’infra pour un usage encore petit.

**Quand le faire** : les gens demandent de parler dans le fil, ou démo investisseur et 2–3 jours acceptés.

---

## UX V1 (comme WhatsApp, réduit)

- Micro à la place d’envoyer si le champ texte est vide.
- **Un tap** = enregistrement (pas de maintien, pas de glisser).
- Pendant le rec : pause / reprise, poubelle, **enveloppe** pour envoyer.
- Bulle **optimiste** tout de suite (fichier déjà sur le téléphone).
- Bulle : durée + barre simple + play/pause (**un seul** son à la fois).
- Mêmes ticks que le texte (1 grise / 2 grises / 2 bleues).
- Cache fichier local après première écoute.

**Hors V1** : lock, transcription, 2×, waveform live, réactions.

---

## Perf (non négociable)

- **Zéro** impact Pay / splash / onglets.
- `expo-av` + micro : **import à la demande** dans le fil seulement (ChatThread déjà lazy).
- Pas de waveform calculée au scroll (barres fixes ou pics précalculés).
- Permission micro **au geste**, jamais au splash (MIUI / Redmi).
- Pause vocal si annonce paiement TTS.
- Hors-ligne : file d’attente comme un texte.

Le clic reste instantané. Le lourd (encode, upload, play) = seulement record / play.

---

## S3 — état actuel (2026-09-25)

**Pas de seau media / assets déployé pour Blyp.**

| Ce qui existe | Rôle |
|---|---|
| `infra/template.yaml` | API, Lambdas, Dynamo — **pas de Bucket assets/media** |
| `infra/assets-cdn.snippet.yaml` | **Brouillon** CDN images (avatars). **Pas collé, pas déployé** |
| `lib/assets/cdn.ts` | Prêt si `EXPO_PUBLIC_ASSETS_CDN_URL` un jour |
| Seau `aws-sam-cli-managed-…` | Zips **Lambda** SAM. **Pas** les fichiers users |

Compte AWS **peut** faire du S3. Produit : **pas encore**.

---

## Deux seaux (ne pas mélanger)

Région : **`af-south-1`**. Privés, chiffrés (SSE-S3 ou KMS). Pas de listing public.

| Seau | Contenu | Accès |
|---|---|---|
| `blyp-assets` (snippet existant) | logos, avatars | CloudFront, cacheable |
| `blyp-media` (**à créer**) | vocaux | **Coffre** : URLs **signées**, courte durée |

Vocaux **jamais** sur le CDN assets ouvert.  
L’app **n’a aucune clé AWS**. Seule la Lambda messaging signe.

---

## Flux (audio hors Lambda / hors Dynamo)

```
Record (tel envoyeur)
  → bulle locale tout de suite
  → POST API « je veux uploader » → URL signée PUT (5 min)
  → PUT direct S3  media/{userId}/{conversationId}/{id}.m4a
  → POST message { type: "voice", key, durationMs }
  → push message_received (comme aujourd’hui, sans le fichier)

Écoute
  → GET API → URL signée GET (5–15 min) ou CloudFront signé
  → download + cache tel
  → play expo-av
```

Dynamo = **clé + durée** seulement.  
Push = pas d’audio dans le payload.

**IAM** : Lambda `s3:PutObject` / `s3:GetObject` uniquement pour **signer**.  
**Lifecycle** : supprimer ou Glacier après **90 jours**.  
**Limites V1** : 60 s, 1–2 Mo ; Lambda refuse au-delà.  
**Alarme** : taille du seau > X Go.

CloudFront devant `blyp-media` **seulement** avec URL/cookie signé.

Routes à ajouter (piggyback messaging, pas de monolithe) :  
`presign-put` / `presign-get` (noms à caler sur le style actuel `/conversations/...`).

---

## Coût (rappel, ordre de grandeur)

Vocal ~12 s AAC ≈ **35 Ko**. CloudFront : **1 To/mois offert** (à confirmer compte).

| Users vocaux | Facture media / mois (pilote, 90 j, AAC) |
|---|---|
| 5k–20k | ~$5–20 |
| 50k | ~$40–50 |
| 100k | ~$80–90 |
| 100k × 10 vocaux/j | ~$150–250 |

Ce qui explose : WAV, pas de max durée, tout garder des années.  
WhatsApp : Opus + infra Meta (pas le tarif public AWS). Blyp = tarif liste → petits fichiers + purge.

---

## Stack app à réutiliser

- Composer : `components/messages/ChatThreadScreen.tsx`
- Types message : `lib/api/types.ts` + POST `aws/handlers/messaging` (`text` / `money` / `read` / `delivered` → + `voice`)
- Live / ticks / notif : ne pas casser `conversation_receipt`, `message_received`
- `expo-av` déjà dans le projet (annonce paiement) — **ne pas** l’importer sur le 1er frame Pay
- i18n FR/EN, couleurs via `lib/theme/colors.ts`
- Theme / perf : règles `blyp-theme`, `blyp-perf-light`, `blyp-i18n`

---

## Ordre d’implémentation (quand « oui »)

1. SAM : `MediaBucket` + lifecycle 90 j + IAM Lambda + KMS/SSE.
2. API : presign PUT/GET + `type: "voice"` (validation durée/taille).
3. App : micro, record AAC, upload, bulle optimiste, play, cache disque.
4. Rebuild APK (permission `RECORD_AUDIO`).
5. Pas de commit tant que ce n’est pas demandé.

---

## Phrase pour reprendre

> Vocaux Blyp : lis `docs/VOICE-MESSAGES.md` — S3 media signé, pas le snippet assets, pas Pay/splash, V1 hold-to-record.
