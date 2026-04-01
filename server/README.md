# API Blyp

## Hébergement (Render — ~5 min de ton côté)

1. Pousse ce repo sur GitHub (ou GitLab supporté par Render).
2. [Render](https://dashboard.render.com) → **New** → **Blueprint** → colle le repo → valide.
3. Render crée **PostgreSQL** + le **web service** Docker ; à la fin, note l’URL du type `https://blyp-api-xxxx.onrender.com`.
4. Vérifie `https://…/health` dans le navigateur (`{"ok":true}`).

## App mobile (EAS)

1. [expo.dev](https://expo.dev) → ton projet → **Environment variables** (ou **Secrets**).
2. Pour le profil **production**, ajoute `EXPO_PUBLIC_API_URL` = l’URL HTTPS Render (sans slash final).
3. `eas build --profile production --platform android` (ou ios).

Sans cette variable, l’app reste en **mode démo** (pas d’API).

## Local (Postgres)

```bash
docker compose up -d
cp .env.example .env   # adapter DATABASE_URL si besoin
npx prisma db push
npm run dev
```
