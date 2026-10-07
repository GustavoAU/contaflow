---
id: SPEC-020
titulo: Specs y estado del proyecto como datos validados
estado: BORRADOR
fecha: 2026-10-07
rama: chore/spec-020-specs-como-datos
arbol: "[11]"
zonas: []
adrs: []
---

# Specs y estado del proyecto como datos validados

## 1. Problema
El flujo spec-driven es real, pero ninguna herramienta lo valida:

- Una spec puede quedar `HECHA` sin PR y con criterios de aceptación sin marcar.
- Una spec puede quedar `APROBADA` con una `PREGUNTA PARA CONTADOR` abierta.
- Los ADRs tienen la numeración rota (ADR-007 ×3, ADR-008 ×2, ADR-014 ×2, falta el 050) sin que nada lo detecte. Hay 63 archivos `ADR-*.md` para 59 números distintos.
- La línea `Status:` de los ADRs no está estandarizada: solo 18 de 63 archivos tienen una línea `**Status**`, y los valores son `DECIDED ✅`, `IMPLEMENTED ✅`, `ACEPTADO ✅`, `DECIDED`, `ACEPTADO — ALCANCE REDUCIDO por ADR-055…`, etc.
- El frontmatter de las specs existentes tiene comentarios en línea (`estado: HECHA   # mergeada (PR #65…)`) y entradas de texto libre en `adrs:` (`"ADR nuevo: cuadre en BD"`). `SPEC-012` existe en dos archivos: la spec y un anexo sin frontmatter.
- El "Estado Activo" de `contaflow-context-v3.md` se escribe a mano: está inflado, se contradice (dice "Ninguna — branch `main` limpio (2026-10-04)" debajo de entradas del 10-06) y arrastra entradas de junio. El propio `CLAUDE.md` pide verificarlo contra `git log`.

`ai-sdlc` resuelve esto tratando el plan como dato: schema Zod, ~40 checks deterministas (`pnpm check`) y un `pnpm status` derivado, nunca escrito a mano.

## 2. Base legal / contable
Ninguna — decisión de ingeniería.

## 3. Alcance
**Incluye:**
- A) **Schema del frontmatter** en `scripts/specs/schema.ts` (Zod 4):
  - `id: /^SPEC-\d{3}$/`
  - `titulo`
  - `estado: BORRADOR|APROBADA|EN_CURSO|HECHA|DESCARTADA`
  - `fecha: YYYY-MM-DD`
  - `rama`, `arbol` (texto libre: hay valores como `"[3]+[10]"`), `zonas: Z-1..Z-5[]`
  - `adrs: ADR-\d{3}[]`
  - opcionales: `pr: number[]`, `aceptacion: string` (comando de shell que demuestra la spec; lo usa `/implementar`, SPEC-019 D), `depende_de: SPEC-XXX[]`

  El frontmatter se lee con un parser YAML real (`yaml` como devDependency): una expresión regular no entiende los comentarios en línea del frontmatter actual.

  Migrar el frontmatter de las specs existentes **sin cambiar su contenido**:
  - Añadir `pr:` con los números de PR que ya figuran en los comentarios del frontmatter y en `git log` (#51-54 para SPEC-002, #55, #57, #61, #63, #64, #65, #62/#66/#67 para SPEC-012…); los que falten se verifican con `gh pr list --state merged`.
  - Sustituir las entradas de texto libre de `adrs:` por el id real del ADR que nació de la spec (`ADR-060` para SPEC-001, `ADR-058` para SPEC-004).
  - Mover `SPEC-012-anexo-inventario-entrega-b.md` a `.claude/specs/anexos/` (los anexos no tienen frontmatter ni cuentan para S1/S2).
  - Actualizar `_TEMPLATE.md` con los campos nuevos y `README.md` con el estado `DESCARTADA`.
- B) **`pnpm check:specs`** (`scripts/specs/check.ts`, ejecutado con `tsx`). Checks, cada uno con id estable y mensaje accionable:
  - S1: frontmatter válido contra el schema.
  - S2: `id` único y coincide con el prefijo del nombre del archivo.
  - S3: `estado: APROBADA|EN_CURSO|HECHA` ⇒ la sección 11 no contiene `PREGUNTA PARA CONTADOR` ni `BLOQUEANTE` sin una línea de respuesta (`RESUELTA` o `Respuesta:`; ya es la convención de SPEC-002).
  - S4: `estado: HECHA` ⇒ `pr:` no vacío, todos los `- [ ] CA-` marcados `[x]` y la sección 12 no vacía.
  - S5: cada `ADR-XXX` de `adrs:` existe en `.claude/adr/`.
  - S6: `depende_de` sin ciclos y apuntando a specs existentes.
  - A1: los números de ADR son únicos (los addenda se nombran `ADR-007a-…`, no `ADR-007-…`). **Advertencia** mientras SPEC-021 no los renumere; error después.
  - A2: cada ADR tiene una línea `Status:`. **Advertencia** en esta spec: el vocabulario destino es `{BORRADOR, ACEPTADO, REEMPLAZADO, DEPRECADO}`, y los valores heredados (`DECIDED`, `IMPLEMENTED`, `ACEPTADO ✅`…) se aceptan como "legado" con aviso. SPEC-021 normaliza las líneas y la sube a error.

  Salida: `N spec(s), M ADR(s) — E error(es), W advertencia(s)`; exit 1 si `E > 0`. Tests con fixtures en `scripts/specs/__tests__/` (el `vitest.config.ts` ya recoge `scripts/**`, como `neon-ci-guards.test.ts`).
- C) **CI:** `pnpm check:specs` en el job `architecture`.
- D) **Estado derivado, no versionado.** `pnpm estado` (`scripts/specs/estado.ts`) imprime el estado del proyecto y con `--write` lo escribe en `ESTADO.md` (en `.gitignore`: **no se commitea**). Contiene:
  1. Specs `EN_CURSO` y `APROBADA` con rama y dependencias.
  2. Últimas 10 specs `HECHA` con sus PRs.
  3. Pendientes declarados en la sección 11 de specs `HECHA` (líneas que empiezan con `Pendiente`).
  4. `git log --first-parent -10 main`.
  5. PRs abiertos vía `gh pr list` si `gh` está disponible; si no, se omite sin fallar.

  Los puntos 4 y 5 son datos vivos; `--no-live` los omite y es lo que usan los tests, que así son deterministas.

  **Por qué no se commitea (cambio respecto al borrador de esta spec):** una versión que incluya `git log` cambia con cada commit, así que un check de CI "el `ESTADO.md` commiteado coincide con el regenerado" fallaría en `main` después de cada merge. Un archivo generado y versionado es además un imán de conflictos entre ramas paralelas. Lo que sí queda garantizado por CI es lo verificable: `check:specs`.
- E) **Reemplazar el Estado Activo manual:**
  - `CLAUDE.md` "Inicio de sesión" paso 2 pasa a "ejecutar `pnpm estado`".
  - El bloque "ESTADO ACTIVO" de `contaflow-context-v3.md` se mueve íntegro a `docs/historial-fases.md` (que ya existe) y se reemplaza por un enlace a `pnpm estado`.
  - `/implementar` paso 5.5 deja de editar el contexto a mano.
  - Actualizar también las demás referencias: `.claude/memory/decision-tree.md` y `.claude/commands/implementar.md` citan el bloque "Estado Activo"; `.claude/commands/siguiente-paso.md`, `.claude/agents/*` y el checkbox de `.github/pull_request_template.md` (línea 66, "Actualicé `contaflow-context-v3.md` con la fase completada") citan el archivo (`grep -rn "Estado Activo\|contaflow-context"`).

**No incluye (explícito):**
- Renumerar ADRs ni normalizar sus líneas `Status:` (SPEC-021): aquí solo se detecta.
- Cambiar el contenido de specs existentes más allá del frontmatter.
- Integración con JIRA o cualquier tracker externo.

## 4. Reglas de negocio
- RN-1: `ESTADO.md` es un derivado local; nunca se edita ni se versiona.
- RN-2: Una spec no puede llegar a `HECHA` en `main` con criterios sin marcar o sin PR (S4 en CI).
- RN-3: Los checks son deterministas: misma entrada, misma salida; sin red salvo la parte opcional de `gh` de `pnpm estado`.
- RN-4: Cada check tiene un id estable (S1…, A1…) citado en el mensaje, para que el agente sepa qué regla rompió.

## 5. Asientos contables
No aplica.

## 6. Modelo de datos
Sin cambios de schema de BD.

## 7. Contrato de servicio y actions
No aplica. Archivos:
- `scripts/specs/{schema,check,estado}.ts` con sus tests
- `package.json` (`check:specs`, `estado`; `yaml` como devDependency) y `.gitignore` (`ESTADO.md`)
- `.claude/specs/_TEMPLATE.md`, `.claude/specs/README.md` y el frontmatter de las specs existentes; `.claude/specs/anexos/`
- `CLAUDE.md`, `contaflow-context-v3.md`, `docs/historial-fases.md`
- `.claude/commands/implementar.md`, `.claude/commands/spec.md`, `.claude/commands/siguiente-paso.md`, `.claude/memory/decision-tree.md`, `.github/pull_request_template.md`
- `.github/workflows/ci.yml`

## 8. UI
No aplica.

## 9. Criterios de aceptación
- [ ] CA-1: `pnpm check:specs` sobre el repo actual termina con 0 errores tras migrar los frontmatter. Las colisiones de ADR (A1) y las líneas `Status:` ausentes o heredadas (A2) salen como advertencias listadas.
- [ ] CA-2: Fixture: spec `HECHA` con un `- [ ] CA-2` sin marcar ⇒ error S4 que nombra archivo y criterio.
- [ ] CA-3: Fixture: spec `APROBADA` con `PREGUNTA PARA CONTADOR` sin respuesta ⇒ error S3.
- [ ] CA-4: `pnpm estado --no-live` produce una salida idéntica en dos ejecuciones seguidas; `pnpm estado --write` crea `ESTADO.md` y `git status` no lo muestra.
- [ ] CA-5: `CLAUDE.md` ya no referencia el bloque "Estado Activo" manual (`grep -rn "Estado Activo"` limpio en `CLAUDE.md`, comandos y agentes).
- [ ] CA-6: `/spec` crea el frontmatter con el schema nuevo y la spec creada pasa S1.
- [ ] CA-7: El frontmatter con comentarios en línea (`estado: HECHA   # …`) se parsea sin error.

## 10. Plan de agentes

## 11. Riesgos y preguntas abiertas
- R-1: Las specs antiguas (001–013) pueden no cumplir S3/S4 tal como están escritas. Se corrige solo el frontmatter (añadir `pr:`). Si un criterio quedó realmente sin cubrir, se reporta al usuario en vez de marcarlo.
- R-2: Las specs 005, 010 y 011 se mencionan en notas y planes pero no existen como archivo. El checker debe tolerar huecos de numeración (no es error) pero sí reportar una referencia `depende_de` a una spec inexistente.
- R-3: El formato de `Status:` de los ADRs hoy no es uniforme (ver sección 1). El parser debe aceptar `- **Status**: …`, `**Status:** …` y `Status: …`, y no forzar una reescritura masiva en esta spec.
- R-4: `SPEC-009` está `APROBADA` y `SPEC-012` `EN_CURSO` (no `HECHA`): S4 no les aplica, pero S3 sí; si alguna tiene una pregunta sin respuesta, el check la marcará y se resuelve con el dueño, no se oculta.

**Verificación fase 1 (2026-10-07, contra `origin/main` faca04a6):**
- Confirmado: el bloque "Estado Activo" de `contaflow-context-v3.md` contiene "**Ninguna** — branch `main` limpio (2026-10-04)" justo después de entradas del 2026-10-05 y 10-06, y entradas de junio en "Completadas recientes"; `/implementar` tiene un paso 5.5 que edita ese bloque; `docs/historial-fases.md` existe; `tsx` está en devDependencies; `.claude/adr/` tiene colisiones 007 ×3, 008 ×2, 014 ×2 y no tiene 050.
- Corregido: 63 archivos ADR para 59 números (el borrador no daba la cifra); solo 18 tienen una línea `**Status**` y los valores no coinciden con el vocabulario propuesto, así que A2 como error habría fallado en ~45 ADRs; pasa a advertencia y se normaliza en SPEC-021.
- Corregido: el frontmatter real tiene comentarios en línea y texto libre en `adrs:`; el parser y la migración lo contemplan.
- Corregido: SPEC-012 está en dos archivos (spec + anexo sin frontmatter); S2 fallaría.
- Corregido: el borrador comparaba en CI el `ESTADO.md` versionado con el regenerado, incluyendo `git log`: fallaría en cada merge. Rediseñado (punto D).
- Corregido: otras referencias al bloque "Estado Activo" o al archivo de contexto (decision-tree, siguiente-paso, plantilla de PR, agentes) no estaban en la lista de archivos.
- No comprobado: cuántas specs `HECHA` pasan S4 hoy; se mide al implementar.

## 12. Cierre
