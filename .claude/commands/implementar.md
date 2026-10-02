---
description: Implementa una spec APROBADA ejecutando los agentes en el orden del orchestrator
argument-hint: <SPEC-XXX>
---

# /implementar — ejecutar una spec aprobada

Spec: **$ARGUMENTS**

La sesión principal (tú) es quien ejecuta. `orchestrator-agent` solo devuelve el plan: un subagente no puede lanzar otros subagentes.

## Paso 1 — Precondiciones (si alguna falla, PARA y reporta)

1. Localiza `.claude/specs/$ARGUMENTS*.md`. Si no existe, para.
2. El frontmatter debe decir `estado: APROBADA`. Si dice `BORRADOR`, para y responde: "La spec está en BORRADOR. Revísala y apruébala antes de implementar."
3. La sección 11 no debe tener ninguna **PREGUNTA PARA CONTADOR** sin respuesta.
4. `git status` limpio. Si hay cambios ajenos, para.
5. Línea base: `npx tsc --noEmit` y `npx vitest run`. Anota el número de tests. Si algo falla **antes** de empezar, para: no se construye sobre rojo.

## Paso 2 — Plan

1. Crea la rama del frontmatter (`rama:`) desde `main`.
2. Invoca `orchestrator-agent` pasándole la ruta de la spec. Debe devolver la tabla de pasos según su `<feature_flow>` y `<routing_table>`.
3. Escribe ese plan en la sección 10 de la spec y cambia `estado: EN_CURSO`.
4. Muestra el plan al usuario y **espera confirmación** antes de ejecutar.

## Paso 3 — Ejecución, un agente a la vez

Para cada paso del plan, en orden:

1. Invoca al agente indicado. Pásale la ruta de la spec, el paso concreto y los archivos que produjeron los pasos anteriores.
2. Al terminar cada paso:
   - `npx tsc --noEmit` debe dar 0 errores.
   - Paso de test-agent en modo TDD: los tests nuevos deben estar en **RED**, y por la razón correcta (no por un error de import).
   - Paso de implementación: los tests de la spec deben pasar a **GREEN** sin romper los existentes.
3. Si un agente reporta `BLOQUEANTE`:
   - Técnico → vuelve a consultar a `orchestrator-agent` con las dos opciones, aplica su decisión y anótala en la sección 11.
   - Negocio, fiscal o legal → **para** y pregunta al usuario.
4. Si hay schema: sigue el workflow manual de migraciones de `CLAUDE.md`. **No apliques migraciones a la base de producción**; deja el SQL y los comandos para que el usuario los ejecute.

## Paso 4 — Gates finales

Todos en verde, o no se cierra:

```bash
npx tsc --noEmit
npx vitest run
pnpm lint
pnpm verify:schema-format   # si se tocó schema.prisma
pnpm verify:rls             # si hay modelo nuevo
pnpm verify:drift           # si la migración suelta índices o constraints
```

Además:
- `security-agent` si hay nueva superficie: action, ruta, modelo o input de usuario (triggers de `CLAUDE.md`). CRITICAL o HIGH bloquean.
- Cada criterio de aceptación de la sección 9 debe estar cubierto por al menos un test; márcalos `[x]`.

## Paso 5 — Cierre

1. Commits atómicos por capa (schema / servicio / action / UI), con mensajes en el estilo del repo.
2. Completa la sección 12 de la spec y cambia `estado: HECHA`.
3. Si apareció un patrón de error nuevo → agrega una `LL-XXX` en `.claude/lessons-learned.md`.
4. Si hubo una decisión de arquitectura → `arch-agent` escribe o actualiza el ADR.
5. Actualiza el bloque Estado Activo de `contaflow-context-v3.md` con una línea.
6. **No hagas merge a `main`.** Reporta al usuario en máximo 6 líneas: rama, commits, tests antes → después y pendientes.
