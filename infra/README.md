# Blyp — infra AWS (phase 3)

Stack **SAM** : API Gateway HTTP, Lambda `/health` + **auth OTP/JWT** + **wallet** + **webhooks PawaPay**, table DynamoDB single-table (`PK` / `SK`, TTL `expiresAt`, PITR).

Région cible : **`af-south-1`**.

## Routes déployées

| Méthode | Chemin | Rôle |
|---------|--------|------|
| GET | `/health` | Santé Lambda + DynamoDB |
| POST | `/auth/request-otp` | Envoi OTP SMS (cooldown 60s via DynamoDB TTL) |
| POST | `/auth/verify-otp` | Vérification OTP → access + refresh (180 j) + user |
| POST | `/auth/refresh` | Rotation refresh → nouvel access (+ refresh) |
| POST | `/auth/onboarding/transaction-pin` | Définir PIN (auth) |
| POST | `/auth/onboarding/profile` | Prénom / nom (auth) |
| GET | `/me` | Profil + solde (auth) |
| POST | `/wallet/deposit` | Dépôt (sync par défaut, idempotence `Idempotency-Key`) |
| GET | `/wallet/deposits/{id}` | Statut d’un dépôt |
| POST | `/payments/pay` | Paiement (PIN 4 chiffres, idempotence) |
| GET | `/transactions` | Historique récent |
| POST | `/webhooks/pawapay/deposit` | Callback PawaPay (mode `DepositMode=async` uniquement) |

## Prérequis

- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) configuré (`aws configure` ou SSO)
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- Node.js 20+
- Vérifier l’accès compte + région :

```bash
aws sts get-caller-identity
aws ec2 describe-regions --region-names af-south-1 --query "Regions[0].RegionName" --output text
sam --version
```

---

## Checklist déploiement (ce soir / demain)

Cocher dans l’ordre. **Ne pas basculer l’app mobile** vers AWS tant que vous n’avez pas validé auth + wallet sur le Redmi 9C.

### Avant deploy

- [ ] **A1** — Compte AWS OK (`aws sts get-caller-identity`)
- [ ] **A2** — SAM CLI installé (`sam --version`)
- [ ] **A3** — `cp infra/samconfig.toml.example infra/samconfig.toml`
- [ ] **A4** — Secrets dans `samconfig.toml` :
  - `JwtSecret` — long, aléatoire (≠ `dev-insecure-change-me`)
  - `OtpPepper` — stable entre redeploys
  - SMS (optionnel dev) : `SmsProvider`, `ObitSmsKeyApi`, `ObitSmsSender`, `AndroidSmsOtpAppHash`
- [ ] **A5** — **Alerte budget AWS ~10 $/mois** (voir section ci-dessous) — **obligatoire anti coût caché**
- [ ] **A6** — Comprendre : users AWS (DynamoDB) ≠ users Express (Postgres) — bases séparées

### Deploy

- [ ] **B1** — `npm run aws:validate`
- [ ] **B2** — `npm run aws:build`
- [ ] **B3** — `npm run aws:deploy` (confirmer le changeset)
- [ ] **B4** — Noter l’`ApiUrl` dans les outputs CloudFormation

### Vérifications post-deploy

- [ ] **C1** — `GET /health` → `"ok": true`, `"dynamodb": "ok"`
- [ ] **C2** — `POST /auth/request-otp` avec un numéro test
- [ ] **C3** — OTP reçu par SMS **ou** visible dans `npm run aws:logs:auth` (`[OTP dev]`)
- [ ] **C4** — `POST /auth/verify-otp` → JWT + user
- [ ] **C5** — `POST /wallet/deposit` (sync) → solde crédité
- [ ] **C6** — `POST /payments/pay` + `GET /transactions`
- [ ] **C7** — **Garder** `EXPO_PUBLIC_API_URL` sur Railway jusqu’à validation mobile
- [ ] **C8** — (Optionnel) test complet sur Redmi 9C avec URL AWS temporaire

### Paramètres phase 3 (wallet)

- `DepositMode=sync` — crédit interne immédiat (sans PawaPay réel)
- `DepositMode=async` + `PawapayApiToken` + `PawapayWebhookSecret` — Mobile Money réel

### Stack sans coûts fixes (règles Blyp)

- [ ] Pas de NAT Gateway, EKS, Aurora, ElastiCache au jour 1
- [ ] DynamoDB **on-demand** (déjà le cas dans le template)
- [ ] Supprimer la stack dev si inutilisée : `sam delete --stack-name blyp-api-dev`

---

## Alerte budget AWS (~10 $/mois)

À faire **une fois par compte AWS** (ou à chaque nouveau compte), **avant ou juste après** le premier deploy.

### 1. Créer un budget mensuel

Remplacer `ALERT_EMAIL` par ton email (compte de facturation AWS).

```bash
export ALERT_EMAIL="ton-email@example.com"
export AWS_BUDGET_REGION="us-east-1"

aws budgets create-budget \
  --account-id "$(aws sts get-caller-identity --query Account --output text)" \
  --budget '{
    "BudgetName": "blyp-monthly-10usd",
    "BudgetLimit": { "Amount": "10", "Unit": "USD" },
    "TimeUnit": "MONTHLY",
    "BudgetType": "COST"
  }' \
  --notifications-with-subscribers "[{
    \"Notification\": {
      \"NotificationType\": \"ACTUAL\",
      \"ComparisonOperator\": \"GREATER_THAN\",
      \"Threshold\": 80,
      \"ThresholdType\": \"PERCENTAGE\"
    },
    \"Subscribers\": [{ \"SubscriptionType\": \"EMAIL\", \"Address\": \"${ALERT_EMAIL}\" }]
  },{
    \"Notification\": {
      \"NotificationType\": \"FORECASTED\",
      \"ComparisonOperator\": \"GREATER_THAN\",
      \"Threshold\": 100,
      \"ThresholdType\": \"PERCENTAGE\"
    },
    \"Subscribers\": [{ \"SubscriptionType\": \"EMAIL\", \"Address\": \"${ALERT_EMAIL}\" }]
  }]" \
  --region "$AWS_BUDGET_REGION"
```

> **Note** : AWS Budgets s’configure en **`us-east-1`** (API Billing), même si Blyp tourne en `af-south-1`.

### 2. Confirmer l’email d’alerte

AWS envoie un **email de confirmation** — cliquer le lien (sinon pas d’alertes).

### 3. Vérifier le budget

```bash
aws budgets describe-budgets \
  --account-id "$(aws sts get-caller-identity --query Account --output text)" \
  --region us-east-1 \
  --query "Budgets[?BudgetName=='blyp-monthly-10usd'].[BudgetName,BudgetLimit.Amount]" \
  --output table
```

### 4. Coût réaliste phase 2 (dev/test)

| Poste | Ordre de grandeur |
|-------|-------------------|
| Lambda + API GW + DynamoDB | 0–5 $/mois (faible trafic) |
| CloudWatch logs | ~0 $ (retention courte) |
| **SMS Obit** | **hors AWS**, payant par envoi |
| NAT / Redis / Aurora / EKS | **0 $** — non déployés |

---

## Déploiement local (première fois)

```bash
# Depuis la racine du repo
cp infra/samconfig.toml.example infra/samconfig.toml
# Éditer infra/samconfig.toml : secrets + SMS (voir ci-dessous)

npm run aws:build
npm run aws:deploy
```

### Paramètres sensibles (samconfig.toml)

Exemple `parameter_overrides` :

```toml
parameter_overrides = "Stage=dev JwtSecret=change-me-32chars-min OtpPepper=your-otp-pepper DepositMode=sync SmsProvider=obitsms ObitSmsKeyApi=xxx ObitSmsSender=BLYP AndroidSmsOtpAppHash=xxxxxxxxxxx"
```

En **dev** sans SMS configuré : l’OTP est loggé dans CloudWatch (`[OTP dev]`).

## Après déploiement

URL API :

```bash
aws cloudformation describe-stacks \
  --stack-name blyp-api-dev \
  --region af-south-1 \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
  --output text
```

Tester :

```bash
curl -s "https://<api-id>.execute-api.af-south-1.amazonaws.com/dev/health"
curl -s -X POST "https://<api-id>/dev/auth/request-otp" -H "Content-Type: application/json" -d '{"phone":"612345678"}'
```

## App mobile

```env
EXPO_PUBLIC_API_URL=https://<api-id>.execute-api.af-south-1.amazonaws.com/dev
```

## Modèle DynamoDB (auth)

| Entité | PK | SK |
|--------|----|----|
| Mapping téléphone → user | `PHONE#+2376…` | `META` |
| Profil | `USER#<uuid>` | `PROFILE` |
| Solde | `USER#<uuid>` | `BALANCE` |
| OTP challenge | `OTP#+2376…` | `CHALLENGE` |
| Cooldown renvoi | `OTP#+2376…` | `COOLDOWN` |
| Idempotence verify | `IDEM#otp-verify` | `<phone>\|<hash>` |

## Structure code

| Chemin | Rôle |
|--------|------|
| `infra/template.yaml` | Stack CloudFormation / SAM |
| `aws/handlers/health/` | Lambda GET `/health` |
| `aws/handlers/auth/` | Lambda auth + `/me` |
| `aws/handlers/wallet/` | Lambda dépôt, pay, historique |
| `aws/handlers/webhook/` | Lambda webhooks PawaPay |
| `aws/lib/` | HTTP, DynamoDB, OTP, PIN, JWT, SMS, user, wallet, PawaPay |

## Prochaines phases

1. ~~Phase 2 — Auth OTP + JWT~~ ✅
2. ~~Phase 3 — Wallet TransactWrite + webhooks PawaPay~~ ✅
3. **Phase 4** — Cache local app + UI optimiste
4. **Phase 5** — Redis (rate limit partagé multi-Lambda), Secrets Manager, WAF

## Commandes utiles

```bash
npm run aws:validate
npm run aws:build
npm run aws:deploy
npm run aws:logs        # Lambda health
npm run aws:logs:auth   # Lambda auth
npm run aws:logs:wallet # Lambda wallet
```
