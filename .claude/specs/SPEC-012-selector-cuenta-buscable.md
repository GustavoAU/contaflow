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
1. **La Entrega B se divide** (antes: un solo PR) porque el inventario muestra ~25 archivos y riesgo alto en nómina y activos fijos:
   - **B1** (esta rama): paso 0 = extender `AccountCombobox` (valor huérfano o título → texto vacío + `aria-invalid`; prop
     `clearable`; `data-state` y ayuda para `Esc` dentro de AlertDialog) + formularios simples: `RetentionList`,
     `BankAccountList`, `BudgetDetail`, `CajaCajaPageClient`, `CajaCajaDepositForm`, `CajaCajaMovementForm`, panel INPC de
     `FixedAssetList`, `FiscalConfigForm`, `InflationAdjustmentPanel`, con sus páginas.
   - **B2**: `CloseCajaDialog` (`CajaCajaList`), `DisposeAssetModal`, `InventoryItemForm`, `GLAccountsForm`, `FixedAssetForm`,
     `PayrollWizard` (los opcionales y los complejos) + retiro de `onlyPostable` de `getAccountsAction`.
   - **B3 (al final)**: `MovementForm` (inventario) y `inventory/page.tsx`, **después** de que SPEC-007 se fusione (esa rama
     reescribe el mismo selector y la misma consulta; migrarlo antes garantiza conflicto).
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
