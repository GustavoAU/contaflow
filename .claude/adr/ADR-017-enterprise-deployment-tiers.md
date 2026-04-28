# ADR-017 — Enterprise Deployment Tiers (Multi-tier Deployment Strategy)

**Status:** DECIDED  
**Date:** 2026-04-28  
**Deciders:** Gustavo + Claude

---

## Contexto

ContaFlow es una app SaaS multi-tenant. Clientes enterprise (bancos, hospitales, corporaciones) pueden exigir que sus datos no salgan de sus servidores o de infraestructura dedicada por razones legales, contractuales o de seguridad. Necesitamos una estrategia que permita atender esos casos sin sorpresas, sin romper el modelo SaaS estándar para PYMEs.

---

## Decisión

Tres tiers de deployment, todos corriendo el mismo código base. Cada cliente elige su tier al firmar contrato.

---

## Tiers

### Tier 1 — SaaS Compartido (default)
**Para:** PYMEs venezolanas, arranque rápido  
**Infraestructura:** Neon compartido + Vercel + Upstash + Clerk multi-tenant  
**Aislamiento:** `companyId` + RLS (ADR-007)  
**Precio:** Suscripción mensual estándar  
**Trabajo adicional:** Ninguno — ya implementado

### Tier 2 — Instancia Dedicada en la Nube
**Para:** Empresas medianas que quieren aislamiento total pero no quieren mantener servidores  
**Infraestructura:** Neon project propio + Vercel project propio + Upstash database propia + Clerk Organization propia  
**Aislamiento:** Infraestructura física separada; comparten código, no datos  
**Precio:** Precio enterprise (cubre costo de infraestructura dedicada)  
**Trabajo adicional:** 
- Crear nuevo proyecto Vercel con env vars del cliente
- Crear Neon project dedicado, pasar `DATABASE_URL` al proyecto Vercel
- Aplicar migraciones: `npx prisma migrate deploy`
- Crear Clerk Organization para el cliente
- ~2-3 horas de setup por cliente

### Tier 3 — Self-Hosted / On-Premise
**Para:** Corporaciones grandes, entidades reguladas que exigen datos en sus propios servidores  
**Infraestructura:** Servidores del cliente (VPS, datacenter privado, VM)  
**Stack reemplazable:**

| Componente ContaFlow | Alternativa Self-Hosted |
|---|---|
| Neon | PostgreSQL estándar (cualquier versión ≥ 14) |
| Upstash Redis | Redis OSS self-hosted |
| Vercel Blob | MinIO (S3-compatible) |
| Vercel / Next.js | Docker + Node.js en su servidor |
| Sentry cloud | Sentry self-hosted |
| Clerk | **Ver sección Clerk abajo** |

**Precio:** Contrato enterprise con costo de implementación + soporte

---

## El problema de Clerk en Tier 3

Clerk **no es self-hostable**. Dos opciones cuando un cliente exige on-premise completo:

### Opción A — Clerk Cloud con organización propia (recomendada)
El cliente acepta que la autenticación pase por Clerk cloud (auth.contaflow.app o dominio del cliente), pero **todos los datos del negocio** quedan en sus servidores. Clerk solo guarda credenciales (email + hash de password). Aceptable para la mayoría de los casos regulados.

### Opción B — Auth abstraction layer (si exigen 100% on-premise)
Implementar una interfaz `IAuthProvider` que permita intercambiar Clerk por Keycloak, Authentik o cualquier proveedor OIDC. Estimado: 2 semanas de trabajo. Solo implementar si hay contrato firmado que lo exija.

---

## Lo que ya está listo (sin trabajo adicional)

```
✅ DATABASE_URL en env var → apunta a cualquier Postgres
✅ Upstash no-op si UPSTASH_REDIS_REST_URL no existe (src/lib/ratelimit.ts)
✅ Prisma Migrations → npx prisma migrate deploy funciona en cualquier Postgres
✅ Next.js → corre en cualquier Node.js server (no depende de Vercel APIs propietarias)
✅ File storage → BLOB_STORE_URL en env var
```

## Lo que falta preparar (antes de que llegue el primer cliente enterprise)

```
[ ] Dockerfile — containerizar la app Next.js
[ ] docker-compose.yml de referencia — Postgres + Redis + MinIO + app
[ ] .env.enterprise.example — todas las env vars documentadas
[ ] Deployment guide — paso a paso para el técnico del cliente
[ ] Script de healthcheck — verifica conectividad DB + Redis + Storage
[ ] Auth abstraction layer — SOLO si cliente exige 100% on-premise (Opción B)
```

---

## Consecuencias

**Positivas:**
- Podemos atender enterprise sin reescribir la app
- Tier 2 se puede implementar en horas cuando llegue el cliente
- El código base no se bifurca — un solo repositorio sirve los tres tiers
- Argumento de venta: "datos en tu infraestructura si lo requieres"

**Negativas:**
- Tier 3 requiere que el cliente tenga un técnico que mantenga el servidor
- Clerk en Tier 3 complica el pitch de "100% on-premise" si el cliente es estricto
- Soporte de múltiples deployments incrementa la carga operacional

---

## Trigger para implementar

**Tier 2:** Cuando el primer cliente enterprise firme contrato. Estimado setup: 2-3 horas.  
**Tier 3 Dockerfile:** Preparar proactivamente en cualquier sesión con tiempo disponible.  
**Tier 3 Auth abstraction:** Solo con contrato firmado que lo exija explícitamente.

---

## Referencia

- `src/lib/ratelimit.ts` — no-op cuando `UPSTASH_REDIS_REST_URL` no definido
- `src/lib/prisma.ts` — singleton Prisma, solo necesita `DATABASE_URL`
- `prisma/schema.prisma` — compatible con PostgreSQL estándar
- ADR-007 — RLS multi-tenant (aplica solo en Tier 1)
