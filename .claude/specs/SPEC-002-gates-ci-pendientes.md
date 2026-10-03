---
id: SPEC-002
titulo: Activar los gates de CI pendientes (Prettier, integración, accesibilidad)
estado: EN_CURSO
fecha: 2026-10-01
rama: chore/spec-002-gates-ci
arbol: "[11]"
zonas: []
adrs: []
---

# Activar los gates de CI pendientes

## 1. Problema
Hay tres verificaciones preparadas o necesarias que hoy no corren en `.github/workflows/ci.yml`:

1. **Prettier** está comentado ("237 archivos sin formatear"). Sin ese gate, cada agente formatea distinto y los diffs se llenan de ruido que dificulta revisar.
2. **Tests de integración contra una base real**: existe `vitest.integration.config.ts`, pero el CI no lo ejecuta. Todo lo que depende de Postgres (constraints, RLS, triggers, `Serializable`, P2002 con el adaptador Neon) solo se prueba con mocks. LL-014 es justo un bug que los mocks no detectaron.
3. **Accesibilidad**: no hay tests automáticos de a11y, aunque el proyecto declara WCAG AA.

Cuando el código lo escriben agentes, estos gates son lo que hace confiable la revisión.

## 2. Base legal / contable
Ninguna — decisión de calidad de ingeniería.

## 3. Alcance
**Incluye:**
- A) Formatear toda la base con Prettier en **un commit aislado**, sin otros cambios, y activar el check en CI.
- B) Job de CI de integración que crea un branch efímero de Neon, aplica las migraciones, corre `vitest --config vitest.integration.config.ts` y borra el branch al final, también si falla.
- C) Tests de accesibilidad con `vitest-axe` (o `jest-axe` compatible con Vitest 4) para los formularios de mayor riesgo, más un helper reutilizable.

**No incluye (explícito):**
- Tests E2E con navegador (Playwright). Pueden venir en otra spec.
- Subir los umbrales de cobertura actuales.
- Arreglar violaciones de a11y en componentes fuera de la lista de C. Se reportan, no se corrigen aquí.

## 4. Reglas de negocio
- RN-1: El commit de formateo masivo no contiene ningún cambio de lógica; `git diff -w` sobre él solo muestra cambios de Prettier.
- RN-2: Ese commit se agrega a `.git-blame-ignore-revs` para no contaminar `git blame`.
- RN-3: El job de integración nunca apunta a la base de producción. Usa solo un branch efímero creado y destruido en el propio job.
- RN-4: El branch efímero se borra siempre (`if: always()`), aunque fallen los tests.
- RN-5: El job de integración solo corre si existen los secretos necesarios. En PRs de forks se omite sin fallar.
- RN-6: Los tests de a11y fallan ante violaciones de nivel `serious` o `critical` de axe.

## 5. Asientos contables
No aplica.

## 6. Modelo de datos
Sin cambios de schema. El job aplica las migraciones existentes al branch efímero con el mismo mecanismo que se usa para Neon (ver `scripts/apply-migration-http.mjs` y el workflow manual de `CLAUDE.md`); hay que confirmar cuál es el correcto.

## 7. Contrato de servicio y actions
No aplica. Cambios en:
- `.github/workflows/ci.yml`: descomentar Prettier; nuevo job `integration`; agregar `integration` a los `needs` del job "CI Result" **solo después** de que haya corrido en verde al menos una vez.
- `package.json`: scripts `test:integration` y `format:check`.
- Nuevo helper `src/__tests__/a11y.ts` (o la ruta que siga la convención de tests del repo).

## 8. UI
Componentes con test de a11y en esta spec, porque son los de mayor riesgo fiscal:
- `InvoiceForm`
- `RetentionForm`
- `PayrollRunForm`
- Diálogo de cierre de período / ejercicio fiscal
- Importador de plan de cuentas

Cada test renderiza el componente en jsdom (`// @vitest-environment jsdom` en la primera línea) y corre axe.

## 9. Criterios de aceptación
- [ ] CA-1: `pnpm format:check` pasa en local y en CI. **PENDIENTE (parte A, PR aparte):** la medición real del 2026-10-03 da 821 de 1064 archivos de `src/` sin formatear (el comentario del CI decía 237).
- [ ] CA-2: **PENDIENTE (parte A).** El commit de formateo está en `.git-blame-ignore-revs` y no tiene cambios de lógica (`tsc` y `vitest` en verde antes y después).
- [x] CA-3: El job `integration` crea el branch, aplica migraciones, corre los tests y borra el branch; el log lo muestra. (run 37118866664 y 37119086681; 165 migraciones desde cero, ver ADR-057)
- [x] CA-4: Con un test de integración que falla, el branch igual se borra. Evidencia sin fabricar un fallo: los runs 37118149880 (P2003) y 37118446313 (P2034) fallaron en `Tests de integración`, el paso `Borrar branch efímero` corrió y terminó en success, y `contaflow-ci` quedó solo con `main`.
- [x] CA-5: (6 archivos de test: 3 limpios, 5 casos con deuda real fijada con `expectKnownA11yDebt`; la corrección va en SPEC-003) Los 5 componentes de la sección 8 tienen test de a11y en verde, o la lista de violaciones queda reportada si no se corrigen aquí.
- [x] CA-6: Ningún secreto se imprime en los logs del job. (verificado en los runs 37118866664 y 37119086681: 0 coincidencias de `npg_`, `napi_` y `postgresql://` con credenciales)

## 10. Plan de agentes

Línea base (2026-10-02, main): tsc exit 0 · vitest 5350 tests / 256 archivos, 0 fallos. Plan armado por la sesión principal (orchestrator-agent no estaba disponible).

| Paso | Agente | Subtarea | TDD |
|---|---|---|---|
| 1 | sesión principal | Consultar Neon (solo lectura, MCP): branch por defecto vigente y si el plan permite branch solo-esquema. Decide la estrategia del branch efímero (hijo solo-esquema del default + `prisma migrate deploy`) | no |
| 2 | test-agent | Tests de las guardas de `scripts/ci-neon-branch.mjs` (prefijo `ci-`, nunca default/protegido, nunca otro project id) en RED | sí |
| 3 | sesión principal | Implementar `scripts/ci-neon-branch.mjs` (create/delete vía API de Neon con `fetch`, sin acción de terceros) hasta GREEN | — |
| 4 | sesión principal | Job `integration` en `ci.yml` (solo PR a main, mismo repo, `if: always()` en el borrado, secretos enmascarados), scripts `test:integration`, README de integración. `integration` entra a `needs` de "CI Result" solo tras una corrida verde | no |
| 5 | security-agent | Revisar workflow + script (alcance de la API key personal, inyección vía nombre de rama, fuga en logs, PRs de forks) | no |
| 6 | test-agent | Helper a11y + tests axe de los 5 componentes de la sección 8, en RED por la razón correcta | sí |
| 7 | ui-agent | Solo si el paso 6 destapa violaciones `serious`/`critical` en ≤ unas pocas por componente; si son muchas, se reporta y se abre otra spec (R-2) | — |
| 8 | sesión principal | **PAUSA — requiere decisión del usuario**: Prettier masivo (A) en commit aislado + `.git-blame-ignore-revs` + check en CI, solo con PRs/worktrees abiertos resueltos (hoy 6 PRs) | no |
| 9 | sesión principal | Gates finales, cierre de sección 12, `/revisar` | no |

## 11. Riesgos y preguntas abiertas
- **P-1 (RESUELTA 2026-10-02):** `NEON_API_KEY` (key personal, nombre `github-ci-integration`) y `NEON_PROJECT_ID` creados por el usuario como secretos de repositorio. Verificado 2026-10-02 (MCP de Neon): el proyecto `royal-voice-77113362` pertenece a la organización `org-restless-band-70215756` y el usuario es ADMIN, así que una key de alcance por proyecto (Organization settings → API keys → Project-scoped) probablemente sea posible y más segura que la personal; queda como mejora opcional. Con cualquiera de las dos, el job debe operar solo sobre `NEON_PROJECT_ID`, borrar solo branches propios con prefijo `ci-` y nunca el branch por defecto ni el de producción.
- **Revisión de seguridad (security-agent, 2026-10-02): GO CON CONDICIONES.** Las guardas del script son sólidas; el riesgo real es que un PR del mismo repo ejecuta código propio (workflow, script, tests, scripts de dependencias) con la key personal. Aplicado: `protected: true` en `production` (verificado por la API de Neon), la key solo en los pasos gate/create/delete (no en el env del job), `pnpm install --ignore-scripts`, mensajes de error en una sola línea, paginación que falla cerrada, nombres duplicados rechazados, id de branch validado. **Pendiente del usuario (condición 1 del GO):** GitHub Environment `neon-ci` con revisores requeridos y mover ahí los secretos, y/o key de alcance por proyecto. Sin al menos una, cualquier colaborador con escritura puede ejecutar código con control del proyecto. No verificado aún (primera corrida real): `init_source: schema-only` y `expires_at` en plan Scale; si las credenciales de rol del branch hijo difieren de las de producción.
- **Hallazgo (RESUELTO 2026-10-02):** el branch `production` (`br-rough-sound-ai9i4g7p`, único del proyecto, plan Scale, límite 5000 branches) tiene `protected: false`. Se recomienda activarlo en la consola de Neon como defensa extra contra borrados. Es un cambio de configuración de producción: lo decide y lo hace el usuario.
- **P-2 (RESUELTA 2026-10-02):** orden de ejecución B (job de integración) → C (a11y) → A (Prettier masivo) **al final**, cuando no haya PRs ni worktrees abiertos (hoy hay 6 PRs abiertos). Antes de A, mergear o cerrar los PRs pendientes.
- **P-3 (RESUELTA 2026-10-02):** el job de integración corre solo en pull requests hacia `main`.
- **Primera corrida real (2026-10-03, run 37084879352): FALLÓ, y descubrió el bloqueo.** Neon respondió 412 `project with a legacy web access role do not support schema-only branches; role:"authenticated"`. El paso de borrado corrió bien y no quedó ningún branch huérfano (verificado). Decisión del usuario: **opción 1 — proyecto de Neon dedicado al CI.**
- **Proyecto dedicado (2026-10-03):** `contaflow-ci`, id `jolly-grass-68240438`, org `org-restless-band-70215756`, us-east-1, Postgres 17, tope 1 CU, retención de historial 0. Su branch `main` es el baseline VACÍO; cada corrida clona un branch y aplica las 165 migraciones desde cero (la migración `20260406110000` ya crea el rol `authenticated` con `IF NOT EXISTS`, así que no hace falta preparar roles). El script ya no pide `schema-only`. Con esto el CI no tiene datos ni credenciales de producción al alcance, y la key puede ser de alcance de proyecto (condición 1a del security-agent).
- **Pendiente del usuario:** crear una key de alcance de proyecto para `contaflow-ci` (Organization settings → API keys → Project-scoped), poner en el environment `neon-ci` `NEON_API_KEY` (la nueva) y `NEON_PROJECT_ID=jolly-grass-68240438`, y **revocar la key personal `github-ci-integration`** (alcanza producción).
- **Pendiente técnico:** que las 165 migraciones apliquen desde cero (no probado: se verá en la próxima corrida) y que `expires_at` funcione en el plan Scale.
- **R-1:** si la Spec 001 se implementa antes que esta, sus tests de integración no correrían en CI. Conviene hacer esta primero, o al menos la parte B.
- **R-2:** las violaciones de a11y que salgan pueden ser muchas. Si pasan de unas pocas por componente, se abre una spec aparte para corregirlas.

## 12. Cierre
- Commits:
- Tests: antes N → después N
- ADR creado o actualizado:
- Lección aprendida (LL-XXX):
