# API Blyp

## Hébergement Railway (~10 min)

1. Pousse ce repo sur GitHub.
2. [railway.app](https://railway.app) → **New project** → **Deploy from GitHub** → choisis le dépôt.
3. Railway crée un premier service : ouvre **Settings** → **Root Directory** → mets **`server`** (obligatoire : le `Dockerfile` est là).
4. **New** → **Database** → **PostgreSQL**. Une fois créée, ouvre le service **Web** (API) → **Variables** → **Add variable** → **Add reference** → sélectionne la base → **`DATABASE_URL`** (Railway injecte l’URL complète).
5. Toujours dans **Variables**, ajoute à la main (valeurs longues et aléatoires) :
   - `JWT_SECRET`
   - `OTP_PEPPER`  
   Tu peux t’inspirer de `.env.example`.
6. **SMS (OTP réels)** — en **production**, l’API refuse d’envoyer un OTP sans fournisseur SMS. Au choix (voir `server/.env.example`) :
   - **Obit SMS** : [obitsms.com](https://obitsms.com) — API v2 `GET …/api/v2/bulksms` avec `key_api`, `sender`, `destination` (`237` + 9 chiffres), `message`. Sur Railway : `OBIT_SMS_KEY_API`, `OBIT_SMS_SENDER` (expéditeur enregistré chez Obit, ex. `TESTAPI`). Optionnel : `OBIT_SMS_BASE_URL`. `SMS_PROVIDER=obitsms` pour forcer.
   - **Africa’s Talking** : `AFRICASTALKING_USERNAME`, `AFRICASTALKING_API_KEY` ; optionnel `AFRICASTALKING_SENDER_ID`, `AFRICASTALKING_API_HOST` (sandbox).
   - **Webhook** : `SMS_WEBHOOK_URL` — `POST` JSON `{ "to": "+237…", "message": "…" }` ; optionnel `SMS_WEBHOOK_BEARER_TOKEN`.
   - **Twilio** (optionnel) : `TWILIO_*` comme dans `.env.example`.  
   En **local** sans aucune de ces variables, le code OTP reste dans le **terminal** (`[OTP dev]`).
7. **Settings** → **Deploy** : région **Europe** si proposée (mieux pour utilisateurs au Cameroun qu’un seul DC US).
8. **Settings** → **Networking** → génère un **domaine public** (HTTPS). L’URL ressemble à `https://xxx.up.railway.app`.
9. Vérifie `https://…/health` : `ok`, et `sms.sending` à `true` si Obit (ou autre) est bien configuré.

Le fichier `railway.json` fixe le build Docker et le healthcheck sur `/health`.

**Dépannage** : si l’API répond sur `/health` mais les routes échouent, ouvre **Deploy Logs** : sans **`DATABASE_URL`** (référence vers la Postgres du projet), `prisma db push` échoue — l’étape 4 est obligatoire.

## App mobile (EAS)

1. [expo.dev](https://expo.dev) → ton projet → **Environment variables** (profil production).
2. `EXPO_PUBLIC_API_URL` = l’URL HTTPS Railway (**sans** slash final).
3. `eas build --profile production --platform android` (ou ios).

Sans cette variable, l’app reste en **mode démo** (pas d’API).

## Alternative : Render

Blueprint : `render.yaml` à la racine du repo (PostgreSQL + service Docker `server/`).

## Local (Postgres + API)

**Option A — tout avec Docker** (recommandé pour tester SMS + app) :

1. À la racine : `cp .env.example .env`, puis remplis au minimum `OBIT_SMS_KEY_API`, `OBIT_SMS_SENDER`, `JWT_SECRET`, `OTP_PEPPER`, et `EXPO_PUBLIC_API_URL=http://localhost:3001` pour l’app.
2. `docker compose up --build` — l’API écoute sur le port **3001** (service `api` + Postgres `db`).
3. Au démarrage, les logs indiquent si le SMS Obit est actif ; `GET http://localhost:3001/health` renvoie `sms.sending`, `sms.provider`, etc.

**Option B — Postgres dans Docker, API sur la machine** :

```bash
docker compose up -d db
cd server
cp .env.example .env   # DATABASE_URL=postgresql://blyp:blyp@localhost:5432/blyp
npx prisma db push
npm run dev
```

Les variables communes peuvent aussi être dans un **`.env` à la racine du repo** : le serveur charge d’abord la racine, puis `server/.env` (qui écrase en cas de doublon). Voir la racine `.env.example`.
