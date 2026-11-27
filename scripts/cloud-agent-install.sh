#!/usr/bin/env bash
#
# Cloud Agent — install phase (idempotent).
# Runs after the repo is checked out. Prepares JS dependencies, the Prisma
# client and local dev env files. PostgreSQL itself lives in the base
# snapshot/image; per-boot startup is handled by cloud-agent-start.sh.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

# --- Local dev env files (gitignored — created only if missing) ------------
# These hold local-only dev values, never real secrets. JWT/OTP peppers are
# generated randomly the first time so nothing sensitive is committed.
if [ ! -f "$REPO_ROOT/.env" ]; then
  cat > "$REPO_ROOT/.env" <<EOF
EXPO_PUBLIC_API_URL=http://localhost:3001
EOF
  echo "[install] created root .env"
fi

if [ ! -f "$REPO_ROOT/server/.env" ]; then
  JWT_SECRET="$(openssl rand -hex 24)"
  OTP_PEPPER="$(openssl rand -hex 24)"
  cat > "$REPO_ROOT/server/.env" <<EOF
DATABASE_URL=postgresql://blyp:blyp@localhost:5432/blyp
JWT_SECRET=$JWT_SECRET
OTP_PEPPER=$OTP_PEPPER
NODE_ENV=development
PORT=3001
EOF
  echo "[install] created server/.env"
fi

# --- JavaScript dependencies ----------------------------------------------
# Root = Expo app. server = Node/Express API (postinstall runs prisma generate).
echo "[install] installing app dependencies"
npm install

echo "[install] installing server dependencies"
npm --prefix server install

echo "[install] done"
