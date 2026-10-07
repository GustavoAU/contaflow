---
id: SPEC-015
titulo: Restaurar prisma migrate dev y desplegar migraciones desde CI
estado: BORRADOR
fecha: 2026-10-07
rama: chore/spec-015-migraciones-automatizadas
arbol: "[11]"
zonas: [Z-1, Z-2, Z-3, Z-4, Z-5]
adrs: [ADR-057]
---

# Restaurar `prisma migrate dev` y desplegar migraciones desde CI

## 1. Problema
`CLAUDE.md` declara `prisma migrate dev` **ROTO** (tabla de decisiones frecuentes y sección Prisma / DB). El flujo real hoy es:

1. Escribir el SQL a mano.
2. `prisma db execute`.
3. `prisma migrate resolve --applied`.

A producción se aplica a mano desde una máquina local. El job `deploy-migrations` de `ci.yml` está comentado (y usa `npm ci` en un repo pnpm) y el build de Vercel no migra. Consecuencias:

- El schema y el código llegan a producción por caminos distintos.
- El drift entre `schema.prisma` y la BD solo se detecta a posteriori. Precedente: `RetentionSequence_companyId_key` dejó la emisión de comprobantes rota durante dos meses.
- Hay migraciones "pendientes de aplicar en producción" que viven como notas (SPEC-002 §12 cita `20260511_contra_asset_backfill`).

Dato nuevo que cambia el diagnóstico: ADR-057 y SPEC-002 ya hicieron el historial **repetible desde cero** (el job `integration` aplica las migraciones sobre un branch vacío en cada PR; hoy hay 170 directorios). La razón original por la que `migrate dev` "está roto" (la shadow DB no podía reproducir el historial) puede haber desaparecido. Lo que sigue faltando es una `shadowDatabaseUrl`: `prisma.config.ts` no la define.

## 2. Base legal / contable
Ninguna — decisión de ingeniería. Impacto indirecto en todas las zonas Z: una migración aplicada a medias en producción afecta correlativos, asientos y libros.

## 3. Alcance
**Incluye:**
- A) **Diagnóstico.** Reproducir el fallo de `prisma migrate dev --create-only` contra un branch de desarrollo de Neon y registrar el error exacto en la sección 11. Hipótesis, en orden: (1) falta `shadowDatabaseUrl` y el rol de `DATABASE_URL_DIRECT` no puede `CREATE DATABASE` en Neon; (2) la shadow DB no tiene el rol `authenticated` (la migración `20260406110000` lo crea con `IF NOT EXISTS`, así que no debería); (3) alguna migración sigue sin ser repetible contra una BD con datos de desarrollo.
- B) **Shadow DB explícita.** En Prisma 7 `shadowDatabaseUrl` va en el bloque `datasource` de `prisma.config.ts` (confirmado en la guía de upgrade a v7; ya no existe en `schema.prisma` ni como flag `--shadow-database-url`):
  ```ts
  datasource: {
    url: process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL || "…placeholder…",
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  }
  ```
  - `SHADOW_DATABASE_URL` apunta a un branch del proyecto Neon `contaflow-ci` (nunca al de producción). `prisma.config.ts` ya carga `.env.local`, así que basta ponerla ahí.
  - Documentar la variable en `.env.example`.
- C) **Validar el flujo estándar:** `prisma migrate dev --create-only --name <x>` genera una migración correcta para un cambio trivial de prueba. Luego `prisma migrate dev` la aplica al branch de desarrollo. El cambio de prueba se descarta.
- D) **Job `migrate-production` en `ci.yml`:**
  - `push` a `main`, `needs: [ci-result]`.
  - `environment: production-db` con revisores requeridos (lo crea el usuario).
  - `concurrency: { group: production-db, cancel-in-progress: false }`. La cancelación por `concurrency` de SPEC-014 no aplica a `main`; este grupo evita además dos migraciones simultáneas.
  - `DATABASE_URL_DIRECT` de producción solo en ese environment y solo en los pasos que lo usan. Instalar con `--ignore-scripts` (la acción compuesta de SPEC-014) y `prisma generate` aparte.
  - Pasos:
    1. `prisma migrate status` **informativo**: según la referencia de Prisma termina con código distinto de 0 cuando hay migraciones pendientes, que es justo el caso normal antes de desplegar; confirmarlo en la primera corrida y usar `|| true` en este paso solamente.
    2. `prisma migrate deploy`.
    3. `verify:drift`, `verify:enum-drift`, `verify:rls` y `verify:rls:runtime` contra producción, con `VERIFY_DATABASE_URL` (el `scripts/lib/db-url.mjs` de SPEC-014). Son solo lectura (el encabezado de `verify-rls-runtime.mjs` lo declara). Es la única excepción a la RN-2 de SPEC-014.
  - El job nunca corre `migrate reset`, `db push` ni `db execute`.
  - Borrar el bloque comentado `deploy-migrations`.
- E) **Regla expand/contract** en `CLAUDE.md` (sección Prisma / DB): toda migración debe ser compatible con el código desplegado **anterior**, porque Vercel despliega el código en paralelo al job de migración. Las operaciones destructivas (drop column, rename, NOT NULL sin default) van en dos specs/PRs: expand → deploy → contract.
- F) **Reconciliación del historial de producción:** el usuario corre `prisma migrate status` contra producción y pega la salida en la sección 11. Si hay migraciones del repo sin aplicar o aplicadas sin registrar, se listan y se decide caso por caso. **No se aplica nada a producción desde esta sesión.**
- G) Actualizar (barrido por `grep -rn "migrate dev"`; hoy aparece en estos sitios):
  - `CLAUDE.md`: fila "¿`prisma migrate dev`?" de la tabla (línea 34) y el bloque "ESTÁ ROTO" (línea 192): quitar y dejar el flujo estándar más la regla expand/contract.
  - `.claude/specs/_TEMPLATE.md`, sección 6 (línea 46).
  - `.claude/commands/implementar.md`, paso 3.4 ("sigue el workflow manual de migraciones").
  - `DEPLOYMENT.md`: el bucle `for f in prisma/migrations/*/migration.sql` con `db execute` (líneas 29-31) se reemplaza por `migrate deploy`.
  - `RUNBOOK.md`: ya documenta PITR de Neon (§1.1); añadir que el rollback de una migración es PITR más migración correctiva, nunca editar una migración ya aplicada.
  - `ADR-057` conserva su texto (es histórico); se le añade una nota que enlaza a esta spec.
- H) **Scripts operativos de una sola vez.** Hoy hay 9 que escriben en la BD y viven mezclados con el código: `prisma/diagnose-balance.ts`, `prisma/fix-invoice-gl.ts`, `prisma/fix-payroll-balance.ts`, `prisma/seed.ts`, `prisma/seed-demo.ts`, `prisma/seed-demo-tesa.ts`, `prisma/seed-account-titles.ts`, `scripts/backfill-fiscal-year.ts` y `scripts/fix-demo-company.ts`.
  - Moverlos a `scripts/ops/` (`git mv`). `seed.ts` se queda donde `prisma.config.ts` lo referencia (`migrations.seed`), pero usa el mismo guard.
  - Todos usan `scripts/lib/prod-guard.mjs`: compara el host de la URL resuelta con `PRODUCTION_DB_HOST` (variable de entorno, documentada en `.env.example`; es un nombre de host, no una credencial). Si la variable **no está definida**, el guard se niega a correr (falla cerrado) y explica cómo definirla. Si el host coincide, exige `--confirm-production`.
  - `tsconfig.json` excluye hoy `prisma/seed*.ts`; los archivos movidos a `scripts/ops/` entrarían en `tsc`. Mantener la exclusión (`scripts/ops/**`) o hacer que compilen, y decirlo en la sección 12.
  - Se ejecutan con `pnpm tsx <archivo>` (no con `node`).

**No incluye (explícito):**
- Cambiar el rol de conexión de la app (ADR-044 D-7).
- Aplicar migraciones pendientes a producción: lo hace el job, con aprobación del usuario.
- Cambios de schema de negocio.

## 4. Reglas de negocio
- RN-1: Ningún agente aplica migraciones a producción. Solo el job `migrate-production`, tras la aprobación humana del environment.
- RN-2: Una migración ya mergeada a `main` es inmutable. Corregirla = migración nueva.
- RN-3: La shadow DB y los branches de desarrollo nunca son el branch `production` de Neon.
- RN-4: Una migración que no es expand-compatible se rechaza en `/revisar`, salvo que la spec documente la ventana de mantenimiento.
- RN-5: Los scripts operativos fallan cerrado contra producción sin `--confirm-production`, y también cuando no pueden saber cuál es producción.
- RN-6: El job que migra producción no se cancela nunca y no corre dos veces a la vez.

## 5. Asientos contables
No aplica.

## 6. Modelo de datos
Sin cambios de schema. Cambia `prisma.config.ts` (shadow DB).

## 7. Contrato de servicio y actions
No aplica. Archivos:
- `prisma.config.ts`
- `.env.example`
- `.github/workflows/ci.yml` (job `migrate-production`; borrar el bloque comentado `deploy-migrations`)
- `CLAUDE.md`, `DEPLOYMENT.md`, `RUNBOOK.md`, `.claude/commands/implementar.md`
- `.claude/specs/_TEMPLATE.md`
- `scripts/ops/*` (movidos desde `prisma/` y `scripts/`) y `scripts/lib/prod-guard.mjs` (nuevo, con test)

## 8. UI
No aplica.

## 9. Criterios de aceptación
- [ ] CA-1: `prisma migrate dev --create-only --name spec015_smoke` funciona contra un branch de desarrollo y genera SQL correcto (el cambio de prueba se descarta).
- [ ] CA-2: En un PR de prueba, `migrate-production` **no** corre. Tras el merge a `main`, el job queda esperando aprobación del environment.
- [ ] CA-3: El log del job muestra `migrate status`, `migrate deploy` y los cuatro `verify:*` en verde. No aparecen credenciales.
- [ ] CA-4: `CLAUDE.md` ya no contiene "ROTO" ni el workflow manual; contiene la regla expand/contract. `grep -rn "migrate dev"` no devuelve ninguna instrucción de evitarlo (salvo el texto histórico de ADR-057).
- [ ] CA-5: `pnpm tsx scripts/ops/fix-invoice-gl.ts` con la URL de producción y sin `--confirm-production` termina con exit 1 y un mensaje claro; sin `PRODUCTION_DB_HOST` definido también termina con exit 1 (test unitario del guard, ambos casos).
- [ ] CA-6: La sección 11 contiene la salida de `prisma migrate status` de producción y la decisión sobre cada discrepancia.
- [ ] CA-7: Dos pushes seguidos a `main` no cancelan una migración en curso (el segundo espera).

## 10. Plan de agentes

## 11. Riesgos y preguntas abiertas
- **PAUSA — requiere al usuario:**
  1. Crear el branch de shadow en `contaflow-ci` y el valor de `SHADOW_DATABASE_URL` en su `.env.local`.
  2. Crear el environment `production-db` con revisores y el secret `DATABASE_URL_DIRECT` de producción.
  3. Correr `prisma migrate status` contra producción y pegar la salida aquí.
  4. Definir `PRODUCTION_DB_HOST` en su `.env.local`.
- R-1: Si el diagnóstico (A) muestra que el bloqueo es otro (p. ej. una migración histórica que no se puede repetir contra datos), se documenta y se reevalúa el alcance antes de seguir. ADR-057 ya exige que el historial se pueda repetir desde cero.
- R-2: Carrera Vercel ↔ migración: se mitiga con expand/contract (RN-4). Alternativa, si el usuario la prefiere: desplegar a Vercel desde CI después de migrar (deploy hook) y desactivar el auto-deploy de Git. Decisión del usuario.
- R-3: `20260511_contra_asset_backfill` existe en `prisma/migrations/` y SPEC-002 §12 la daba como pendiente en producción; no aparece en el Estado Activo. La reconciliación (F) decide si la aplica el job o se registra como aplicada.
- R-4: El job de producción prueba la migración "desde cero" (en el PR) pero no contra datos reales. Para backfills, probar antes en un branch con datos de desarrollo.

**Verificación fase 1 (2026-10-07, contra `origin/main` faca04a6):**
- Confirmado: `CLAUDE.md` declara `migrate dev` roto en dos sitios; `ci.yml` tiene `deploy-migrations` comentado (con `npm ci`); `DEPLOYMENT.md` aplica los SQL con un bucle de `db execute`; `prisma.config.ts` no define `shadowDatabaseUrl` y usa `DATABASE_URL_DIRECT || DATABASE_URL`; `_TEMPLATE.md` línea 46 repite que `migrate dev` está roto.
- Confirmado con documentación: en Prisma 7 `shadowDatabaseUrl` va en `datasource` de `prisma.config.ts` (`datasource: { url: env("DATABASE_URL"), shadowDatabaseUrl: env("SHADOW_DATABASE_URL") }`), y `--shadow-database-url` fue eliminado (guía de upgrade a v7, vía Context7 `/prisma/web`).
- Corregido: el diagnóstico original suponía que la causa estaba en la shadow DB o en el rol; ahora se parte de que ADR-057 ya resolvió la repetibilidad.
- Corregido: "mover 3 scripts" era corto; son 9 los que escriben (ver H). Se ejecutan con `tsx`, no con `node`.
- Corregido: `migrate status` puede salir con código distinto de 0 si hay pendientes; no está en la ayuda de 7.8.0, así que se confirma en la primera corrida.
- Corregido: la cancelación de `concurrency` de SPEC-014 habría podido interrumpir `migrate deploy`; se excluye `main`.
- No comprobado: el error exacto de `migrate dev` (requiere el branch de desarrollo del usuario); la salida de `migrate status` de producción.

## 12. Cierre
