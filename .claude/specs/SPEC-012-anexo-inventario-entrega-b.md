# SPEC-012 — Anexo: inventario de la Entrega B (2026-10-05)

Informe de solo lectura del ui-agent sobre los sitios donde se elige una cuenta contable. Base: `main` con la Entrega A
fusionada (PR #62). Lo que no se pudo comprobar leyendo código está marcado como **NO comprobado**.

## 1. Hallazgos que cambian el plan

1. **Conflicto con SPEC-007** (rama `feat/spec-007-entrada-inventario-contrapartida`, HECHA, no fusionada): reescribe el
   selector de `MovementForm.tsx` y la consulta de `inventory/page.tsx` y trae su `MovementForm.test.tsx` (consulta
   `<select>`/`optgroup`). Migrar `MovementForm` antes de que SPEC-007 se fusione garantiza conflicto → va **al final**,
   rebasado sobre SPEC-007.
2. **Solo `FiscalConfigForm` y `GLAccountsForm` usan `Select` de Radix.** Los otros 15 sitios usan `<select>` nativo
   (`<option>{a.code} — {a.name}</option>`, 35 ocurrencias). El CA-limpieza original (ningún `SelectItem`) no los
   detectaría: el test de arquitectura debe cubrir `<option>` además de `SelectItem` (allowlist: `AccountsTable`
   «Cuenta padre», que elige títulos a propósito, y el `Select` de «Tipo» de `JournalEntryForm`).
3. **Trampa de `isPostable`:** quitar `isPostable: true` del `where` no basta; los `select: {id, code, name, …}` y los
   mapeos `({id, code, name, type})` lo descartan y el combobox trataría todo como título (nada elegible). Mapeos que lo
   tiran: `cajachica/page.tsx:28`, `income-distribution/page.tsx:25`, `settings/page.tsx:114-118`,
   `fixed-assets/page.tsx:97/109`, `inventory/page.tsx:174-179` y los `select` de 8 consultas. Mitigación: `isPostable:
   boolean` **obligatorio** en los tipos de props (que `tsc` lo detecte) + un test por página (patrón LOW-4 de A).
4. **Ningún destino valida `isPostable` al guardar** (retención, bancos, presupuestos, caja chica, activos, inflación,
   inventario, nómina, GL, fiscal): solo valida pertenencia a la empresa. Solo el gate protege `Transaction`. Con B los
   títulos viajan a 17 formularios más: el combobox es la única barrera de UI. Seguimiento fuera de B:
   `assertAccountsPostable` en `src/lib/account-guard.ts`.
5. **Defecto latente que B activaría:** `InflationAdjustmentPanel.tsx:51-52` autoselecciona `equityAccounts[0]` y
   `repomoAccounts[0]`; con títulos y orden por código el primero sería un título → RN-19 debe cubrirlo (no estaba en la
   lista de la spec).
6. **`Esc` dentro de un Dialog de Radix** es real (verificado en el código instalado de Radix): el `Esc` del combobox no
   gana. Afecta solo a `CloseCajaDialog` (AlertDialog). `DisposeAssetModal` es un modal propio (sin manejo de teclado).
7. **El `required` nativo desaparece** (el combobox es `<input type=text>`): 9 sitios necesitan validación propia.

## 2. Tabla (52 selectores fijos + N líneas de IncomeDistribution)

| # | Sitio | Selectores | Control / estado | Oblig./Opc. | Riesgo |
|---|---|---|---|---|---|
| 1 | `components/retentions/RetentionList.tsx` | 2 (`liabilityAccountId`, `bankAccountId`) | `<select>` useState | ambos oblig. | Bajo |
| 2 | `bank-reconciliation/components/BankAccountList.tsx` | 1 (`accountId`) | nativo useState | oblig. (`required`) | Bajo |
| 3 | `budgets/components/BudgetDetail.tsx` | 1 (`addAccountId`) | nativo useState | oblig. | Bajo (RN-19) |
| 4 | `cajachica/CajaCajaPageClient.tsx` | 1 (`accountId`, ASSET) | nativo useState | oblig. | Bajo (RN-19) |
| 5 | `cajachica/components/CajaCajaList.tsx` (`CloseCajaDialog`) | 1 (`returnAccountId`) | nativo dentro de AlertDialog Radix | oblig. | Medio |
| 6 | `CajaCajaDepositForm.tsx` | 1 (`sourceAccountId`) | nativo useState | oblig. | Bajo |
| 7 | `CajaCajaMovementForm.tsx` | 1 (`expenseAccountId`) | nativo useState | oblig. | Bajo (RN-19) |
| 8 | `fiscal-close/components/FiscalConfigForm.tsx` | 2 (EQUITY) | **Select Radix** useState | oblig. | Medio |
| 9 | `fixed-assets/components/DisposeAssetModal.tsx` | 3 | nativo; modal propio | oblig. condicionales | Medio |
| 10 | `FixedAssetForm.tsx` | 4 (3 oblig. + 1 opc.) | nativo con `register()` de RHF | mixto | **Alto** (`findBestMatch`, `Controller`) |
| 11 | `FixedAssetList.tsx` (panel INPC) | 1 (EQUITY) | nativo useState | oblig. | Bajo (ancho) |
| 12 | `income-distribution/components/IncomeDistributionForm.tsx` | 1 + N líneas (2 a 20) | nativo useState | oblig. | Medio |
| 13 | `inflation/components/InflationAdjustmentPanel.tsx` | 2 (1 con default, 1 opcional «Sin REPOMO») | nativo useState | mixto | Medio (autoselección) |
| 14 | `inventory/components/InventoryItemForm.tsx` | 2 | nativo SIN estado (`FormData`) | oblig. si es físico | Medio |
| 15 | `inventory/components/MovementForm.tsx` | 1 (`counterpartAccountId`) | nativo `FormData` + `reset()` | oblig. en ENTRADA/AJUSTE | **Alto — esperar SPEC-007** |
| 16 | `payroll/components/PayrollWizard.tsx` | 17 (5 nómina + 5 patronales + 7 beneficios) | nativo useState | todos opcionales | **Alto** |
| 17 | `settings/components/GLAccountsForm.tsx` | 11 vía `AccountSelect` local | **Select Radix**, centinela `__none__` | todos opcionales | Medio-Alto |

Lógica propia que usa la lista y debe ignorar títulos (RN-19): `FixedAssetForm.findBestMatch` + 3 avisos + filtro de
contrapartida; `BudgetDetail.availableAccounts` (botón «Agregar cuenta»); `CajaCajaPageClient/List/MovementForm` (conteos y
avisos «No hay cuentas de tipo…»); `FiscalConfigForm` + `settings/page` (aviso «No hay cuentas de Patrimonio»);
`InflationAdjustmentPanel` (autoselección y avisos); `PayrollWizard` (`accounts.length > 0`); `GLAccountsForm`
(`allAccounts.length`, `saleConfigComplete`/`purchaseConfigComplete`).

Valores iniciales de BD que podrían apuntar a un título o a un id ausente (LOW-3): GL (11), nómina (17), fiscal (2),
bancos, activos fijos, ítems de inventario. **NO comprobado en datos reales** (no se consultó la base): es plausible, porque
antes del 2026-10-04 los títulos eran elegibles y ningún guardado validó `isPostable`.

## 3. Páginas y acciones que deben entregar también los títulos

| Archivo | Cambio |
|---|---|
| `bank-reconciliation/page.tsx:32-36` | quitar `isPostable: true`; añadir `isPostable` al `select` |
| `budgets/page.tsx:33-37` | idem |
| `fixed-assets/page.tsx:28-37` y mapeos `:97`, `:109` | idem + `isPostable` en ambos mapeos |
| `inflation/page.tsx:26-36` (2 consultas) | idem |
| `inventory/page.tsx:86-95` + mapeo `:174-179` | idem (**SPEC-007 reescribe este bloque**) |
| `payroll/config/edit/page.tsx:30-34` | idem |
| `modules/retentions/actions/retention.actions.ts:724-732` | quitar filtro; añadir `isPostable` al select y al tipo; recomendado añadir `deletedAt: null` (falta hoy) |
| `cajachica/page.tsx:23`, `income-distribution/page.tsx:23`, `settings/page.tsx:88` | llamar `getAccountsAction(companyId)` sin `onlyPostable` y pasar `isPostable` en el mapeo |

Tras esto `onlyPostable` queda sin consumidores: retirar el 2.º parámetro de `getAccountsAction` y ajustar
`account.actions.test.ts:661-664` y `transactions/new/page.test.ts:112-114`.

## 4. Decisiones de diseño propuestas para B

- **D1 — `value` huérfano o título.** En el combobox, `selected` solo si la cuenta existe y es `isPostable`; si `value` no
  cumple, texto vacío y `aria-invalid="true"` sin emitir `onChange`. Helper puro «¿este id es elegible en esta lista?».
  Obligatorios: el envío valida «no elegible» con «Selecciona una cuenta de movimiento». **Opcionales** (GL, nómina, REPOMO,
  contrapartida): *decisión del dueño* — (A) normalizar a vacío y avisar qué campos se limpiaron (recomendado) o (B) bloquear
  el guardado hasta resolverlo.
- **D2 — campos opcionales:** prop `clearable` con botón «×» (`aria-label="Quitar la cuenta"`) solo si hay valor; llama a
  `onChange("")`. 30 de los 52 selectores son opcionales. Alternativas descartadas: fila «Sin asignar» dentro de la lista
  (toca navegación/conteos/Tab) y «vaciar + blur = limpiar» (un Backspace borraría una configuración en silencio).
- **D3 — `Esc` en Radix:** `onEscapeKeyDown` del `AlertDialogContent` hace `preventDefault()` si el evento viene de un combobox
  con la lista abierta; el input expone `data-state="open|closed"`.
- **D4 — espacio hacia abajo:** sin detección de colisión; si se ve recorte (`CloseCajaDialog` en 375×667,
  `DisposeAssetModal`), limitar el alto de la lista con `min(18rem, 45vh)`. **NO comprobado en navegador.**
- **D5 — sin `required` nativo:** cada formulario valida el id elegible al enviar y reutiliza su banner de error.
- **D6 — `FormData`/`name`:** #14 y #15 pasan a `useState`; #15 limpia también el estado tras `reset()`; #10 usa `Controller`.
- **D7 — ancho/altura:** en filas flex envolver con ancho explícito; controles compactos pasan `className`.
- **D8 — tipos:** un único tipo con `isPostable: boolean` obligatorio (extiende `AccountOption` con `type`) + helper
  `selectableAccounts()` para conteos, avisos, `disabled` y autoselecciones.
- **D9 — accesibilidad:** `id` + `<label htmlFor>` donde faltan (#1, #3, #6, #9, #10, #14, #15, #16) y `aria-label` único por
  instancia repetida (#12 líneas, #16).

## 5. Qué NO migrar

`AccountsTable` «Cuenta padre (título)» (elige títulos, tiene su test); selectores de «Tipo»; `bankAccountId` de
`PaymentForm`/`PaymentBatchForm`/`RecordPaymentDialog` y de la conciliación (apuntan al modelo `BankAccount`, no al plan de
cuentas); selectores de empleado, moneda, método, motivo. Ojo: en `retention.actions.ts` «bankAccountId» **sí** es una cuenta
del plan.

## 6. Defectos preexistentes fuera de alcance (backlog)

1. **IncomeDistribution:** por línea se ofrecen cuentas de la empresa actual, pero el servidor valida cada `accountId`
   contra `recipientCompanyId` (`IncomeDistributionService.ts:217-220`): elegir una cuenta de la empresa actual para otra
   receptora falla con «no pertenece a esta empresa». Confirmar con el dueño cuál es el caso de uso real.
2. `getAccountsForEnteramientoAction` no filtra `deletedAt: null`.
3. `fixed-assets/page.tsx:33` excluye LIABILITY, así que la «Cuenta origen adquisición (GL)» opcional nunca puede ser una
   CxP; no se sabe si es intencional.
4. Ningún destino valida `isPostable`/`deletedAt` al guardar configuración (ver §1.4).
5. Muchas `<label>` sin `htmlFor`.

## 7. Insumos para los tests en RED

- **CA-19:** un test por página (patrón `transactions/new/page.test.ts`, incluido LOW-4): el `where` conserva `companyId`,
  `deletedAt: null` y el filtro de tipo, **no** contiene `isPostable`; el `select`/mapeo entrega `isPostable`. Ampliar
  `retention-extra.actions.test.ts:125-162` para asertar el `where`.
- **CA-20:** `findBestMatch` es privada: probar vía render de `FixedAssetForm` (título con más palabras clave que la
  cuenta real; pool `[título, 1 movimiento]`; pool solo de títulos → `""`). Equivalentes para `InflationAdjustmentPanel`,
  `BudgetDetail` (botón desactivado si solo quedan títulos) y los avisos «No hay cuentas…» de #4, #5, #7, #8, #13, #16, #17.
- **CA-limpieza:** extender a `<option>`/`SelectItem` con `(a|acc|account).code`; detector ligero (el test de arquitectura
  `idempotency-key-tenant-scope` ya da timeout intermitente por recorrer todo `src`).
- **Tests existentes que se rompen:** `FixedAssetForm.component.test.tsx` (fixtures sin `isPostable`; usa `.value` de
  `<select>`); `account.actions.test.ts:661`; `transactions/new/page.test.ts:112-114`; en SPEC-007 `MovementForm.test.tsx`.
- **Extensión del combobox (paso 0):** `value` título/huérfano, `clearable`, `data-state` y helper de `Esc`.
- En tests de formularios con Radix Select (#8, #17) el disparador es `button role=combobox` y el nuevo es
  `input role=combobox`: filtrar por tag como `JournalEntryForm.test.tsx:119-127`.

## 8. Riesgos NO comprobados

Comportamiento visual de la lista en `CloseCajaDialog`/`DisposeAssetModal` y en 375 px (solo análisis de CSS) · `Esc` de
Radix verificado en el código instalado, no ejecutado · datos reales de configuración (no se consultó la base) · si los
títulos del plan real heredan el `type` de sus hijas (una lista filtrada por tipo podría perder encabezados ancestros) ·
`tsc`/vitest no ejecutados por el agente.
