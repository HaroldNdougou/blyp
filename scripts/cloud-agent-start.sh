#!/usr/bin/env bash
#
# Cloud Agent — start phase (idempotent, runs on every boot).
# Brings up PostgreSQL, makes sure the blyp role/database exist and applies
# the Prisma schema. The long-running API and Expo web servers are launched
# from the `terminals` entries in environment.json.
set -euo pipefail

cd "$(dirname "$0")/.."

# --- PostgreSQL ------------------------------------------------------------
echo "[start] starting PostgreSQL 16"
sudo pg_ctlcluster 16 main start || true

echo "[start] waiting for PostgreSQL to accept connections"
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q; then
    break
  fi
  sleep 1
done

# Ensure role + database exist (idempotent).
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='blyp'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER blyp WITH PASSWORD 'blyp' CREATEDB;"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='blyp'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE blyp OWNER blyp;"

# --- Prisma schema ---------------------------------------------------------
echo "[start] applying Prisma schema (prisma db push)"
npm --prefix server run db:push

echo "[start] ready — API and web are launched via environment.json terminals"
