---
id: SPEC-012
titulo: El selector de cuenta busca por código o por nombre y muestra los títulos (sin poder elegirlos)
estado: EN_CURSO   # Entrega A FUSIONADA (PR #62); Entrega B dividida en B1/B2/B3 (ver §10); Q4 resuelta (alerta y bloquear)
fecha: 2026-10-05
rama: feat/spec-012-selector-cuenta-buscable
arbol: "[10]"      # UI / componente React / formulario
zonas: []
adrs: [ADR-059]
---

# El selector de cuenta busca por código o por nombre y muestra los títulos

## 1. Problema
Feedback de la contadora (2026-10-05), sobre cómo elige hoy una cuenta en un asiento:

> "Sería bueno que en vez de seleccionar la cuenta —porque da así como una lista y tú bajas y las consigues—
> […] si marcas el 1 te muestra las cuentas del 1, si marcas el 2 te muestra las del 2 […] pero si se puede poner el
> número a mano, chévere, porque el contador se las sabe de memoria. O si puedes filtrar o poner el nombre, que también
> te dé la cuenta."

Hoy el campo es un `Select` de lista (Radix). Su único atajo es el *typeahead* por la primera letra del texto
`código — nombre`: saltar al primer `1…`, no escribir `1.1.01.01.001` ni buscar "caja". Un plan real tiene ~160
cuentas de movimiento, así que encontrar una cuenta es recorrer una lista larga. Se repite en ~17 formularios.

Además, desde ADR-059 los selectores **ocultan** los títulos; la contadora dijo (2026-10-04) que "deben aparecer como
títulos y subtítulos, pero no como cuentas seleccionables". El dueño decidió (2026-10-05) que **se muestren, sin poder
elegirlos**.

## 2. Base legal / contable
Ninguna — decisión de usabilidad pedida por la contadora y confirmada por el dueño.

## 3. Alcance
**Incluye:**
- Función pura de búsqueda y de armado de la jerarquía (`filterAccounts`) y componente reutilizable `AccountCombobox`.
- Que los formularios entreguen al componente **también los títulos** (hoy los filtran en la consulta).
- Sustituir el `Select` de cuenta por el combobox, **en dos entregas**: A = componente + asientos manuales
  (`JournalEntryForm`); B = **todos** los demás formularios con selector de cuenta, en un solo PR.
- Tests unitarios, de componente (jsdom) y de accesibilidad; un test de arquitectura que impida volver a un `Select`
  de cuentas.

**No incluye (explícito):**
- Permitir elegir un título (jamás: el gate de asientos ya los rechaza, ADR-053).
- Cambiar qué **tipos** de cuenta ofrece cada formulario (el filtro por tipo se mantiene).
- Búsqueda en el servidor, crear cuentas o títulos desde el selector, favoritas o recientes.
- Selectores que no son de cuentas contables (bancos `BankAccount`, productos, clientes) — `ProductCombobox` no se toca.
- Cambios de modelo, de reglas de negocio o de actions (salvo quitar el filtro `isPostable` de las consultas, §7).

## 4. Reglas de negocio
**Búsqueda**
- RN-1: La búsqueda no distingue mayúsculas ni tildes y recorta espacios (`"Cajá "` = `"caja"`).
- RN-2: Una palabra **numérica** (solo dígitos y puntos) se compara contra el **código sin separadores** por **prefijo**:
  `1`, `1101`, `1.1.01` y `110101001` encuentran `1.1.01.01.001`; `1.1.01.01.001` y `110101001` son equivalentes.
- RN-3: Una palabra **con letras** se busca como "contiene" dentro del **nombre**. Varias palabras se combinan con **Y**
  y en cualquier orden (`principal caja` encuentra `Caja Principal`).
- RN-4: Una palabra numérica también puede coincidir con el nombre (cuentas como "Retención 75%"): se acepta si cumple
  RN-2 **o** aparece en el nombre.
- RN-5: Las filas se ordenan siempre en orden **jerárquico por código** (numérico por segmentos, como el plan de
  cuentas): un título va antes que sus descendientes. La coincidencia **exacta** de código no reordena la lista: pasa a
  ser la **opción activa inicial** (RN-13).
- RN-6: Con la consulta vacía se muestra la jerarquía completa (títulos y cuentas), en orden de código.
- RN-7: **Con consulta**, se muestran como máximo 100 cuentas **seleccionables** (las primeras en orden jerárquico, con
  los títulos ancestros de las que quedan, sin encabezados huérfanos); si hay más, el aviso "Mostrando las primeras 100.
  Escribe más para afinar." (solo con 101 o más; con exactamente 100 no hay aviso). Los encabezados no cuentan para el
  tope. **La consulta vacía queda exenta del tope** (RN-6: el plan completo, ~160 cuentas, se ve entero).

**Títulos (encabezados no seleccionables)**
- RN-8: Un título (`isPostable = false`) se muestra como **encabezado**: texto en gris y negrita, **sangrado según su
  nivel** (número de segmentos del código: `1` → 1, `1.1` → 2, `1.1.01` → 3, `1.1.01.01` → 4) y nunca se puede elegir
  (ni con clic, ni con Enter, ni con Tab).
- RN-9: Con consulta, solo se muestran las cuentas que coinciden **más sus títulos ancestros** (la cadena completa
  `A`, `A.B`, `A.B.CC`, `A.B.CC.DD`, sin repetirlos) como contexto. Un título **sin ninguna cuenta de movimiento debajo en el
  resultado no aparece**, aunque él mismo coincida (no hay nada que elegir ahí).
- RN-10: Si un **título** coincide con la consulta (RN-2 o RN-3 sobre su código o nombre), se incluyen **todas** sus
  cuentas de movimiento descendientes (código con el prefijo `título.`): buscar `cajas` trae todo el grupo CAJAS.
- RN-11: Un título que **solo** aparece como contexto o que coincide no cuenta como resultado: el contador de
  resultados ("{n} cuentas") y la regla de "un solo resultado" (RN-14) consideran solo cuentas de movimiento.

**Selección y teclado**
- RN-12: Cada cuenta de movimiento se muestra como `código — nombre`.
- RN-13: Flechas ↑/↓ mueven la opción activa **saltándose los encabezados**; **Enter** elige la activa; **Esc** cierra sin
  cambiar el valor. Al filtrar, la opción activa inicial es la cuenta cuyo código coincide **exactamente** con la
  consulta (ignorando puntos), si existe; si no, la primera cuenta seleccionable.
- RN-14: Si la consulta deja **exactamente una** cuenta de movimiento seleccionable, **Enter** o **Tab** la eligen (el
  contador teclea el código de memoria y sigue con el siguiente campo), aunque haya encabezados de contexto. Con varias,
  Tab no elige nada.
- RN-15: Al salir del campo sin elegir, el texto se restaura a la cuenta ya seleccionada (o queda vacío si no había):
  nunca queda texto libre que no corresponda a una cuenta.
- RN-16: Sin cuentas coincidentes: "No hay cuentas que coincidan con «{consulta}»" (sin encabezados).

**Integración**
- RN-17: Contrato idéntico al `Select` actual: recibe `value` (id de cuenta o `""`) y emite `onChange(accountId)`;
  funciona con `react-hook-form` (`FormControl` + `FormMessage`, error "Selecciona una cuenta").
- RN-18: Cada formulario entrega las cuentas de **su** conjunto (mismo filtro por tipo/empresa de hoy) **incluyendo los
  títulos de esos tipos**; el componente decide qué es seleccionable por `isPostable` y no consulta nada.
- RN-19: La lógica propia de cada formulario (autoselección, validaciones, cálculos) usa **solo** las cuentas de
  movimiento; los títulos son solo para mostrar. En particular `FixedAssetForm.findBestMatch` nunca elige un título.
- RN-20: Cambios externos del valor (la autoselección anterior o un reset del formulario) se reflejan en el texto mostrado.
- RN-21: Soporta `disabled` y `aria-invalid`.

## 5. Asientos contables
No genera ni modifica asientos.

## 6. Modelo de datos
Sin cambios de schema. Sin migración. Sin dependencias nuevas (se usa `radix-ui`, ya instalada, o un listbox propio
como `ProductCombobox`).

## 7. Contrato de servicio y actions
No hay actions nuevas. Cambios en las existentes (solo datos que se entregan al cliente):
- `getAccountsAction(companyId, { onlyPostable })`: el parámetro `onlyPostable` deja de usarse en los formularios
  (`transactions/new`, `cajachica`, `income-distribution`, `settings`); se retira si no queda ningún consumidor.
- Las consultas `prisma.account.findMany` de las páginas que alimentan un selector dejan de filtrar `isPostable: true`
  (conservan `companyId`, `deletedAt: null` y su filtro por tipo): `bank-reconciliation`, `budgets`, `fixed-assets`,
  `inflation` (×2), `inventory`, `payroll/config/edit` y `retention.actions.ts`.
- Lectura de datos de la propia empresa: sin impacto de seguridad (mismos roles y `companyId` que hoy).

```ts
// src/lib/account-search.ts (puro, sin React)
export type AccountOption = { id: string; code: string; name: string; isPostable: boolean };
export type AccountRow = {
  option: AccountOption;
  selectable: boolean; // = option.isPostable
  depth: number;       // segmentos del código (1..5)
};
export function normalizeSearch(text: string): string;
export function filterAccounts(accounts: readonly AccountOption[], query: string): AccountRow[]; // RN-1..RN-11
export function selectableCount(rows: readonly AccountRow[]): number;

// src/components/accounting/AccountCombobox.tsx
export function AccountCombobox(props: {
  accounts: readonly AccountOption[];  // títulos Y cuentas de movimiento
  value: string;                       // accountId (de una cuenta de movimiento) o ""
  onChange: (accountId: string) => void;
  id?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  disabled?: boolean;
  placeholder?: string;                // por defecto "Buscar por código o nombre…"
  className?: string;
}): JSX.Element;
```
- Roles/limiter/AuditLog/período CLOSED: no aplican (solo UI y lectura).

## 8. UI
- **Entrega A:** `src/components/accounting/JournalEntryForm.tsx` (columna "Cuenta" de cada fila) y
  `src/app/(dashboard)/company/[companyId]/transactions/new/page.tsx`.
- **Entrega B** (inventario a confirmar por el ui-agent: algunos pueden ser `<select>` nativo): `RetentionList`,
  `BankAccountList` (cuenta contable de la cuenta bancaria), `BudgetDetail`, `CajaCajaPageClient`, `CajaCajaList`,
  `CajaCajaDepositForm`, `CajaCajaMovementForm`, `FiscalConfigForm`, `DisposeAssetModal`, `FixedAssetForm`,
  `FixedAssetList`, `IncomeDistributionForm`, `InflationAdjustmentPanel`, `InventoryItemForm`, `MovementForm`
  (inventario), `PayrollWizard`, `GLAccountsForm`, y las páginas que les entregan las cuentas (§7).
- Estados: **vacío** (sin cuentas ofrecidas: campo deshabilitado con "No hay cuentas disponibles"), **sin resultados**
  (RN-16), **cargando** no aplica (la lista ya está en memoria), **error** (borde y `aria-invalid` + `FormMessage`),
  **éxito** (texto `código — nombre`).
- Aspecto de la lista: encabezados en gris/negrita con sangría por nivel y cursor `default` (no clicables);
  cuentas de movimiento con texto normal, resaltado al estar activas; separación visual entre grupos.
- Accesibilidad: patrón ARIA combobox — `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`,
  lista con `role="listbox"` y cuentas `role="option"`; los encabezados `role="presentation"` (o `role="group"` con
  `aria-labelledby` para el título de 6 dígitos) **sin** `role="option"`, de modo que el lector de pantalla no los ofrezca
  como elegibles; etiqueta asociada (`FormLabel`/`aria-label`); un `aria-live="polite"` anuncia "{n} cuentas" al filtrar
  (RN-11); todo operable con teclado; contraste AA también en el gris de los encabezados (≥ 4.5:1); el foco no se pierde
  al abrir/cerrar la lista. En la grilla de asientos (varias filas) cada fila monta su lista solo cuando está abierta.
- Copy exacto: placeholder "Buscar por código o nombre…"; sin resultados "No hay cuentas que coincidan con «{consulta}»";
  tope "Mostrando las primeras 100. Escribe más para afinar."; sin cuentas "No hay cuentas disponibles".

## 9. Criterios de aceptación
- [x] CA-1: Dadas `1.1.01.01.001`, `1.1.02.01.001`, `2.1.01.01.001`, la consulta `1` devuelve las dos primeras en
      orden de código, más sus títulos ancestros (lo que la contadora observó con el *typeahead*).
- [x] CA-2: `110101001`, `1.1.01.01.001`, `1.1.01` y `1101` encuentran `1.1.01.01.001`; `1.1.02` no.
- [x] CA-3: `caja` encuentra `Caja Principal` y las cuentas cuyo nombre contiene "caja"; `CAJÁ` y `caja ` también.
- [x] CA-4: `principal caja` encuentra `Caja Principal` (varias palabras, cualquier orden); `caja banco` no.
- [x] CA-5: el orden de las filas es siempre el jerárquico por código; si la consulta coincide exactamente con el
      código de una cuenta de movimiento, esa cuenta es la opción activa inicial (`aria-activedescendant`).
- [x] CA-6: consulta vacía → jerarquía completa en orden de código, con los títulos como encabezados sangrados por nivel.
- [x] CA-7: más de 100 cuentas seleccionables → 100 y el aviso; los encabezados no cuentan.
- [x] CA-8: sin coincidencias → mensaje RN-16, sin encabezados ni opciones.
- [ ] CA-9 (títulos): un título **no se puede elegir** — clic, Enter y Tab sobre él no emiten `onChange`; no tiene
      `role="option"`; ↓/↑ lo saltan.
- [x] CA-10: con la consulta `caja`, aparece `1.1.01.01.001 — Caja Principal` bajo la cadena de encabezados `1`, `1.1`,
      `1.1.01`, `1.1.01.01` (sin repetirlos); un título sin coincidencias debajo no aparece (RN-9).
- [x] CA-11: una consulta que coincide con un título (`cajas`) incluye todas sus cuentas de movimiento descendientes (RN-10).
- [x] CA-12: un solo resultado seleccionable + Enter (y + Tab) lo elige aunque haya encabezados de contexto; con varios,
      Tab no emite nada. El contador "{n} cuentas" no cuenta los encabezados.
- [x] CA-13: ↓/↑ cambian la opción activa (`aria-activedescendant`) y Enter elige la activa; Esc cierra sin cambios.
- [x] CA-14: salir del campo sin elegir restaura el texto de la cuenta seleccionada (o vacío).
- [x] CA-15: con `value` conocido muestra `código — nombre`; un cambio externo de `value` actualiza el texto (RN-20).
- [x] CA-16: `JournalEntryForm`: sin cuenta, el envío muestra "Selecciona una cuenta"; con cuenta elegida tecleando
      `110101001` + Enter, el payload lleva el `accountId` correcto; intentar elegir un título no cambia el valor.
- [x] CA-17: sin violaciones de axe en el componente (cerrado y abierto, con encabezados) y roles ARIA del patrón.
- [x] CA-18: `disabled` e `aria-invalid` se reflejan en el input.
- [ ] CA-19 (datos): las páginas de la Entrega B entregan títulos y cuentas de movimiento (sin `isPostable: true` en las
      consultas que alimentan un `AccountCombobox`), conservando `companyId`, `deletedAt: null` y el filtro por tipo.
- [ ] CA-20 (RN-19): `FixedAssetForm.findBestMatch` y cualquier autoselección o validación de los formularios migrados
      ignoran los títulos (test con un título que coincidiría mejor que la cuenta).
- [ ] CA-limpieza: test de arquitectura — ningún archivo de `src/` renderiza un `SelectItem` con `account.code`/`a.code`
      (Entrega B).
- [x] CA-sin-regresión (Entrega A): los tests existentes de los formularios migrados siguen en verde (ajustados al nuevo control).

## 10. Plan de agentes
Sin cambios de schema ni de actions → se omite el ARCH GATE y el ledger/fiscal-agent. Línea base (2026-10-05, `main`
`4ec24794`): tsc 0 · **5906 tests** en verde (el test de arquitectura `idempotency-key-tenant-scope` —«Meta: integridad del
enmascarado»— da timeout intermitente de 5 s dentro del shard 3 porque recorre todos los archivos de `src/`; pasa solo y
al repetir; ajeno a esta spec, anotado como pendiente aparte).

La spec se entrega en **dos PR** (Q3). Este plan es el de la **Entrega A**; la Entrega B repite el mismo flujo en la rama
`feat/spec-012b-selector-cuenta-resto-formularios`.

### Entrega A — componente + asientos manuales (rama `feat/spec-012-selector-cuenta-buscable`)
| Paso | Agente | Subtarea | TDD |
|---|---|---|---|
| 1 | test-agent | Tests en RED: `src/lib/account-search.test.ts` (CA-1..CA-8, CA-10, CA-11: normalización, prefijo de código sin puntos, palabras con letras, orden y exacta primero, jerarquía con títulos, cadena de ancestros, grupo completo si coincide un título, tope de 100 sin contar encabezados); `AccountCombobox.test.tsx` jsdom (CA-9 títulos no elegibles por clic/Enter/Tab y saltados por flechas, CA-12..CA-15, CA-18) y `AccountCombobox.a11y.test.tsx` con axe (CA-17, cerrado y abierto); `JournalEntryForm` (CA-16: «Selecciona una cuenta», `110101001`+Enter, no se puede elegir un título) ajustando sus tests actuales. | RED |
| 2 | ui-agent | `src/lib/account-search.ts` (`AccountOption`, `AccountRow`, `normalizeSearch`, `filterAccounts`, `selectableCount`), `src/components/accounting/AccountCombobox.tsx` (patrón ARIA combobox, sin dependencias nuevas), sustituir el `Select` de cuenta en `JournalEntryForm` y entregar títulos + cuentas desde `transactions/new/page.tsx` (`getAccountsAction(companyId)` sin `onlyPostable`, mapeo a `AccountOption` con `isPostable`). Cumplir copy y estados de §8. | GREEN |
| 3 | test-agent | Auditoría de cobertura de lo nuevo (puro 100 %, componente ≥ 90 %); cierra huecos MUST-FIX. | — |
| 4 | security-agent | Revisión ligera (cambia qué datos de la propia empresa llegan al cliente: ahora también los títulos): mismos `companyId`/roles de `getAccountsAction`, sin fuga entre empresas, el título nunca viaja como valor del formulario (el gate de asientos sigue siendo el respaldo), sin `dangerouslySetInnerHTML`. | — |
| 5 | (sesión principal) | Gates: `tsc`, `vitest` (6 shards), `pnpm lint`, `format:check`; CA de la Entrega A marcados `[x]`; ADR-059 (nota del selector buscable); LL si aparece un patrón nuevo; línea en Estado Activo. Commits por capa. **Sin merge.** | — |

### Estado de ejecución — Entrega A HECHA (2026-10-05, sin merge)
- Rama `feat/spec-012-selector-cuenta-buscable`. Pasos: 1 test-agent RED (240 tests + 6 guardas; verificado contra una
  implementación de referencia y 66 mutantes) → 2 ui-agent GREEN (`account-search.ts`, `AccountCombobox.tsx`,
  `JournalEntryForm`, `transactions/new/page.tsx`) → 3 cobertura (lib 97 %, componente 90 % de sentencias) →
  4 security-agent **GO** (0 CRITICAL/HIGH/MEDIUM) → 5 cierre.
- Tests: antes **5906** → después **6155** (+249). tsc 0 · eslint 0 errores · prettier OK.
- Corregidos de la auditoría: LOW-2 (palabras de la consulta sin repetir + `maxLength={64}` en el campo; sin eso 50 000
  palabras repetidas congelaban la pestaña ~2,6 s) y LOW-4 (el test de la página ahora exige que al cliente solo viajen
  `id, code, name, type, isPostable`). Cada uno con su test y mutación verificada.
- Decisiones de la sesión: la consulta vacía no tiene tope de 100 (RN-6/RN-7); un título sin cuentas debajo no aparece
  aunque coincida (RN-9); la coincidencia exacta es solo la opción activa inicial, no reordena (RN-5/RN-13).
- Pendientes para la **Entrega B** (de la auditoría y del ui-agent): ver §11.

### Decisiones del dueño tras el inventario de la Entrega B (2026-10-05, actualizadas con las respuestas de la contadora)
Ver el anexo `.claude/specs/SPEC-012-anexo-inventario-entrega-b.md` (17 sitios, 52 selectores, riesgos y decisiones D1-D9).
1. **La Entrega B se divide** (antes: un solo PR) porque el inventario muestra ~25 archivos y riesgo alto en nómina y activos fijos.
   **Regla de reparto (comprobada el 2026-10-05):** una **página y todos los formularios que ella alimenta migran en la misma
   entrega**. Si no, al quitar `isPostable: true` de su consulta los formularios sin migrar recibirían títulos en un `<select>`
   nativo y se podrían elegir. Páginas compartidas: `cajachica/page.tsx` (crear caja, depósito, movimiento y cierre de caja),
   `fixed-assets/page.tsx` (alta de activo, baja y panel INPC), `settings/page.tsx` (cierre fiscal y cuentas contables) e
   `inventory/page.tsx` (ítems y movimientos).
   - **B1** (esta rama): paso 0 = extender `AccountCombobox` (valor huérfano o título → texto vacío + `aria-invalid`; prop
     `clearable`; `data-state` y ayuda `isAccountComboboxOpen` para `Esc` dentro de AlertDialog) + las páginas **completas**:
     `RetentionList` (acción `getAccountsForEnteramientoAction`), `BankAccountList` (`bank-reconciliation/page`),
     `BudgetDetail` (`budgets/page`), `InflationAdjustmentPanel` (`inflation/page`) y **caja chica completa**
     (`CajaCajaPageClient`/crear caja, `CajaCajaDepositForm`, `CajaCajaMovementForm` y `CloseCajaDialog` de `CajaCajaList`).
   - **B2**: **activos fijos** (`FixedAssetForm`, `DisposeAssetModal`, panel INPC de `FixedAssetList` y su página),
     **ajustes** (`FiscalConfigForm`, `GLAccountsForm` y `settings/page`) y **nómina** (`PayrollWizard` y
     `payroll/config/edit/page`) + alerta que bloquea el guardado (Q4) + retiro de `onlyPostable` de `getAccountsAction`.
   - **B3 (al final)**: **inventario completo** (`InventoryItemForm`, `MovementForm` e `inventory/page.tsx`), **después** de
     que SPEC-007 se fusione (esa rama reescribe el selector de `MovementForm` y la misma consulta de la página; y los dos
     formularios comparten página).
   - **Fuera de SPEC-012:** `IncomeDistributionForm`. Tiene un fallo de diseño previo (las cuentas por línea se validan contra
     la empresa **receptora** pero el formulario ofrece las de la empresa actual); el dueño decidió arreglarlo con una **spec
     propia**, y migrar su selector antes de eso sería rehacerlo dos veces.
2. **Q4 — RESUELTA (dueño + contadora, 2026-10-05): opción B.** Si una configuración guardada apunta a una cuenta de título (o a
   una que no existe), el formulario **muestra una alerta** que lista esos campos y **no deja guardar ni cerrar** hasta que se
   cambien por una cuenta de movimiento. Palabras de la contadora: «mostrar una alerta … que no me deje cerrar porque estoy
   llamando a esa cuenta; el contador sabe que los títulos y subtítulos no se deben llamar». El dueño añadió que no hay
   asientos afectados. Aplica a todos los formularios (obligatorios y opcionales); el combobox sigue mostrando el campo vacío
   con `aria-invalid` (D1) y es el **formulario** quien bloquea el envío con la alerta. *Dato verificado en producción el
   2026-10-05 (solo lectura, 15 tablas con campos `*AccountId`): hoy hay 0 referencias a un título.*
3. **Activos fijos a crédito (respuesta de la contadora):** la contrapartida de la adquisición debe poder ser también una
   cuenta de **Pasivo** (Cuentas por pagar: «se compra a crédito un enfriador, una computadora»). Hoy
   `fixed-assets/page.tsx:33` filtra `ASSET, EXPENSE, CONTRA_ASSET, REVENUE, EQUITY`. → en **B2**, al entregar las cuentas a
   `FixedAssetForm`, incluir `LIABILITY` en ese filtro (el `findBestMatch` de las otras tres cuentas no cambia).

### Estado de ejecución — Entrega B1 (2026-10-05)
- **Paso 1 HECHO (test-agent, RED):** 323 tests nuevos = **273 en rojo** (por aserción real: «se esperaban N `<input role="combobox">`…
  ¿sigue siendo un `<select>` nativo?») + 50 guardas verdes que ya pasan a propósito (matan mutantes). Verificado por la sesión
  principal: 6 shards = 6478 tests, **273 fallan y 6205 pasan** (los 6155 anteriores intactos), tsc 0, producción sin tocar.
  Referencia GREEN descartable (fuera del repo) y 76 mutantes: todos muertos.
- Archivos de test: ampliados `src/lib/account-search.test.ts`, `AccountCombobox.test.tsx`, `AccountCombobox.a11y.test.tsx`,
  `retention-extra.actions.test.ts`; nuevos `src/__tests__/architecture/account-selector-no-native-select.test.ts` (ratchet con
  allowlist cerrada de los 9 pendientes B2/B3 + intencionales), helpers `account-combobox-forms.ts`, `account-page-data.ts`,
  `react-tree.ts`, tests de `RetentionList`, `BankAccountList`, `BudgetDetail`, `InflationAdjustmentPanel`, `CajaCajaDepositForm`,
  `CajaCajaMovementForm`, `CajaCajaList` (CloseCajaDialog), `CajaCajaPageClient` (CreateCajaForm) y las 4 páginas.
- **Decisiones de la sesión principal sobre las ambigüedades del test-agent** (el ui-agent las sigue en el paso 2):
  1. Error de «sin cuenta»: se **conserva el gating actual** de cada botón (Retención, Presupuesto «Guardar», Inflación «Vista
     previa» y CloseCaja «Cerrar caja» siguen deshabilitados sin cuenta; Banco, Crear caja, Depósito y Movimiento validan al
     enviar con `toast.error` o texto en pantalla que mencione «cuenta»). No se rediseña el flujo.
  2. Nombres accesibles: se conservan los `id` existentes (`ba-account`, `caja-account`, `movement-expense-account`,
     `return-account-<id>`); donde hoy falta etiqueta se asocia con `id` + `htmlFor`; `BudgetDetail` usa `aria-label`.
  3. **Default de REPOMO:** sigue autoseleccionando la primera cuenta de **movimiento** (como hoy); con solo títulos es `""`
     y se envía `undefined`.
  4. REPOMO con solo títulos: aviso «No hay cuentas de Ingreso/Gasto…» y sin selector utilizable.
  5. Con consulta vacía se muestran todos los títulos aunque sus cuentas ya estén en el presupuesto (RN-6): se acepta.
  6. El `type` es opcional en el `select`/claves de bancos, presupuestos e inflación, y obligatorio en caja chica y en
     `getAccountsForEnteramientoAction`; siempre `id`, `code`, `name`, `isPostable` y nada más.
- **Pasos 2-5 HECHOS (2026-10-05/06):** paso 2 ui-agent GREEN (combobox con D1/D2/D3 + `loading`, 5 fuentes de datos y 9
  componentes; acción de enteramiento con `deletedAt: null` e `isPostable`); paso 3 cobertura: los selectores y lo que cambió
  están cubiertos (los archivos grandes como `CajaCajaList`/`BudgetList` conservan su cobertura previa); paso 4 security-agent
  **GO** (0 CRITICAL/HIGH); paso 5 cierre.
- **Entrega B1 HECHA y MERGEADA (PR #66, `f0ae1eba`, 2026-10-06):** rama `feat/spec-012b-selector-cuenta-resto-formularios`. **393 tests nuevos**
  (323 del paso 1 + 5 de `loading` + 65 de L-2/M-1), 6768 en total con `main` integrado, 0 fallos; tsc 0 · eslint 0 errores ·
  prettier OK. Añadidos tras la auditoría: estado `loading` del combobox («Cargando cuentas…», para `RetentionList`),
  **L-2** (RetentionList, BudgetDetail, CloseCajaDialog e InflationAdjustmentPanel revalidan la cuenta con
  `isSelectableAccountId` al enviar) y **M-1** (`bank-reconciliation/page.tsx` usa `requireCompanyPage` antes de leer).
  Mutaciones verificadas en cada uno.
- **Backlog de B1 (no bloquea):** (1) **L-1** — cuatro destinos de configuración (`BankAccountService.create`,
  `BudgetService.upsertLine`, `createCajaCaja`, `createMovement`) no validan `isPostable`: `assertAccountsPostable` en
  `src/lib/account-guard.ts` + cableado (arch-agent + ledger-agent), sube a MEDIUM en B2/B3; (2) **barrido M-1**: unas 21 páginas
  de `/company/[companyId]/…` no llaman a un guard propio (`bank-reconciliation/[statementId]`, `fiscal-close`, `igtf`,
  `iva-declaration`, `periods`, `reports/*`, `retentions`, `transactions`, `import`…); hay que leerlas una a una y ampliar
  `company-page-scope.test.ts` a `prisma.account.*` y servicios; (3) `enterRetention` y `assertAccountsBelongToCompany` no
  filtran `deletedAt`; (4) D4 (altura de la lista en `CloseCajaDialog` en 375×667) sin verificar en navegador; (5) el ratchet
  solo detecta `<option>`/`SelectItem` con `x.code —`, no otras formas de mostrar la cuenta; (6) si `getAccountsForEnteramientoAction`
  falla, el combobox queda sin cuentas sin avisar el error (UX).


### Estado de ejecución — Entrega B2 (2026-10-06)
Rama `feat/spec-012b2-selector-cuenta-activos-ajustes-nomina` (desde `main` con B1 fusionada, `e804fad2`).
**Alcance (6 formularios + 3 páginas):** `FixedAssetForm`, `DisposeAssetModal` y panel INPC de `FixedAssetList` con
`fixed-assets/page.tsx`; `FiscalConfigForm` y `GLAccountsForm` con `settings/page.tsx` (pestaña Contabilidad);
`PayrollWizard` con `payroll/config/edit/page.tsx`. Siguen la regla de reparto por página y las decisiones D1-D9 y 1-6 de B1.

**Corrección al plan (R-4, comprobada con grep el 2026-10-06): `onlyPostable` NO se retira en B2.** El anexo (§3) daba por
hecho que quedaría sin consumidores, pero `income-distribution/page.tsx:23` lo sigue usando y `IncomeDistributionForm` está
fuera de SPEC-012 (spec propia). B2 solo deja de usarlo en `settings/page.tsx:88`; el parámetro y su test
(`account.actions.test.ts:661`) se conservan hasta que la spec de distribución de ingresos migre esa página.

**Contrato de la alerta de Q4 (cuenta guardada que es título o no existe):**
- Helper puro en `src/lib/account-search.ts`: `unselectableSavedAccounts(fields)` con
  `fields: ReadonlyArray<{ key: string; label: string; value: string | null | undefined; accounts: readonly AccountOption[] }>`;
  devuelve `{ key, label }[]` de los campos con valor no vacío cuyo `value` NO es elegible en SU lista (`isSelectableAccountId`),
  en el orden recibido. Valor vacío/`null`/`undefined` = sin problema. Cada campo se evalúa contra la lista que ese campo ofrece
  (p. ej. solo Patrimonio), no contra todo el plan.
- Componente `src/components/accounting/SavedAccountsAlert.tsx`: `props { problems: ReadonlyArray<{ key: string; label: string }> }`;
  sin problemas no renderiza nada; con problemas, `role="alert"` que explica que esas configuraciones apuntan a una cuenta de
  título o que ya no existe, lista los rótulos y pide cambiarlas por una cuenta de movimiento para poder guardar.
- Cada formulario calcula `problems` desde sus valores **actuales** (no solo los iniciales): el aviso se ve desde el primer
  render, **deshabilita** el botón de guardar (con `aria-describedby` hacia el aviso) y además el `submit` retorna sin llamar a
  la acción (defensa en profundidad, como L-2). Al reemplazar la cuenta, o quitarla en un campo opcional con `clearable`,
  el aviso desaparece y se puede guardar. El combobox sigue mostrando el campo vacío con `aria-invalid` (D1).
- **Server-side no entra en B2:** validar `isPostable` al guardar la configuración es L-1 (`assertAccountsPostable`), PR aparte
  tras B3 con arch-agent + ledger-agent.

**Activos fijos (respuesta de la contadora):** `fixed-assets/page.tsx` añade `LIABILITY` al filtro de tipos para que la cuenta
de contrapartida de la adquisición pueda ser una CxP; las otras tres cuentas (`findBestMatch`) siguen sin cambio y ningún título
puede ser elegido ni autoseleccionado (RN-19).

**Ratchet:** salen de `PENDING_MIGRATION` los seis archivos de B2 (`FixedAssetForm`, `DisposeAssetModal`, `FixedAssetList`,
`FiscalConfigForm`, `GLAccountsForm`, `PayrollWizard`); quedan `InventoryItemForm`, `MovementForm` (B3) e `IncomeDistributionForm`.


**B2 paso 1 HECHO (test-agent, RED; commits `52740d14`, `a8bb4cf7`, `1ae3bd67`, `e46bfcd8`):** 314 tests nuevos y 1 existente
ajustado en 13 archivos; **253 en rojo** (251 nuevos + el primer test del ratchet y el `render` de `FixedAssetForm.component`),
63 guardas verdes a propósito; tsc 0; solo tests y helpers tocados. Los 476 tests de esos 13 archivos pasan contra una referencia
GREEN descartable (fuera del repo). **Los mutantes NO se probaron todavía** (0 de ~100 planeados): se ejecutarán en el paso 4
contra la implementación REAL, no contra la referencia. Hechos del código comprobados por la sesión principal con grep: (a)
`FixedAssetForm` no recibe valores iniciales; (b) `payroll/page.tsx` monta `PayrollWizard` con `initial={null}` y SIN `accounts`
(solo la página de edición pasa `accounts`); (c) `GLAccountsForm` solo muestra `ivaRetentionReceivableAccountId` si
`isSpecialContributor`; (d) `DisposeAssetModal` es un `div` propio sin teclado ni Radix.

**Decisiones de la sesión principal sobre las ambigüedades del test-agent (el ui-agent las sigue en el paso 2):**
1. `FixedAssetForm`: sin valores iniciales ⇒ sin alerta Q4. Obligatorias sin cuenta elegible (pool vacío o solo títulos) ⇒ se
   bloquea con un aviso que menciona «cuenta». La contrapartida opcional que ya no sea elegible se envía como `null`. Las cuentas
   se validan **antes** que la advertencia FC-03.
2. `PayrollWizard`: la alerta Q4 solo en el paso 3 (el de cuentas). Rótulos = etiqueta visible del campo; NO reutilizar
   `GL_ACCOUNT_FIELDS` (otros textos). Si `accounts` viene vacío o solo con títulos la sección no se muestra y por tanto no hay
   alerta ni bloqueo (lo cubrirá L-1 en el servidor).
3. `DisposeAssetModal`: no necesita D3 (modal propio sin teclado). **Backlog (hipótesis por lectura, sin ejecutar, fuera de B2):**
   el payload envía `proceedsAccountId: proceedsAccId || null` aunque el motivo ya no sea `SALE`; el servicio
   (`FixedAssetDepreciationService.ts:536`) contabiliza el cobro si `proceeds > 0` y hay cuenta — falta comprobar si el monto
   también se anula al cambiar de motivo.
4. `GLAccountsForm`: `ivaRetentionReceivableAccountId` se excluye de la alerta cuando el campo está oculto (no es contribuyente
   especial) y, si su valor guardado no es elegible, se guarda como `null` (los valores válidos no se tocan). Las insignias
   «Activo/Incompleto» y `saleConfigComplete`/`purchaseConfigComplete` se calculan con `isSelectableAccountId` (no con `!== NONE`);
   lo que dependa de ese estado (p. ej. «Causar ahora») queda deshabilitado por consecuencia. El paso 4 añade los tests de 4.
5. `SavedAccountsAlert` recibe un `id?: string` opcional; cada formulario lo pasa y enlaza el botón con `aria-describedby`.
6. `settings/page`: los avisos «No hay cuentas de Patrimonio / en el plan» cuentan solo cuentas de movimiento; con solo títulos
   no se muestra el formulario.
7. Supuesto **NO comprobado con datos reales** (anexo §8): que los títulos hereden el `type` de sus hijas. Si no lo hacen, un
   filtro por tipo puede perder encabezados ancestros (solo efecto visual, no de seguridad). Revisar al final con datos.


**B2 pasos 2-6 HECHOS (2026-10-07). B2 HECHA y MERGEADA (PR #67, merge `faca04a6`).** El merge lo dio el dueño sin querer, pero
el commit fusionado (`30f720d6`) ya tenía el CI en verde (suite completa e Integration) y la auditoría de seguridad en GO.
- **Paso 2 (ui-agent, GREEN):** 12 archivos de producción (helper `unselectableSavedAccounts`, `SavedAccountsAlert`, los 6
  formularios, `FixedAssetFormPanel` y las 3 páginas); los 253 tests en rojo pasan a verde y no se editó ningún test.
- **Paso 5 (security-agent): GO** (0 CRITICAL, 0 HIGH). Corregidos en B2: **B2-S2** (el campo oculto «IVA Retenido por Cobrar»
  se anulaba por tipo y borraba en silencio una cuenta de movimiento válida de otro tipo; el test que lo fijaba como correcto se
  rehízo primero, ver LL-023) y **B2-S9** (el texto de la alerta no mencionaba el tipo).
- **Pasos 3-4 (test-agent):** **162 mutantes contra el código REAL**: 137 muertos por los tests existentes, 25 sobrevivientes
  iniciales muertos con 42 tests nuevos, 4 equivalentes justificados (`toNull` con `visibleKeys.includes`, `if (blocked)` del
  asistente, `if (!inpcAccountValid)` del panel INPC y el `aria-hidden` del icono); 0 bugs de producción. Cobertura de las
  líneas nuevas de B2: 99,1 % de sentencias y 98,6 % de ramas (helper y alerta 100 %). Esos tests viajan en el PR de seguimiento
  `test/spec-012-b2-mutantes-y-cierre`. Suite completa medida: **7188 tests, 0 fallos**.
- **Backlog de B2 (de la auditoría; detalle en ADR-059 «Pendiente»):** B2-S1 MEDIUM = L-1 sube de prioridad (el servidor no valida
  `isPostable` en la configuración; peor caso: un activo fijo dado de alta con un título no se puede corregir desde la app) ·
  B2-S6 MEDIUM preexistente = las acciones de activos fijos no capturan IP/UA (R-6) · B2-S3, B2-S4, B2-S5 LOW · B2-S7, B2-S10 INFO.


### Entrega B — resto de formularios (ver la división B1/B2/B3 arriba)
| Paso | Agente | Subtarea | TDD |
|---|---|---|---|
| 1 | ui-agent | Inventario de los ~17 formularios y páginas (§8): cuáles usan `Select` de Radix y cuáles `<select>` nativo, y qué lógica propia usa la lista de cuentas (autoselección, validaciones) para aplicar RN-19. | — |
| 2 | test-agent | Tests en RED: CA-19 (consultas sin `isPostable: true`, con `companyId`/`deletedAt`/tipo), CA-20 (`FixedAssetForm.findBestMatch` ignora un título que coincidiría mejor), CA-limpieza (test de arquitectura: ningún `SelectItem` de cuentas) y ajuste de los tests existentes de cada formulario. | RED |
| 3 | ui-agent | Migrar los formularios y las páginas que les entregan las cuentas (quitar `isPostable: true` de las consultas, retirar `onlyPostable` de `getAccountsAction` si no queda consumidor). | GREEN |
| 4 | test-agent | Cobertura y revisión de regresiones. | — |
| 5 | security-agent | Revisión ligera de las consultas modificadas (`companyId`, `deletedAt`, tipo). | — |
| 6 | (sesión principal) | Gates, cierre de §12, spec `HECHA`, ADR-059, Estado Activo. **Sin merge.** | — |

## 11. Riesgos y preguntas abiertas
**Resueltas (dueño, 2026-10-05):** Q1 — los títulos **se muestran** como encabezados, **sin poder elegirlos** (RN-8..RN-11);
Q2 — Tab elige cuando queda un solo resultado (RN-14); Q3 — dos entregas, A (componente + asientos) y B (todos los demás
formularios en un solo PR; el orden entre ellos no importa). Además confirmó que **todas las cuentas deben llevar título
y subtítulo** (garantizado por SPEC-008).

- **Para la Entrega B (de la auditoría de A):**
  - LOW-3: un `value` inicial que apunte a un título (puede ocurrir tras ADR-059 en formularios con valores guardados:
    nómina, fiscal, bancos, activos fijos) hoy se muestra como elegido; y uno que no esté en `accounts` se ve vacío pero
    el formulario lo conserva (no salta «Selecciona una cuenta»). Decidir en B: tratarlo como «sin selección» (texto
    vacío + `aria-invalid`) y comprobar en cada formulario si el destino valida `isPostable` (el gate solo cubre `Transaction`).
  - Esc dentro de un `Dialog` de Radix (p. ej. `DisposeAssetModal`): el Esc del combobox puede cerrar también el diálogo.
  - La lista siempre abre hacia abajo (sin detección de colisión): revisar en modales con poco espacio.
  - El combobox no permite «sin cuenta» (vaciar el texto restaura la anterior, RN-15): un selector opcional necesitaría
    una opción explícita.
  - No hay `ref`/`onBlur` hacia react-hook-form (no se enfoca el campo al fallar la validación; el `Select` anterior
    tampoco lo hacía).
- Riesgo: mostrar títulos obliga a **cambiar las consultas** de ~10 páginas y a que cada formulario ignore los títulos en
  su lógica (RN-19). Un formulario que, por descuido, ofreciera un título como valor lo vería rechazado por el gate de
  asientos (ADR-053), pero sería mala experiencia. Mitigación: `selectable` solo viene de `isPostable`, CA-9/CA-20 y la
  revisión formulario por formulario del ui-agent.
- Riesgo: sustituir un control conocido en ~17 formularios. Mitigación: contrato idéntico (RN-17), dos entregas, test de
  arquitectura y tests existentes ajustados.
- Riesgo: algunos formularios usan `<select>` nativo y no `Select` de Radix; el ui-agent inventaría cada sitio antes de la
  Entrega B.
- Riesgo: la grilla de asientos tiene varias filas con este control y ahora una lista con ~240 filas entre títulos y
  cuentas. Mitigación: lista montada solo al abrir; el filtrado es puro y en memoria; si algún plan superara ~1000
  cuentas, virtualizar (fuera de alcance hoy: el plan real tiene 242).
- Semántica mixta (`1105 caja`): cada palabra debe cumplirse (Y); cubierta por RN-2/RN-3/RN-4.
- Idea relacionada (no incluida): un botón "Crear el título {código}" cuando falta el padre al crear una cuenta; tarea
  aparte si el dueño la pide.

## 12. Cierre
Lo completa `/implementar`.
- Commits:
- Tests: antes N → después N
- ADR creado o actualizado: ADR-059 (los selectores vuelven a recibir los títulos, como encabezados no elegibles)
- Lección aprendida (LL-XXX):
