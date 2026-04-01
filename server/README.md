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
6. **Settings** → **Deploy** : région **Europe** si proposée (mieux pour utilisateurs au Cameroun qu’un seul DC US).
7. **Settings** → **Networking** → génère un **domaine public** (HTTPS). L’URL ressemble à `https://xxx.up.railway.app`.
8. Vérifie `https://…/health` dans le navigateur (`{"ok":true}`).

Le fichier `railway.json` fixe le build Docker et le healthcheck sur `/health`.

## App mobile (EAS)

1. [expo.dev](https://expo.dev) → ton projet → **Environment variables** (profil production).
2. `EXPO_PUBLIC_API_URL` = l’URL HTTPS Railway (**sans** slash final).
3. `eas build --profile production --platform android` (ou ios).

Sans cette variable, l’app reste en **mode démo** (pas d’API).

## Alternative : Render

Blueprint : `render.yaml` à la racine du repo (PostgreSQL + service Docker `server/`).

## Local (Postgres)

À la racine du repo :

```bash
docker compose up -d
```

Puis dans `server/` :

```bash
cd server
cp .env.example .env   # adapter DATABASE_URL si besoin
npx prisma db push
npm run dev
```
