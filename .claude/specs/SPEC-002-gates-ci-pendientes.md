---
id: SPEC-002
titulo: Activar los gates de CI pendientes (Prettier, integración, accesibilidad)
estado: APROBADA
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
- [ ] CA-1: `pnpm format:check` pasa en local y en CI.
- [ ] CA-2: El commit de formateo está en `.git-blame-ignore-revs` y no tiene cambios de lógica (`tsc` y `vitest` en verde antes y después).
- [ ] CA-3: El job `integration` crea el branch, aplica migraciones, corre los tests y borra el branch; el log lo muestra.
- [ ] CA-4: Con un test de integración que falla a propósito, el branch igual se borra (se prueba una vez y se revierte).
- [ ] CA-5: Los 5 componentes de la sección 8 tienen test de a11y en verde, o la lista de violaciones queda reportada si no se corrigen aquí.
- [ ] CA-6: Ningún secreto se imprime en los logs del job.

## 10. Plan de agentes

| Paso | Agente | Subtarea | TDD |
|---|---|---|---|

## 11. Riesgos y preguntas abiertas
- **P-1 (RESUELTA 2026-10-02):** `NEON_API_KEY` (key personal, nombre `github-ci-integration`) y `NEON_PROJECT_ID` creados por el usuario como secretos de repositorio. No hay organización en Neon, así que no existe key por proyecto: el job debe operar solo sobre `NEON_PROJECT_ID`, borrar solo branches propios con prefijo `ci-` y nunca el branch por defecto ni el de producción.
- **P-2 (RESUELTA 2026-10-02):** orden de ejecución B (job de integración) → C (a11y) → A (Prettier masivo) **al final**, cuando no haya PRs ni worktrees abiertos (hoy hay 6 PRs abiertos). Antes de A, mergear o cerrar los PRs pendientes.
- **P-3 (RESUELTA 2026-10-02):** el job de integración corre solo en pull requests hacia `main`.
- **Pendiente técnico:** el branch padre del que clonar el efímero se consulta por la API de Neon al implementar (nota de 2026-08-09: `br-rough-sound-ai9i4g7p`; verificar que siga vigente).
- **R-1:** si la Spec 001 se implementa antes que esta, sus tests de integración no correrían en CI. Conviene hacer esta primero, o al menos la parte B.
- **R-2:** las violaciones de a11y que salgan pueden ser muchas. Si pasan de unas pocas por componente, se abre una spec aparte para corregirlas.

## 12. Cierre
- Commits:
- Tests: antes N → después N
- ADR creado o actualizado:
- Lección aprendida (LL-XXX):
