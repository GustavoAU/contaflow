---
description: Crea una spec BORRADOR en .claude/specs/ a partir de una idea o un problema
argument-hint: <idea, problema o feature>
---

# /spec — escribir la spec, no el código

Idea del usuario: **$ARGUMENTS**

Tu trabajo en este comando es **diseñar y documentar**. Está prohibido escribir o modificar archivos en `src/` o `prisma/`.

## Paso 1 — Contexto mínimo

1. `.claude/memory/decision-tree.md`: identifica el árbol y las zonas Z-1..Z-5 que toca la idea.
2. Lee solo lo que ese árbol indica: zonas de `CLAUDE.md`, ADRs relacionados (`grep` en `.claude/adr/`) y, si hay asientos, `.claude/ontologia/quick-reference.md`.
3. Busca en `.claude/specs/`, `.claude/design/` y `.claude/adr/` si la idea ya está especificada o decidida. Si existe, dilo y propón actualizar esa spec en vez de duplicarla.
4. Lee el código existente del módulo afectado (servicios, schema, actions) para que la spec describa el sistema real, no uno imaginado.

## Paso 2 — Escribir la spec

1. Siguiente número: `ls .claude/specs/SPEC-*` (si no hay ninguno, `SPEC-001`).
2. Copia `.claude/specs/_TEMPLATE.md` a `.claude/specs/SPEC-XXX-<slug>.md` y completa las secciones 1 a 9 y la 11.
3. Usa `arch-agent` como subagente solo si hace falta decidir schema, concurrencia o contrato entre módulos. Pídele el bloque Prisma y el análisis; **no** le pidas que escriba el ADR todavía.
4. Usa `fiscal-agent` como subagente solo si hay cálculo de impuestos, para validar reglas y base legal.

Reglas para escribir:
- Cada regla de negocio (RN) debe poder convertirse en un test. Si no se puede, está mal escrita.
- Lo que no sepas con certeza legal o contable va en sección 11 como **PREGUNTA PARA CONTADOR**. No inventes alícuotas, cuentas ni plazos.
- Sección 3 "No incluye" es obligatoria: delimita el alcance.
- Si la idea es demasiado grande para una rama, divídela en varias specs y dilo.

## Paso 3 — Entregar

- Deja la spec en `estado: BORRADOR`.
- Responde al usuario con: ruta del archivo, resumen en 3 líneas y la lista de preguntas abiertas.
- Termina con: "Revisa la spec, responde las preguntas y cambia el estado a APROBADA para ejecutar `/implementar SPEC-XXX`."
