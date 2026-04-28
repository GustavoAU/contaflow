#!/bin/sh
# ContaFlow — Entrypoint Docker
# Aplica migraciones pendientes antes de iniciar el servidor Next.js.
# Requiere DATABASE_URL_DIRECT (conexión directa, sin pooler).

set -e

echo "[contaflow] Aplicando migraciones Prisma..."
npx prisma migrate deploy

echo "[contaflow] Iniciando servidor..."
exec "$@"
