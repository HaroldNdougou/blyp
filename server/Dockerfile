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

# Schéma : index.js écoute d’abord puis prisma db push (évite timeout healthcheck Railway sur /health).
CMD ["node", "src/index.js"]
