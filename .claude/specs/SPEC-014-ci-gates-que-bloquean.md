---
id: SPEC-014
titulo: Gates de CI que bloquean de verdad
estado: BORRADOR
fecha: 2026-10-07
rama: chore/spec-014-ci-gates-bloqueantes
arbol: "[11]"
zonas: [Z-1]
adrs: [ADR-001, ADR-004, ADR-057]
---

# Gates de CI que bloquean de verdad

## 1. Problema
Varias reglas que `CLAUDE.md` declara obligatorias no las hace cumplir ninguna máquina:

- El chequeo de `Serializable` en correlativos (Z-1) solo imprime `WARNING` (`ci.yml`, paso "ADR-001: Validar Serializable…"). Además es un `grep` por archivo que **no reconoce `withSerializableRetry`**: hoy marcaría como faltantes 3 archivos que sí lo usan (ver sección 11). Pasarlo a `exit 1` tal cual rompería el CI por falsos positivos.
- `verify:rls`, `verify:rls:runtime`, `verify:drift`, `verify:enum-drift` y `verify:typography` existen pero no corren en CI.
- `eslint` corre sin `--max-warnings`.
- No hay `next build` en CI, y `vercel.json` ignora los builds de `dependabot/`: un PR de Dependabot puede mergearse sin haberse compilado nunca.
- El chequeo "schema ↔ migraciones" pasa si cambia **cualquier** línea de **cualquier** migración. No detecta drift.
- El workflow dispara en `push` a `feat/**` y en `pull_request`: dobles corridas. No hay `concurrency` ni `permissions` a nivel de workflow.
- El paso inline "Verificar coverage mínimo" duplica los `thresholds` de `vitest.config.ts` (mismos valores: 50/70/70/67), que ya hacen fallar la corrida por sí solos.
- `dependabot.yml` ignora actualizaciones mayores de `actions/checkout`, `actions/setup-node` y `softprops/action-gh-release` con comentarios falsos: el 2026-10-07 las últimas versiones son checkout v7.0.1, setup-node v7.0.0 y action-gh-release v3.0.3 (`gh api`), y `ci.yml` usa v5.

Cuando el código lo escriben agentes, un gate que no falla es un gate que no existe.

## 2. Base legal / contable
Ninguna — decisión de calidad de ingeniería. Indirecta: un correlativo duplicado es infracción SENIAT (Z-1).

## 3. Alcance
**Incluye:**
- A) Higiene del workflow:
  - Disparadores: `push` solo a `main` y `pull_request` a `main` (quitar `feat/**`).
  - `concurrency: group: ci-${{ github.ref }}` con `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. **Nunca cancelar corridas en `main`**: SPEC-015 añade ahí un job que migra producción y no debe interrumpirse a media migración.
  - `permissions: contents: read` a nivel de workflow (el job `integration` ya lo declara).
  - Acción compuesta `.github/actions/setup` (pnpm + node + install) con un input `ignore-scripts`. El job `integration` **debe** pasar `true`: SPEC-002 lo exige porque ese job tiene la key de Neon. `prisma generate` queda como paso aparte (con `--ignore-scripts` el `postinstall` no corre). La acción local solo existe después del `checkout`, así que el paso "Verificar secretos" de `integration` sigue yendo antes y fuera de ella.
- B) **Serializable → error, pero con un detector correcto.** Reemplazar el `grep` por un test de arquitectura (`src/__tests__/architecture/correlativo-serializable.test.ts`, mismo estilo que `idempotency-key-tenant-scope.test.ts`):
  - Reconoce las dos formas legítimas: `$transaction(…, { isolationLevel: "Serializable" })` y `withSerializableRetry(…)` de `@/lib/tx-helpers`.
  - Exige que **cada llamada** a `getNextControlNumber(` / `getNextVoucherNumber(` fuera de tests quede dentro del callback de una de las dos (hoy el `grep` solo mira que el archivo contenga la palabra en algún sitio).
  - Excepción documentada: `// ADR-001-EXCEPTION: <razón>`, igual que ADR-004.
  - Test con fixtures (llamada dentro, llamada fuera, excepción) y un centinela de que el detector encuentra los 5 archivos reales.
  - Se borra el paso `grep` de `ci.yml`.
  - Barrido de la clase (CLAUDE.md, "bug = clase"): el correlativo de comprobantes de retención **no** se llama `getNextVoucherNumber` (esa función es local de `CajaCajaMovementService`); su cobertura por este detector es 0. Incluir en el test los generadores de `RetentionSequence` / `ControlNumberSequence` por su nombre real o declarar en la sección 11 por qué quedan fuera.
- C) Reemplazar el chequeo "schema ↔ migraciones" por `prisma migrate diff` con `--exit-code` dentro del job `integration`, después de `migrate deploy` sobre el branch efímero:
  `pnpm prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` (exit 0 = igual, 1 = error, 2 = hay diferencias; el datasource sale de `prisma.config.ts`, que ya lee `DATABASE_URL_DIRECT` exportado por `ci-neon-branch.mjs`).
  - Flags confirmados con `prisma migrate diff --help` (7.8.0) y con la guía de upgrade a v7 (ver sección 11). `--from-url` y `--shadow-database-url` ya no existen.
  - **Medir antes de activar.** El historial contiene objetos que Prisma no modela (índices parciales — al menos 2 migraciones los crean —, el trigger `trg_journalentry_balance`, políticas RLS, CHECK). Si el diff sobre un branch recién migrado no sale vacío por eso, el gate no puede ser un `--exit-code` desnudo: se guarda la diferencia aceptada como línea base versionada (`scripts/ci/migrate-diff-baseline.sql`) y el job falla ante cualquier diferencia **nueva**. La salida medida va a la sección 12.
- D) `scripts/lib/db-url.mjs` (nuevo, con test en `scripts/__tests__/`), orden de resolución:
  1. `process.env.VERIFY_DATABASE_URL` (destino explícito; lo usa solo `migrate-production` de SPEC-015, solo lectura)
  2. `process.env.DATABASE_URL_TEST`
  3. si **no** hay `process.env.CI`: `process.env.DATABASE_URL`
  4. si **no** hay `process.env.CI`: `.env.local` (comportamiento actual)

  En CI sin (1) ni (2) lanza un error claro: nunca cae a `.env.local` ni a `DATABASE_URL`. Los 4 scripts con BD lo usan (hoy leen `.env.local` a mano y lanzan si no existe).
  Correr en el job `integration`, tras las migraciones: `verify:rls`, `verify:rls:runtime`, `verify:drift`, `verify:enum-drift`.
  - Ojo con `verify:rls:runtime`: descubre tablas tenant con filas de 2+ empresas y **sale 1 si no puede verificar nada** (ADR-044 D-8.3: "necesita una branch de Neon sembrada"). Un branch recién migrado está vacío. Decisión por defecto (revisable en la sección 11): sembrar en el propio branch efímero dos empresas con una fila en una tabla tenant (`scripts/ci/seed-rls-probe.sql`, solo para el branch del job). Alternativa: dejarlo fuera de CI y manual.
- E) `verify:typography` en el job `architecture` (estático, no necesita BD; medido: pasa hoy con exit 0).
- F) Job `build`: `pnpm build` con **valores ficticios y sin secretos** (`DATABASE_URL` simulada como en el job `test`; clave pública de Clerk ficticia con formato válido). Así corre igual en PRs de Dependabot y de forks, que es justo el hueco que cierra. Sin `SENTRY_AUTH_TOKEN` no se suben source maps. Entra en `needs` de `ci-result`. El script `build` fija `--max-old-space-size=8192`; el repo es público (runner de 16 GB), pero se mide el pico.
- G) ESLint:
  - Medir el número actual de warnings (`pnpm lint -f json`) **desde un checkout limpio o en CI**. Por comprobar: el flat config de ESLint no ignora carpetas con punto por defecto, así que `eslint` en el checkout principal podría lintar también `.claude/worktrees/**` y `.worktrees/**` e inflar N. Si se confirma, añadirlos a `globalIgnores` (también lo necesita SPEC-019 C).
  - Fijar `--max-warnings=<N>` en un script `lint:ci` y documentar N en la sección 12.
  - Cada spec futura que toque lint solo puede bajarlo. **No** re-escalar reglas a `error` en esta spec.
- H) Quitar el paso inline "Verificar coverage mínimo": `vitest.config.ts` ya impone los mismos `thresholds` y falla solo. Dejar un comentario en `ci.yml` que apunte a `vitest.config.ts` como única fuente.
- I) `dependabot.yml`:
  - Quitar los `ignore` de `actions/checkout`, `actions/setup-node` y `softprops/action-gh-release` (premisas falsas, ver sección 1).
  - Quitar el `ignore` de `xlsx`, que ya no es dependencia.
  - Dejar el de `eslint` (major).
  - `version-and-release.yml`: subir `actions/checkout` de v4 a v5 (alineado con `ci.yml`; Dependabot propondrá el resto). Si SPEC-021 elige G2, ese archivo se borra y este cambio se descarta.
- J) `ci-result`: añadir `build` a `needs` y a las comprobaciones.

**No incluye (explícito):**
- Pasar `TENANT_ASSERT_MODE` a `enforce` (SPEC-016).
- Automatizar migraciones a producción (SPEC-015).
- Corregir los warnings de ESLint existentes.
- E2E con Playwright.

## 4. Reglas de negocio
- RN-1: Ningún paso de CI termina en verde imprimiendo `WARNING` sobre una regla que `CLAUDE.md` declara obligatoria. O falla, o la regla deja de ser obligatoria (y se documenta).
- RN-2: En jobs de PR, los scripts `verify:*` solo reciben `DATABASE_URL_TEST` del branch efímero; en CI `db-url.mjs` se niega a caer a `DATABASE_URL` o `.env.local`. **Única excepción:** el job `migrate-production` de SPEC-015 (solo lectura, environment protegido, vía `VERIFY_DATABASE_URL`).
- RN-3: `ci-result` exige `success` de `test`, `architecture`, `security` y `build`, y (`success` | `skipped`) de `integration`.
- RN-4: El umbral `--max-warnings` es monótono decreciente. Subirlo requiere una nota en la sección 11 de la spec que lo sube.
- RN-5: `cancel-in-progress` nunca aplica a corridas sobre `main`.
- RN-6: La acción compuesta de setup preserva `--ignore-scripts` en todo job que tenga secretos de infraestructura.

## 5. Asientos contables
No aplica.

## 6. Modelo de datos
Sin cambios de schema.

## 7. Contrato de servicio y actions
No aplica. Archivos tocados:
- `.github/workflows/ci.yml`
- `.github/workflows/version-and-release.yml`
- `.github/dependabot.yml`
- `.github/actions/setup/action.yml` (nuevo)
- `scripts/lib/db-url.mjs` (nuevo, con test en `scripts/__tests__/`)
- los 4 `scripts/verify-*.mjs` que necesitan BD
- `scripts/ci/migrate-diff-baseline.sql` y `scripts/ci/seed-rls-probe.sql` (nuevos, solo si la medición los exige)
- `src/__tests__/architecture/correlativo-serializable.test.ts` (nuevo)
- `package.json` (script `lint:ci`)
- `eslint.config.mjs` (solo si G confirma la inflación por worktrees)

## 8. UI
No aplica.

## 9. Criterios de aceptación
- [ ] CA-1: El test `correlativo-serializable` pasa con los 5 archivos reales (incluidos `CajaCajaMovementService`, `invoice.actions.ts` e `invoice-batch.actions.ts`, que hoy dan falso positivo) y falla con un fixture que llama a `getNextControlNumber` fuera de un `$transaction` Serializable o de `withSerializableRetry`. El paso `grep` ya no existe en `ci.yml`.
- [ ] CA-2: Un PR de prueba que añade un `@unique` a `schema.prisma` sin migración hace fallar `integration` en el paso `migrate diff`. Se revierte después. La salida de la medición sobre un branch limpio queda en la sección 12.
- [ ] CA-3: El log de `integration` muestra `verify:rls`, `verify:rls:runtime`, `verify:drift` y `verify:enum-drift` en verde contra el branch efímero (o la decisión sobre `rls:runtime` registrada en la sección 11).
- [ ] CA-4: `scripts/lib/db-url.mjs` tiene tests para los cuatro orígenes, para "ninguno disponible → error claro" y para "con `CI=true` no cae a `DATABASE_URL` ni a `.env.local`".
- [ ] CA-5: El job `build` corre `next build` **sin secretos**, también en un PR de Dependabot de prueba, y es requerido por `ci-result`.
- [ ] CA-6: Dos pushes seguidos al mismo PR cancelan la primera corrida; dos pushes seguidos a `main` **no** cancelan ninguna.
- [ ] CA-7: `pnpm lint:ci` falla al añadir un warning nuevo.
- [ ] CA-8: Ningún secreto aparece en los logs (mismo método de verificación que el CA-6 de SPEC-002).
- [ ] CA-9: El job `integration` sigue instalando con `--ignore-scripts` tras pasar a la acción compuesta (se ve en el log).
- [ ] CA-10: `dependabot.yml` ya no ignora majors de `actions/*` ni `softprops`; `ci.yml` ya no contiene el paso inline de coverage.

## 10. Plan de agentes

## 11. Riesgos y preguntas abiertas
**Verificación fase 1 (2026-10-07, contra `origin/main` faca04a6):**
- Corregido: el script se llama `verify:rls:runtime` (con dos puntos), no `verify:rls-runtime`.
- Corregido: el chequeo de Serializable no solo es un WARNING; también es **incorrecto**. Ejecutada su lógica contra `src/modules`: 5 archivos mencionan los correlativos y 3 salen "sin Serializable" (`CajaCajaMovementService.ts`, `invoice.actions.ts`, `invoice-batch.actions.ts`) aunque los tres usan `withSerializableRetry`. `CajaCajaMovementService` además define su propio `getNextVoucherNumber` local. De ahí el punto B.
- Corregido: la lista de `ignore` de Dependabot: v6/v7 de checkout y setup-node sí existen; `softprops/action-gh-release` v3 también.
- Corregido: el job `integration` ya corre en PRs del mismo repo (SPEC-002, HECHA) con `needs` en `ci-result`, branch efímero en el proyecto `contaflow-ci` y `--ignore-scripts`. Esta spec se apoya en eso, no lo crea.
- Confirmado: `ci.yml` dispara en `push: [main, feat/**]`; no hay `concurrency` ni `permissions` globales; no hay `next build`; `vercel.json` ignora `dependabot/`; `eslint` sin `--max-warnings`; el chequeo schema↔migraciones cuenta líneas `+` de cualquier migración; los `thresholds` de `vitest.config.ts` coinciden con el paso inline; `verify:typography` pasa hoy (exit 0).
- Confirmado con documentación: en Prisma 7 `--from-url`, `--to-url`, `--from-schema-datasource` y `--shadow-database-url` fueron eliminados; se usa `--from-config-datasource` / `--to-config-datasource`. `--exit-code`: 0 = sin diferencias, 1 = error, 2 = hay diferencias (Prisma upgrade guide v7 y blog de `migrate diff`, vía Context7 `/prisma/web`). Los flags `--from-config-datasource`, `--to-schema` y `--from-migrations` aparecen en `prisma migrate diff --help` de 7.8.0.
- No comprobado: el valor de N de ESLint y si `eslint` linta carpetas con punto; el diff real de `migrate diff` sobre un branch migrado (puede no ser vacío); el pico de memoria de `next build` en el runner.

**Preguntas abiertas para ti:**
- P-1: `verify:rls:runtime` en CI exige sembrar datos en el branch efímero. ¿Sembramos (recomendado, es la única prueba conductual de la RLS) o lo dejamos manual?
- P-2: Estos gates nuevos viven en `integration`, que espera tu aprobación del environment `neon-ci` en cada push y se omite en Dependabot, forks y `push`. Por eso `build` y el test de Serializable van en jobs sin environment. ¿Aceptas ese reparto?

**Riesgos:**
- R-1: `verify:rls:runtime` requiere el rol `authenticated`; la migración `20260406110000` lo crea con `IF NOT EXISTS`, así que en un branch nuevo debería existir. Si no, se reporta y no se fuerza.
- R-2: `next build` en CI puede fallar con claves de Clerk ficticias si el formato no es válido. Se prueba en el primer PR; no se vuelve a secretos reales.
- R-3: El job `build` suma minutos. Si pasa de ~8 min, evaluar cache de `.next/cache` con `actions/cache`.
- R-4: Si el diff de `migrate diff` incluye objetos no modelados por Prisma, el gate necesita la línea base (punto C). No se ignora el resultado.

## 12. Cierre
