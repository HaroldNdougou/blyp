# Message Money — archivé (à réactiver plus tard)

Mis de côté pour alléger l’app et stabiliser le **cœur** Blyp (auth, dépôt, pay, historique).  
Le code MVP est conservé ici, prêt à être remis en place.

## Contenu

| Dossier | Contenu |
|---------|---------|
| `frontend/` | Onglet Messages, `chat/[id]`, composants, `messagesCache` |
| `backend/aws/` | `handlers/messaging`, `lib/messaging` (escrow DynamoDB) |
| `backend/infra/messaging-function.snippet.yaml` | Bloc SAM `MessagingFunction` + output ARN |

## API (quand réactivé)

| Method | Path |
|--------|------|
| GET | `/conversations` |
| POST | `/conversations` |
| GET/POST | `/conversations/{id}/messages` |
| POST | `/money-transfers/{id}/claim` |

Préfixes Dynamo : `CONV#`, `MSG#`, `MT#`, `INBOX#`, `PENDING_MT#`.

## Checklist de réactivation

1. Remettre les fichiers `frontend/` aux chemins d’origine (`app/`, `components/`, `lib/`).
2. Remettre `backend/aws/` dans `aws/`.
3. Coller `messaging-function.snippet.yaml` dans `infra/template.yaml` (+ description stack).
4. Recâbler :
   - `app/(tabs)/_layout.tsx` — onglet `messages`
   - `app/_layout.tsx` — `Stack.Screen` `chat/[id]`
   - `lib/api/client.ts` + `types.ts` + `mockBackend.ts` (exports messaging)
   - `contexts/AuthContext.tsx` — `clearAllMessagesSnapshots` au logout
   - `lib/i18n/locales/{fr,en}.ts` — section `messages`
   - `lib/theme/colors.ts` — tokens bulles / montants argent
   - `lib/format.ts` — `formatMessageTime` (était dans le chat)
5. `sam build` + `sam deploy` pour republier la Lambda messaging.
6. Vérifier OTP / wallet stables avant d’investir à nouveau dans la messagerie.

## Note produit

Feature pertinente en vision (argent comme WhatsApp), mais chantier lourd (sync, offline, contacts, abus). Priorité : cœur wallet d’abord.
