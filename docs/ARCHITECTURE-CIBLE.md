# Blyp — architecture cible

Document de référence pour les sessions de travail (vision produit + infra).  
**Ne remplace pas** le code existant tant qu’une migration explicite n’est pas demandée.

---

## 1. Vision produit

| Objectif | Description |
|----------|-------------|
| **Latence « Google »** | L’utilisateur voit l’écran et le feedback **au clic** ; pas d’attente réseau pour afficher solde, profil, historique récent. |
| **Scale Afrique** | Dizaines de millions d’utilisateurs, **petits paiements quotidiens** (Mobile Money / wallet), pics massifs sans dégradation. |
| **Fiabilité** | Pas de crash silencieux, pas de double crédit/débit, pas de solde faux à l’écran après paiement. |
| **Référence UX** | WhatsApp, TikTok, YouTube : réactivité perçue + infra mondiale — **pas** un petit PaaS type Railway pour la prod cible. |

**État actuel (contexte)** : peu ou pas d’utilisateurs réels (tests fondateur). Moment idéal pour construire **directement** la stack cible sans migration de masse.

**Réalité argent** : l’UI peut être instantanée ; la **confirmation financière** dépend des opérateurs (secondes possibles). UX = optimiste + statut clair (« en cours » / « confirmé »).

---

## 2. Principes (comme les géants)

1. **Proche de l’utilisateur** — API et données en région adaptée à l’Afrique.
2. **L’app ne attend pas le serveur pour afficher** — cache local + prefetch + UI optimiste.
3. **Le lourd est asynchrone** — SMS, webhooks, notifications → files (SQS).
4. **Services qui scalent seuls** — pas une seule machine qui porte tout.
5. **Source de vérité unique** pour l’argent — DynamoDB + transactions atomiques.
6. **Idempotence partout** — OTP, dépôts, webhooks partenaires.
7. **Observabilité** — métriques, alarmes, tests de charge avant le « jour J ».

---

## 3. Stack AWS cible

```
App mobile (Expo)
    → HTTPS
API Gateway (HTTP API)
    → Lambda (domaines : auth, wallet, profil, …)
        → DynamoDB (ledger, users, tx)
        → ElastiCache Redis (OTP, rate limit, cache chaud)
        → SQS → Lambda workers (SMS, post-webhook, …)
    → Secrets Manager + KMS
Webhooks (PawaPay, …) → route dédiée API GW → Lambda (body brut, signature)
Assets → S3 → CloudFront
Monitoring → CloudWatch (+ X-Ray optionnel)
```

### Région

- **Primaire** : `af-south-1` (Cape Town) pour utilisateurs Afrique centrale / Ouest / Est selon routing.
- Ajuster si métriques latence réelles sur pays cibles (Cameroun, etc.).

### Compute

- **Lambda** par domaine métier (recommandé greenfield), ou **ECS Fargate / App Runner** si préférence containers.
- **Pas** Express monolithique long-running sur Railway comme cible prod à l’échelle.

### Données

- **DynamoDB** : modèle **single-table** (PK/SK + GSI) — users, soldes, transactions, idempotence webhooks, OTP (TTL).
- **Écritures wallet** : `TransactWriteItems` (solde + ligne ledger + marqueur idempotence).
- **RDS / Postgres** : **optionnel plus tard** pour reporting, BI, admin SQL — **pas** le cœur chaud des paiements.
- **EBS** : uniquement si EC2 ; **pas** requis en stack serverless + DynamoDB.

### Files & intégrations

- **SQS** + **DLQ** pour retries SMS, traitement webhook, tâches non bloquantes.
- **EventBridge** optionnel (cron, réconciliation).
- Partenaires paiement (ex. PawaPay) : webhook idempotent, crédit atomique, puis event async.

### Déploiement & IaC

- **CDK**, **SAM** ou **Terraform** — environnements dev/staging/prod, pas de config manuelle opaque.

---

## 4. Caches multi-niveaux

| Niveau | Techno | Rôle |
|--------|--------|------|
| 1 | **Cache local app** (SQLite, MMKV, …) | Solde, profil, derniers tx — **instantané au clic** |
| 2 | **CloudFront + S3** | Images, assets, config publique stable |
| 3 | **Redis (ElastiCache)** | OTP cooldown, rate limit, cache applicatif partagé court |
| 4 | **DAX** | Accélérateur lectures DynamoDB — **phase 2+** uniquement |
| 5 | **DynamoDB** | Vérité durable ; lectures déjà rapides (ms) |

**Invalidation** : après paiement réussi → écrire DynamoDB → invalider/rafraîchir Redis + cache téléphone.

**UI optimiste** : bouton payer → état immédiat « en cours » / « envoyé » → confirmation ou rollback UI si échec.

**DAX au jour 1** : non recommandé (coût 24/7, VPC, peu de gain sans trafic lecture massif).

---

## 5. Sécurité ultra

### Chiffrement

| Couche | Mesure |
|--------|--------|
| Transit | TLS 1.2+ (API Gateway, app, appels AWS) |
| Secrets | Secrets Manager / SSM, chiffrés **KMS** |
| DynamoDB | Encryption at rest (clé AWS ou **CMK KMS** dédiée) |
| S3 | SSE-KMS, buckets **privés** |
| Redis | Encryption at rest + **TLS** en production |
| Logs | Pas d’OTP, PIN, tokens, corps webhook sensibles |

### Données sensibles

- **PIN transaction** : hash (pepper dans Secrets Manager), jamais stocké en clair.
- **OTP** : hash + TTL ; rate limit Redis + cooldown par numéro.
- **JWT** : secret dans Secrets Manager ; durée de vie raisonnable.

### Sauvegarde & reprise

- **DynamoDB PITR** : activé sur tables métier (restauration ~35 jours).
- **Backups on-demand** avant migrations majeures.
- **Export S3** optionnel (archive, analytics).
- **Redis** : pas source de vérité — pas critique en backup.
- **Git + IaC** : reproductibilité infra.
- **Multi-région** : phase ultérieure (DR).

### Surface d’attaque

- **WAF** sur API Gateway en prod ouverte.
- **IAM** moindre privilège par Lambda.
- **Throttling** API Gateway.
- Tests de **restauration** DynamoDB (table de test).

---

## 6. Modèle données DynamoDB (esquisse)

| Entité | Clé (exemple) |
|--------|----------------|
| User | `USER#<id>` / `PROFILE` |
| Solde | `USER#<id>` / `BALANCE` |
| Transaction | `USER#<id>` / `TX#<ts>#<id>` |
| Idempotence | `IDEM#<provider>#<eventId>` |
| OTP challenge | `OTP#<phone>` + `expiresAt` (TTL) |

GSI selon besoins (ex. liste tx par statut admin — limité).

---

## 7. Ce qu’on n’utilise pas comme cible prod

- **Railway** (ou VPS unique) pour l’échelle « dizaines de millions ».
- **DAX** au démarrage.
- **EBS** sauf si choix explicite EC2.
- **RDS** comme ledger principal des paiements (DynamoDB reste le cœur).
- Cache **uniquement** serveur sans cache **téléphone** (UX lente au clic).
- Travail **synchrone** long dans la requête HTTP (SMS, webhook lourd).

---

## 8. Ordre d’implémentation recommandé

1. Compte AWS, IaC, API Gateway, Lambda health, table DynamoDB, déploiement CI.
2. Auth téléphone + OTP (DynamoDB TTL + Redis rate limit) + JWT.
3. Wallet : solde, dépôt, idempotence, webhooks partenaires.
4. App mobile : cache local + UI optimiste + `EXPO_PUBLIC_API_URL` → API GW.
5. CloudFront/S3 si assets.
6. Durcissement : WAF, alarmes, tests charge, runbooks, test restauration PITR.
7. **DAX** si métriques lectures DynamoDB le justifient.

---

## 9. Dev mobile (existant)

- Tests sur **Redmi 9C** physique, USB, pas d’émulateur par défaut (voir `.cursor/rules/android-dev-device.mdc`).

---

## 10. Phrase pour reprendre une session

> « On continue Blyp : lis `docs/ARCHITECTURE-CIBLE.md` et la règle `.cursor/rules/blyp-architecture-cible.mdc` — full AWS, latence Google, sécurité ultra. »

---

*Dernière mise à jour : vision validée en session de conception (greenfield AWS, scale Afrique, multi-cache, sécurité renforcée).*
