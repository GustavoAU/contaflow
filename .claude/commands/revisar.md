---
description: Revisión pre-merge del diff de la rama actual contra su spec y el checklist de CLAUDE.md
argument-hint: "[SPEC-XXX] (opcional; si se omite, se deduce de la rama)"
---

# /revisar — revisión pre-merge

Spec (opcional): **$ARGUMENTS**

Solo lectura y diagnóstico. **No corrijas nada** en este comando: reporta, y el usuario decide.

## Paso 1 — Qué se revisa

1. `git diff main...HEAD --stat` y `git log main..HEAD --oneline`.
2. Spec: la de `$ARGUMENTS`, o la de `.claude/specs/` cuyo `rama:` coincida con la rama actual. Si no hay spec, revisa solo contra el checklist y dilo.

## Paso 2 — Gates automáticos

```bash
git status --short
npx tsc --noEmit
npx vitest run
pnpm lint
pnpm verify:schema-format
pnpm verify:rls
pnpm verify:drift
```

Reporta cada uno como OK o FALLA, con la primera línea del error.

## Paso 3 — Revisión contra la spec

- ¿Cada regla de negocio (RN) y cada criterio de aceptación (CA) tienen un test que la cubra? Lista los que no.
- ¿El diff toca archivos fuera del alcance de la spec (sección 3)? Lista cada uno.
- ¿Algo implementado contradice la spec? La spec manda; si la spec estaba mal, se corrige la spec, no se ignora.

## Paso 4 — Checklist de `CLAUDE.md`

Recorre el "Checklist Pre-Merge" de `CLAUDE.md` **solo con los ítems que aplican al diff**. Para cada hallazgo indica archivo:línea y la regla (R-x, Z-x, ADR-xxx).

Revisa con especial cuidado:
- `number` en montos (R-5) → `grep` en el diff.
- Queries sin `companyId` (ADR-004), incluido `$queryRaw` y sus JOIN (ADR-044).
- AuditLog fuera del `$transaction` o sin IP/UA (R-6).
- Mutaciones sin bloqueo de período CLOSED (R-3).
- Accesibilidad en componentes nuevos: labels, foco, `aria-busy`, contraste.

## Paso 5 — Segunda opinión

Si el diff toca Z-1 a Z-5, una action nueva o un modelo nuevo, invoca `security-agent` sobre el diff. Debe ser una revisión independiente: pásale solo la spec y el diff, no tus conclusiones.

## Paso 6 — Veredicto

```
VEREDICTO: LISTO PARA MERGE | CAMBIOS REQUERIDOS

Gates: tsc OK · vitest OK (N tests) · lint OK · …
Bloqueantes:
- archivo:línea — problema — regla
No bloqueantes:
- …
Cobertura de la spec: X/Y criterios con test
```
