# ContaFlow — Plan de mejoras de automatización y estructura

Ocho specs en el formato de `.claude/specs/_TEMPLATE.md`, en estado **BORRADOR** (`SPEC-014` a `SPEC-021`). Cada una es un PR que se puede mergear solo.

Las escribió un revisor externo leyendo el repo sin ejecutar nada. **La fase 1 (verificación contra el código) ya se hizo el 2026-10-07 sobre `origin/main` (faca04a6)**: las specs de esta carpeta son las versiones corregidas, y cada una lleva en su sección 11 el detalle de lo corregido, lo confirmado y lo que no se pudo comprobar.

Flujo:
1. ~~Copiar las specs a `.claude/specs/`.~~ Hecho.
2. ~~Verificarlas contra el código (fase 1).~~ Hecho.
3. **Tú las apruebas** (cambia `estado: APROBADA` en cada una, de a una).
4. `/implementar SPEC-XXX`, una por una.

## Orden y dependencias

| # | Spec | Qué resuelve | Depende de | Pausas para ti |
|---|---|---|---|---|
| 1 | SPEC-014 | Gates de CI que fallan de verdad: Serializable (con detector correcto), `verify:*`, `next build` sin secretos, `migrate diff`, `max-warnings` | SPEC-002 (HECHA, job `integration`) | Sembrar o no el branch para `verify:rls:runtime`; aceptar el reparto de gates entre jobs |
| 2 | SPEC-019 | Hooks de Claude Code (Bash **y** PowerShell), pre-commit, worktree por sesión, protección de `main` | — | Ruleset de `main` en GitHub |
| 3 | SPEC-015 | `migrate dev` funcionando y migraciones a producción desde CI con aprobación | SPEC-014 (`db-url.mjs`, acción compuesta, `concurrency`) | Branch shadow en Neon, environment `production-db`, `PRODUCTION_DB_HOST`, salida de `migrate status` de prod |
| 4 | SPEC-016 | D-3b (anotar `unscoped`), tests en `enforce`, SQL crudo con allowlist, paso a `enforce` | SPEC-002 (usa el job `integration`) | Inventario de Sentry; decisión fail-closed del mapa vacío; decisión sobre fila única; activar `enforce` en Vercel |
| 5 | SPEC-017 | `proxy.ts` (si Clerk lo permite), limpieza de dependencias, `tsconfig`, decisión Turbopack | — | — |
| 6 | SPEC-018 | Generador `prisma-client` de Prisma 7 | — (SPEC-016 deseable, no obligatoria) | — |
| 7 | SPEC-020 | Specs validadas (`check:specs`), estado derivado con `pnpm estado` | — | — |
| 8 | SPEC-021 | ADRs renumerados y normalizados, `docs/` archivado, una sola versión | SPEC-020 | Tabla de ADRs, header de versión, versionar sí/no |

Por qué este orden:
- Primero los gates (014) y los guardarraíles (019), para que **todo lo demás** ya pase por ellos.
- Después los dos riesgos de producción: migraciones (015) y aislamiento (016).
- Al final los upgrades y la higiene, que son de bajo riesgo pero mucha superficie.

## Resultado de la verificación (fase 1)

| Spec | Afirmaciones corregidas (resumen) | Preguntas abiertas para ti |
|---|---|---|
| 014 | El script es `verify:rls:runtime` (no `-runtime`). El chequeo de Serializable es además incorrecto: da 3 falsos positivos (`withSerializableRetry`), así que pasarlo a error rompía el CI. El job `integration` ya existe (SPEC-002). `concurrency` no puede cancelar corridas en `main` (choca con SPEC-015). La acción compuesta debe conservar `--ignore-scripts`. El `build` va sin secretos (Dependabot/forks no los tienen). Los `ignore` de Dependabot son falsos (últimas: checkout v7, setup-node v7, action-gh-release v3). `verify:rls:runtime` sale 1 en un branch vacío. | P-1 sembrar datos para `rls:runtime`; P-2 reparto de gates entre jobs |
| 015 | `ADR-057` ya hizo el historial repetible: el diagnóstico parte de la falta de `shadowDatabaseUrl`, no del rol. `migrate status` puede salir ≠ 0 con pendientes. Son 9 los scripts operativos (no 3) y se ejecutan con `tsx`. El job de producción no puede cancelarse. Flags de Prisma 7 confirmados con la doc. | Shadow branch, environment, `PRODUCTION_DB_HOST`, `migrate status` de prod |
| 016 | El assert **sí** cubre fila única (D-3-bis); solo exime `where:{id}`. El inventario de SQL crudo (D-8.2) ya está hecho: 15 sitios en 9 archivos, no 16. **`unscoped()` tiene 0 usos reales** y ADR-044 D-3b sigue abierto: `enforce` rompería crons y webhooks. Los tests de integración no pasan por `@/lib/prisma`, así que la variable de entorno no tendría efecto. El grep ADR-004 es de −15/+10 líneas y reemplazarlo por `company-isolation.test.ts` reduce cobertura. `JournalLine` y `CRON_CROSS_TENANT` no existen. | Inventario de Sentry; fail-closed del mapa vacío; verificación de fila única (requiere contexto de request) |
| 017 | La razón de `--webpack` existe (bug de Turbopack) pero fuera del repo. La precedencia actual de `prisma.config.ts` pisa incluso variables de la shell; `dotenv` no. Que `clerkMiddleware` funcione en `proxy.ts` **no está comprobado** en la doc. El riesgo de next-intl es menor (no usa su middleware). | — |
| 018 | `@prisma/client` deja de funcionar: el import pasa a `<output>/client`. `Prisma.dmmf` con el generador nuevo **no está documentado** (spike obligatorio con plan B). `.gitignore` ya ignora `/src/generated/prisma`. Hay un `vi.doMock("@prisma/client")` y tipos `import("…")`. El test de `SCOPE_MAP` ya existe (no hace falta esperar a 016). | — |
| 019 | **`.gitignore` ignora `.claude/settings.json`.** El hook solo cubría `Bash`; hay también `PowerShell`. Bloquear es **exit 2**; las reglas `Bash(...)` se evaden con `git -C . push`. `prepare: git config` rompe Vercel/Docker (sin `.git`). Los hooks no deben usar `pnpm exec`. Contradice "docs directo a main" de `CLAUDE.md`. El slug del worktree no puede llevar `/`. El `aceptacion:` ejecuta texto no confiable. | Ruleset de `main` |
| 020 | El frontmatter real tiene comentarios en línea y texto libre en `adrs:`; hay dos archivos SPEC-012. Solo 18 de 63 ADRs tienen `Status` (A2 como error fallaba en ~45). `ESTADO.md` versionado con `git log` fallaría en CI tras cada merge: ahora es un derivado local sin versionar. | — |
| 021 | 63 archivos ADR para 59 números. ADR-007 son tres versiones de la misma decisión; ADR-014 es un refinamiento; solo ADR-008 son decisiones distintas (propuesta de tabla incluida). Importar `package.json` desde `version.ts` filtraría el JSON al navegador (`Sidebar` es cliente). RN-2 no la verificaba nadie (nuevo check A3). La raíz tenía `HANDOFF.md` sin contemplar. | Tabla de ADRs, header de versión, versionar sí/no |

## Lo que solo tú puedes hacer

Ninguna spec aplica nada a producción. Estos pasos son tuyos, y cada spec se detiene en su PAUSA hasta que los hagas:

- [ ] **GitHub:** ruleset en `main` (PR obligatorio, check `CI Result (all checks passed)`, sin force-push). Decide si el admin puede saltárselo. — SPEC-019
- [ ] **Neon:** branch para shadow DB dentro del proyecto `contaflow-ci` y `SHADOW_DATABASE_URL` en tu `.env.local`. — SPEC-015
- [ ] **GitHub:** environment `production-db` con revisores y el secret `DATABASE_URL_DIRECT` de producción. — SPEC-015
- [ ] **Local:** `PRODUCTION_DB_HOST` en tu `.env.local` (el guard de scripts operativos falla cerrado sin él). — SPEC-015
- [ ] **Producción:** correr `prisma migrate status` contra prod y pegar la salida en la spec. — SPEC-015
- [ ] **Sentry:** eventos `tenant_assert_violation` de los últimos 30 días (puedes pedírselo a Claude con el MCP de Sentry). — SPEC-016
- [ ] **Decisión:** si un mapa de scope vacío debe tumbar el arranque en `enforce` (recomendado) o seguir degradando en silencio. — SPEC-016
- [ ] **Vercel:** `TENANT_ASSERT_MODE=enforce` en Preview y, una semana después, en Production (una variable nueva exige redeploy). — SPEC-016
- [ ] **Decisiones:** tabla de ADRs, header de versión, versionar o no; crear y empujar el tag si eliges versionar. — SPEC-021

## Cómo seguir

1. Revisa las specs y cambia `estado: APROBADA` en la primera (`SPEC-014`).
2. Pega:

```text
/implementar SPEC-014
```

Repite con la siguiente spec del índice solo cuando la anterior esté mergeada y su estado sea `HECHA`.

## Corrección a la revisión inicial

En la revisión original se dijo que el aislamiento multi-tenant dependía de un grep, y luego se corrigió diciendo que el assert "no cubre SQL crudo ni operaciones de fila única". La verificación contra el código lo afina otra vez:

`src/lib/prisma-tenant-assert.ts` (ADR-044 D-3) deriva el mapa de modelos tenant del DMMF y afirma `companyId` en operaciones multi-fila **y** en las de fila única por clave (D-3-bis), con una sola exención: `where: { id }` a secas. El SQL crudo ya está inventariado (D-8.2) por un test de arquitectura. Lo que falta de verdad:
- corre en modo `report` por defecto;
- ningún flujo cross-company está anotado con `unscoped()` (D-3b), de modo que `enforce` rompería crons, webhooks y la resolución de empresas del usuario;
- la exención `where: { id }` depende de que cada action valide pertenencia, y no existe un contexto de empresa de la request contra el que verificar;
- el gate de CI sigue siendo el grep ADR-004.

SPEC-016 parte de eso.
