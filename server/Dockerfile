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

# Schéma : voir index.js (db push en arrière-plan après listen) pour ne pas bloquer le healthcheck Railway.
CMD ["node", "src/index.js"]
