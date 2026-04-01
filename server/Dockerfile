# Contexte : dossier server/ (Railway : root directory = server ; Render : dockerContext ./server)
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
# Avant npm ci : le postinstall lance prisma generate, il faut déjà schema.prisma
COPY prisma ./prisma
RUN npm ci

COPY src ./src

ENV NODE_ENV=production
EXPOSE 3001

# Applique le schéma au 1er démarrage (MVP). Ensuite : migrations Prisma dédiées.
CMD ["sh", "-c", "npx prisma db push && node src/index.js"]
