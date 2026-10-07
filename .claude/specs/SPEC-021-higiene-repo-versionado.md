---
id: SPEC-021
titulo: Higiene documental, ADRs y una sola fuente de versión
estado: BORRADOR
fecha: 2026-10-07
rama: chore/spec-021-higiene-repo
arbol: "[11]"
zonas: [Z-4, Z-5]
adrs: []
---

# Higiene documental, ADRs y una sola fuente de versión

## 1. Problema
- **ADRs con colisiones de número** (63 archivos `ADR-*.md` para 59 números):
  - `ADR-007.md`, `ADR-007-rls-row-level-security.md` y `ADR-007-addendum.md`: tres textos de la **misma** decisión (RLS). `ADR-007.md` está `IMPLEMENTED` y corregido por ADR-044; `-rls-row-level-security` es el diseño posterior con `SET LOCAL ROLE`; el addendum consolida los prerrequisitos del rol `authenticated` y dice complementar a `ADR-007.md`.
  - `ADR-008-bank-reconciliation-schema.md` (2026-04-06) y `ADR-008-inflation-adjustment.md` (2026-04-07): dos decisiones **distintas** con el mismo número.
  - `ADR-014-nom-d-prestaciones.md` (2026-04-15, "DECIDIDO") y `ADR-014-nom-d-architecture.md` (2026-04-16, "VALIDADO", cuya cabecera dice referenciar al primero como "8 decisiones preexistentes"): el segundo refina al primero.
  - Falta el 050.
  - Hay `security-findings-*.md` (3 archivos) dentro de `.claude/adr/`; ya existe `.claude/security/` con `fase-28d-pre-audit.md`.
  - `ADR-015-BORRADOR-eventos-extemporaneos.md` lleva "BORRADOR" en el nombre, pero su estado es `ACEPTADO — ALCANCE REDUCIDO por ADR-055`.
  - Solo 18 de 63 archivos tienen una línea `**Status**` y los valores no son uniformes (`DECIDED ✅`, `IMPLEMENTED ✅`, `ACEPTADO ✅`…).
  - `DECISIONS.md` es un registro paralelo.

  Una cita "ADR-008" en código o en una spec es ambigua. Hoy hay 62 menciones de `ADR-007`, 23 de `ADR-008` y 44 de `ADR-014` en `src/`, `scripts/`, `.claude/`, `.github/`, `docs/` y `CLAUDE.md`.
- **`docs/`** acumula 11 archivos `auditoria-*-prompt-*.md` (prompts de auditorías ya ejecutadas) que ya no son la fuente de nada. Además hay `docs/homologacion/` (documentación de la homologación SENIAT) que se queda.
- **Contexto que se carga en cada sesión:** `contaflow-context-v3.md` (190 KB) y `contaflow-contract.md` (94 KB) están en la raíz junto al código. La raíz tiene además `HANDOFF.md` (el handoff del sistema de botones, ya ejecutado) y `design/` (3 PNG que ese handoff cita).
- **Versión en cuatro sitios que no coinciden:**

  | Dónde | Valor |
  |---|---|
  | `package.json` | `0.1.0` |
  | `src/lib/version.ts` `APP_VERSION` | `0.1.0` |
  | `vercel.json` `X-ContaFlow-Version` | `1.0.0` (hardcodeado) |
  | `CHANGELOG.md` | `[1.0.0] - Por definir`, con enlaces de comparación a `GustavoAU/modern-cg1` (el repo se llama `GustavoAU/contaflow`) |

  Hay 0 tags. `version-and-release.yml` y `scripts/release.sh` nunca se han usado.
- **Exposición innecesaria:** el header `X-ContaFlow-Version` revela la versión a cualquier cliente, lo que contradice el criterio de `poweredByHeader: false` en `next.config.ts` (reducir fingerprinting).

## 2. Base legal / contable
`src/lib/version.ts` contiene `CERTIFIED_VERSION` (R-7, Z-4/Z-5), ligado a homologación SENIAT. **Esta spec no toca `CERTIFIED_VERSION` ni su lógica**, y con el diseño elegido en F ni siquiera edita `version.ts`.

## 3. Alcance
**Incluye:**
- A) **Renumeración de ADRs.** `arch-agent` confirma esta tabla (propuesta de partida basada en la lectura de las cabeceras) y el usuario la aprueba (PAUSA) antes de mover nada:

  | Archivo actual | Destino | Motivo |
  |---|---|---|
  | `ADR-007.md` | `ADR-007.md` (canónico) | Implementado; es el que ADR-044 corrige |
  | `ADR-007-rls-row-level-security.md` | `ADR-007a-rls-set-local-role.md` | Diseño posterior de la misma decisión |
  | `ADR-007-addendum.md` | `ADR-007b-addendum-rol-authenticated.md` | Complemento |
  | `ADR-008-bank-reconciliation-schema.md` | `ADR-008.md` (conserva el número, el más antiguo) | |
  | `ADR-008-inflation-adjustment.md` | `ADR-061-inflation-adjustment.md` (o el siguiente libre al implementar) | Decisión distinta |
  | `ADR-014-nom-d-prestaciones.md` | `ADR-014.md` (canónico) | |
  | `ADR-014-nom-d-architecture.md` | `ADR-014a-nom-d-architecture.md` | Refina al anterior; no es una decisión nueva |
  | `ADR-015-BORRADOR-eventos-extemporaneos.md` | `ADR-015-eventos-extemporaneos.md` | El nombre contradice el estado |
  | `security-findings-*.md` (3) | `.claude/security/` | No son ADRs |

  - El "siguiente libre" se calcula en el momento de implementar: otras ramas pueden haber creado ADR-061 mientras tanto.
  - Los sufijos `a`/`b` mantienen válidas las 62 citas de `ADR-007` y las 44 de `ADR-014` (la familia se cita por el número canónico). Solo las 23 de `ADR-008` exigen revisión manual para decidir a cuál de las dos decisiones apuntan.
  - ADR-050: registrar en el índice que no existe (hueco deliberado), sin crear archivo.
  - Contenido vigente de `DECISIONS.md` → ADRs cortos o una sección "Decisiones menores" del índice; `DECISIONS.md` queda como enlace.
  - Cada ADR fusionado o reemplazado queda con `Status: REEMPLAZADO` y un puntero (RN-1). No se reescribe su contenido.
- B) **Normalizar la línea `Status:`** de los 63 ADRs a una sola línea `- **Status**: <valor>` con el vocabulario `{BORRADOR, ACEPTADO, REEMPLAZADO, DEPRECADO}` (`DECIDED`/`IMPLEMENTED` → `ACEPTADO`, conservando la nota entre paréntesis). Es solo metadato, no contenido.
- C) **Actualizar referencias:** `grep -rnE "ADR-0(07|08|14)"` en `src/`, `scripts/`, `.claude/`, `docs/`, `CLAUDE.md` y `.github/`. Cada cita ambigua de ADR-008 se reescribe al id final. Las referencias en comentarios de código cuentan.
- D) **Índice `.claude/adr/README.md`:** tabla id → título → estado → reemplaza/reemplazado por. Los checks A1/A2 de SPEC-020 pasan de advertencia a error. Se añade el check **A3** (aquí, no en SPEC-020): toda cita `ADR-\d{3}[a-z]?` en el repo resuelve a exactamente un archivo de `.claude/adr/` (o al hueco 050 declarado). Es lo que RN-2 afirma y hoy no verifica nada.
- E) **`docs/`:** mover `auditoria-*-prompt-*.md` a `docs/archivo/auditorias/` con un README de una línea por archivo (qué auditó, fecha, resultado). `historial-fases.md`, `auditoria-stride-2026-07.md` y `homologacion/` se quedan.
- F) **Raíz:**
  - `contaflow-context-v3.md` y `contaflow-contract.md` → `.claude/contexto/`, actualizando las rutas en `CLAUDE.md`, agentes, comandos, ADRs y la plantilla de PR (hoy 19 archivos las citan). Las notas de memoria del propio usuario, fuera del repo, también las citan: avisar para que las actualice.
  - `HANDOFF.md` → `docs/archivo/` (el handoff de botones está ejecutado); `design/*.png` → `docs/archivo/design/` junto a él (HANDOFF.md los cita por ruta relativa, hay que corregirla).
  - La raíz queda con: config (`package.json`, `tsconfig.json`, `next.config.ts`, `vercel.json`, `Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh`, etc.), `README.md`, `CLAUDE.md`, `CHANGELOG.md`, `DECISIONS.md` (como enlace), `DEPLOYMENT.md`, `RUNBOOK.md`. (`ESTADO.md` ya no se versiona; ver SPEC-020.)
- G) **Una sola fuente de versión.**
  - **No** importar `package.json` desde `src/lib/version.ts`: `Sidebar.tsx` (componente `"use client"`) importa ese módulo, y un import de JSON completo incrustaría en el bundle del navegador la lista de dependencias y los scripts, justo lo que el punto de fingerprinting quiere evitar.
  - Diseño elegido: `APP_VERSION` se queda como literal y un test (`src/lib/__tests__/version.test.ts`) afirma que coincide con `package.json`. `version.ts` no se edita (RN-4 se cumple trivialmente). Alternativa descartable: inyectar `NEXT_PUBLIC_APP_VERSION` desde `next.config.ts`.
  - El header `X-ContaFlow-Version` se **elimina** de `vercel.json` (fingerprinting). Si el usuario lo quiere conservar, se emite desde `next.config.ts` con `APP_VERSION`.
- H) **Releases (PAUSA — decide el usuario), una de dos:**
  - **H1 — adoptar versionado:** primer tag `v0.1.0` en el commit actual de `main`; `CHANGELOG.md` sección `[0.1.0]` generada desde los títulos de los PRs mergeados (script de un solo uso con `gh pr list --state merged`) y enlaces de comparación corregidos a `GustavoAU/contaflow`; `release.sh` revisado para que lea la versión de `package.json` y cree el tag; el workflow existente publica el release.
  - **H2 — no versionar todavía:** borrar `version-and-release.yml` y `scripts/release.sh`, dejar `CHANGELOG.md` con una línea que explique que el historial vive en los PRs y en `pnpm estado`.

**No incluye (explícito):**
- Cambiar `CERTIFIED_VERSION` o cualquier lógica de R-7/Z-4/Z-5.
- Reescribir el contenido de los ADRs más allá de la fusión de duplicados y la línea `Status:`.
- Partir los archivos dios (`PayrollRunService.ts` 1950 líneas, etc.): queda como deuda para specs por módulo.

## 4. Reglas de negocio
- RN-1: Ningún id de ADR se reutiliza ni se borra: un ADR fusionado queda como `REEMPLAZADO` con puntero.
- RN-2: Tras la spec, toda cita `ADR-XXX` en el repo resuelve a exactamente un archivo (lo verifica `check:specs`, check A3).
- RN-3: `APP_VERSION === package.json#version` (test).
- RN-4: `CERTIFIED_VERSION` y su test no cambian (diff vacío en esas líneas; con el diseño de G, `version.ts` ni se toca).

## 5. Asientos contables
No aplica.

## 6. Modelo de datos
Sin cambios de schema.

## 7. Contrato de servicio y actions
No aplica. Movimientos de archivos con `git mv` (conservan historial). Archivos editados: `CLAUDE.md`, `.claude/agents/*.md`, `.claude/commands/*.md`, `.github/pull_request_template.md`, `vercel.json`, `CHANGELOG.md`, `scripts/specs/check.ts` (check A3) y comentarios con citas de ADR. Nuevo: `src/lib/__tests__/version.test.ts`.

## 8. UI
Verificar que el footer o cualquier sitio que muestre `APP_VERSION` sigue mostrando `0.1.0`.

## 9. Criterios de aceptación
- [ ] CA-1: `ls .claude/adr/ADR-*` no tiene dos archivos con el mismo número (salvo sufijo `a`/`b` de addendum).
- [ ] CA-2: `pnpm check:specs` con A1/A2 en modo error y el nuevo A3 termina en 0 errores.
- [ ] CA-3: Test de `version.ts`: `APP_VERSION` coincide con `package.json`; `CERTIFIED_VERSION` sigue siendo `null`.
- [ ] CA-4: `curl -I` contra el preview de Vercel no devuelve `X-ContaFlow-Version` (o devuelve la versión real, según la decisión de G).
- [ ] CA-5: La raíz contiene solo los archivos listados en F.
- [ ] CA-6: Decisión H registrada en la sección 11 y aplicada.
- [ ] CA-7: Las 23 citas de `ADR-008` apuntan a su decisión correcta (revisadas a mano; lista en la sección 12).

## 10. Plan de agentes

## 11. Riesgos y preguntas abiertas
- **PAUSA — requiere al usuario:** aprobar la tabla de renumeración de ADRs (A), la decisión del header (G) y H1/H2 (H). Crear y empujar el tag es del usuario.
- R-1: Mover `contaflow-context-v3.md` rompe rutas en agentes y comandos. Grep exhaustivo de `contaflow-context` y `contaflow-contract` antes del commit.
- R-2: Las specs ya cerradas citan ADRs por número. Se actualizan las citas pero no su contenido.
- R-3: Hacer esta spec **después** de SPEC-020, para que las colisiones las detecte la herramienta y no una lista manual.
- R-4: Si SPEC-014 ya subió `version-and-release.yml` a checkout v5 y se elige H2, ese archivo se borra: el cambio se descarta sin más.

**Verificación fase 1 (2026-10-07, contra `origin/main` faca04a6):**
- Confirmado: las colisiones 007 ×3, 008 ×2, 014 ×2 y la ausencia de 050; `security-findings-*.md` ×3 en `.claude/adr/`; 11 archivos `auditoria-*-prompt-*.md` en `docs/`; `contaflow-context-v3.md` 189 851 bytes y `contaflow-contract.md` 93 624 bytes; `package.json` 0.1.0, `version.ts` `APP_VERSION` 0.1.0 y `CERTIFIED_VERSION = null`, `vercel.json` `X-ContaFlow-Version: 1.0.0`, `CHANGELOG` `[1.0.0] - Por definir`; 0 tags; `poweredByHeader: false` en `next.config.ts`; `resolveJsonModule` ya está activo.
- Corregido: la afirmación "11 versiones" de `docs/` son 11 archivos de prompts; `docs/homologacion/` existe y se queda.
- Corregido: `.claude/security/` ya existe.
- Corregido: la lista de la raíz omitía `HANDOFF.md` y `DECISIONS.md`; CA-5 habría fallado.
- Corregido: "ADR-014: ADR-014 + ADR-062" era un número innecesario; el segundo es un refinamiento del primero y entra como `ADR-014a`. Los ids nuevos no se fijan de antemano.
- Corregido: importar `package.json` desde `version.ts` filtraría el JSON completo al navegador (`Sidebar.tsx` es `"use client"` e importa ese módulo).
- Corregido: RN-2 afirmaba que `check:specs` verifica las citas, pero ni SPEC-020 ni A1/A2 lo hacían; se añade A3.
- Corregido: A2 (SPEC-020) exigía `Status:` en todos los ADRs sin que esta spec los normalizara; se añade B.
- Corregido: los enlaces de `CHANGELOG.md` apuntan a `GustavoAU/modern-cg1`.
- No comprobado: el contenido completo de cada ADR duplicado (solo se leyeron cabeceras); por eso la tabla de A es una propuesta que `arch-agent` debe confirmar.

## 12. Cierre
