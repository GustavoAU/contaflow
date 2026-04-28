# syntax=docker/dockerfile:1
# ContaFlow — Dockerfile para despliegue self-hosted (ADR-017 Tier 3)
#
# Build:
#   DOCKER_BUILD=1 docker build -t contaflow .
#
# Run:
#   docker compose up -d   (ver docker-compose.yml)

# ─── Stage 1: dependencies ───────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Instalar dependencias nativas necesarias (openssl para Prisma)
RUN apk add --no-cache openssl libc6-compat

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ─── Stage 2: builder ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Generar cliente Prisma
RUN npx prisma generate

# Build Next.js en modo standalone
ENV DOCKER_BUILD=1
ENV NEXT_TELEMETRY_DISABLED=1

# Variables de build que Next.js necesita en tiempo de compilación
# (las secretas se pasan en runtime, no aquí)
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

RUN npm run build

# ─── Stage 3: runner ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Usuario no-root para reducir superficie de ataque
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copiar output standalone + archivos estáticos
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static    ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public          ./public

# Copiar schema de Prisma (necesario para migraciones en runtime)
COPY --from=builder --chown=nextjs:nodejs /app/prisma          ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# Script de entrypoint: aplica migraciones pendientes antes de arrancar
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
