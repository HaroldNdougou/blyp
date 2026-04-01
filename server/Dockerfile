# Build depuis le dossier server/ (voir render.yaml)
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY prisma ./prisma
COPY src ./src

# Client Prisma (postinstall peut ne pas suffire si lock copié sans node_modules complet)
RUN npx prisma generate

ENV NODE_ENV=production
EXPOSE 3001

# Applique le schéma au 1er démarrage (MVP). Ensuite : migrations Prisma dédiées.
CMD ["sh", "-c", "npx prisma db push && node src/index.js"]
