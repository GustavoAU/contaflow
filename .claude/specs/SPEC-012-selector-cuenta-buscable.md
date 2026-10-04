---
id: SPEC-012
titulo: El selector de cuenta busca por código o por nombre (en vez de recorrer una lista)
estado: BORRADOR   # 3 preguntas abiertas en §11; falta aprobar
fecha: 2026-10-05
rama: feat/spec-012-selector-cuenta-buscable
arbol: "[10]"      # UI / componente React / formulario
zonas: []
adrs: [ADR-059]
---

# El selector de cuenta busca por código o por nombre

## 1. Problema
Feedback de la contadora (2026-10-05), sobre cómo elige hoy una cuenta en un asiento:

> "Sería bueno que en vez de seleccionar la cuenta —porque da así como una lista y tú bajas y las consigues—
> […] si marcas el 1 te muestra las cuentas del 1, si marcas el 2 te muestra las del 2 […] pero si se puede poner el
> número a mano, chévere, porque el contador se las sabe de memoria. O si puedes filtrar o poner el nombre, que también
> te dé la cuenta."

Hoy el campo es un `Select` de lista (Radix). Su único atajo es el *typeahead* por la primera letra del texto
`código — nombre`: saltar al primer `1…`, no escribir `1.1.01.01.001` ni buscar "caja". Un plan real tiene ~160
cuentas de movimiento, así que encontrar una cuenta es recorrer una lista larga. Se repite en ~16 formularios.

## 2. Base legal / contable
Ninguna — decisión de usabilidad pedida por la contadora.

## 3. Alcance
**Incluye:**
- Función pura de búsqueda de cuentas (`filterAccounts`) y componente reutilizable `AccountCombobox`.
- Sustituir el `Select` de cuenta por el combobox, **en dos tandas**: A = asientos manuales (`JournalEntryForm`);
  B = el resto de formularios con selector de cuenta (inventario en §8).
- Tests unitarios, de componente (jsdom) y de accesibilidad; un test de arquitectura que impida volver a un `Select`
  de cuentas.

**No incluye (explícito):**
- Cambiar **qué** cuentas se ofrecen: cada formulario sigue recibiendo su lista ya filtrada (movimiento, tipo).
- Mostrar los títulos como encabezados no seleccionables (pregunta Q1 de §11).
- Búsqueda en el servidor, crear cuentas desde el selector, favoritas o recientes.
- Selectores que no son de cuentas contables (bancos `BankAccount`, productos, clientes) — `ProductCombobox` no se toca.
- Cambios de modelo, de actions o de reglas de negocio.

## 4. Reglas de negocio
**Búsqueda**
- RN-1: La búsqueda no distingue mayúsculas ni tildes y recorta espacios (`"Cajá "` = `"caja"`).
- RN-2: Una palabra **numérica** (solo dígitos y puntos) se compara contra el **código sin separadores** por **prefijo**:
  `1`, `1101`, `1.1.01` y `110101001` encuentran `1.1.01.01.001`; `1.1.01.01.001` y `110101001` son equivalentes.
- RN-3: Una palabra **con letras** se busca como "contiene" dentro del **nombre**. Varias palabras se combinan con **Y**
  y en cualquier orden (`principal caja` encuentra `Caja Principal`).
- RN-4: Una palabra numérica también puede coincidir con el nombre (cuentas como "Retención 75%"): se acepta si cumple
  RN-2 **o** aparece en el nombre.
- RN-5: Orden de los resultados: primero la coincidencia **exacta** de código, luego por código ascendente (orden
  numérico por segmentos, como el plan de cuentas).
- RN-6: Con la consulta vacía se muestran todas las cuentas, ordenadas por código.
- RN-7: Se muestran como máximo 100 resultados; si hay más, un aviso "Mostrando las primeras 100. Escribe más para afinar."

**Selección y teclado**
- RN-8: Cada opción se muestra como `código — nombre`.
- RN-9: Flechas ↑/↓ mueven la opción activa; **Enter** elige la activa; **Esc** cierra sin cambiar el valor.
- RN-10: Si la consulta deja **exactamente un** resultado, **Enter** o **Tab** lo eligen (el contador teclea el código
  de memoria y sigue con el siguiente campo). Con varios resultados, Tab no elige nada.
- RN-11: Al salir del campo sin elegir, el texto se restaura a la cuenta ya seleccionada (o queda vacío si no había):
  nunca queda texto libre que no corresponda a una cuenta.
- RN-12: Sin resultados: "No hay cuentas que coincidan con «{consulta}»".

**Integración**
- RN-13: Contrato idéntico al `Select` actual: recibe `value` (id de cuenta o `""`) y emite `onChange(accountId)`;
  funciona con `react-hook-form` (`FormControl` + `FormMessage`, error "Selecciona una cuenta").
- RN-14: El conjunto de cuentas es el que ya trae cada formulario; el componente no consulta nada ni filtra por tipo.
- RN-15: Cambios externos del valor (p. ej. la autoselección de `FixedAssetForm.findBestMatch` o un reset del
  formulario) se reflejan en el texto mostrado.
- RN-16: Soporta `disabled` y `aria-invalid`.

## 5. Asientos contables
No genera ni modifica asientos.

## 6. Modelo de datos
Sin cambios de schema. Sin migración. Sin dependencias nuevas (se usa `radix-ui`, ya instalada, o un listbox propio
como `ProductCombobox`).

## 7. Contrato de servicio y actions
No hay actions nuevas ni cambios en las existentes.

```ts
// src/lib/account-search.ts (puro, sin React)
export type AccountOption = { id: string; code: string; name: string };
export function normalizeSearch(text: string): string;
export function filterAccounts(accounts: readonly AccountOption[], query: string): AccountOption[]; // RN-1..RN-7

// src/components/accounting/AccountCombobox.tsx
export function AccountCombobox(props: {
  accounts: readonly AccountOption[];
  value: string;                       // accountId o ""
  onChange: (accountId: string) => void;
  id?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  disabled?: boolean;
  placeholder?: string;                // por defecto "Buscar por código o nombre…"
  className?: string;
}): JSX.Element;
```
- Roles/limiter/AuditLog/período CLOSED: no aplican (solo UI).

## 8. UI
- **Tanda A:** `src/components/accounting/JournalEntryForm.tsx` (columna "Cuenta" de cada fila del asiento).
- **Tanda B** (inventario a confirmar por el ui-agent: algunos pueden ser `<select>` nativo): `RetentionList`,
  `BankAccountList` (cuenta contable de la cuenta bancaria), `BudgetDetail`, `CajaCajaPageClient`, `CajaCajaList`,
  `CajaCajaDepositForm`, `CajaCajaMovementForm`, `FiscalConfigForm`, `DisposeAssetModal`, `FixedAssetForm`,
  `FixedAssetList`, `IncomeDistributionForm`, `InflationAdjustmentPanel`, `InventoryItemForm`, `MovementForm`
  (inventario), `PayrollWizard`, `GLAccountsForm`.
- Estados: **vacío** (sin cuentas ofrecidas: campo deshabilitado con "No hay cuentas disponibles"), **sin resultados**
  (RN-12), **cargando** no aplica (la lista ya está en memoria), **error** (borde y `aria-invalid` + `FormMessage`),
  **éxito** (texto `código — nombre`).
- Accesibilidad: patrón ARIA combobox — `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`,
  lista con `role="listbox"` y opciones `role="option"`; etiqueta asociada (`FormLabel`/`aria-label`); un
  `aria-live="polite"` anuncia "{n} cuentas" al filtrar; todo operable con teclado; contraste AA; el foco no se pierde
  al abrir/cerrar la lista. En la grilla de asientos (varias filas) cada fila monta su lista solo cuando está abierta.
- Copy exacto: placeholder "Buscar por código o nombre…"; sin resultados "No hay cuentas que coincidan con «{consulta}»";
  tope "Mostrando las primeras 100. Escribe más para afinar."; sin cuentas "No hay cuentas disponibles".

## 9. Criterios de aceptación
- [ ] CA-1: Dadas `1.1.01.01.001`, `1.1.02.01.001`, `2.1.01.01.001`, la consulta `1` devuelve las dos primeras en
      orden de código (lo que la contadora observó con el *typeahead*).
- [ ] CA-2: `110101001`, `1.1.01.01.001`, `1.1.01` y `1101` encuentran `1.1.01.01.001`; `1.1.02` no.
- [ ] CA-3: `caja` encuentra `Caja Principal` y `CAJAS`; `CAJÁ` y `caja ` también (tildes y mayúsculas).
- [ ] CA-4: `principal caja` encuentra `Caja Principal` (varias palabras, cualquier orden); `caja banco` no.
- [ ] CA-5: la coincidencia exacta de código va primero; el resto por código ascendente.
- [ ] CA-6: consulta vacía → todas, ordenadas; más de 100 → 100 y el aviso.
- [ ] CA-7: sin coincidencias → mensaje RN-12; la lista no ofrece opciones.
- [ ] CA-8: un solo resultado + Enter (y + Tab) selecciona y emite `onChange(accountId)`; con varios, Tab no emite nada.
- [ ] CA-9: ↓/↑ cambian la opción activa (`aria-activedescendant`) y Enter elige la activa; Esc cierra sin cambios.
- [ ] CA-10: salir del campo sin elegir restaura el texto de la cuenta seleccionada (o vacío).
- [ ] CA-11: con `value` conocido muestra `código — nombre`; un cambio externo de `value` actualiza el texto (RN-15).
- [ ] CA-12: `JournalEntryForm`: sin cuenta, el envío muestra "Selecciona una cuenta"; con cuenta elegida tecleando
      `110101001` + Enter, el payload lleva el `accountId` correcto.
- [ ] CA-13: sin violaciones de axe en el componente (cerrado y abierto) y roles ARIA del patrón combobox.
- [ ] CA-14: `disabled` e `aria-invalid` se reflejan en el input.
- [ ] CA-limpieza: test de arquitectura — ningún archivo de `src/` renderiza un `SelectItem` con `account.code`/`a.code`
      (Tanda B).
- [ ] CA-sin-regresión: los tests existentes de los formularios migrados siguen en verde (ajustados al nuevo control).

## 10. Plan de agentes
Lo completa `/implementar`.

| Paso | Agente | Subtarea | TDD |
|---|---|---|---|

## 11. Riesgos y preguntas abiertas
- **Q1 — PREGUNTA PARA CONTADORA:** el 2026-10-04 dijo que los títulos "deben aparecer como títulos y subtítulos, pero
  no como cuentas seleccionables". En los selectores de asientos hoy los títulos **no aparecen** (se filtran). ¿Los
  quiere ver como **encabezados de grupo no seleccionables** dentro de la lista (ayuda a orientarse), o basta con la
  búsqueda por código/nombre? **Recomendación:** versión 1 sin títulos (la búsqueda ya resuelve lo que pidió); mostrarlos
  como encabezados es una mejora posterior que exige pasar los títulos a cada uno de los ~17 formularios.
- **Q2 — decisión de producto:** RN-10 hace que **Tab** seleccione cuando la consulta deja un solo resultado (rapidez
  para quien teclea códigos de memoria). Riesgo: elegir sin querer. **Recomendación:** sí.
- **Q3 — decisión del dueño:** ¿una sola entrega o dos? **Recomendación:** dos PR (A: componente + asientos, para que la
  contadora lo pruebe primero; B: el resto), con la spec cerrada al terminar B. Y ¿qué formularios usa más, para ordenar
  la Tanda B?
- Riesgo: sustituir un control conocido en ~17 formularios. Mitigación: contrato idéntico (RN-13), tandas, test de
  arquitectura y tests existentes ajustados.
- Riesgo: algunos formularios usan `<select>` nativo y no `Select` de Radix; el ui-agent inventaría cada sitio antes de
  la Tanda B.
- Riesgo: la grilla de asientos tiene varias filas con este control. Mitigación: lista montada solo al abrir; el filtrado
  es puro y en memoria (cientos de cuentas).
- Semántica mixta (`1105 caja`): cada palabra debe cumplirse (Y); queda cubierta por RN-2/RN-3/RN-4.

## 12. Cierre
Lo completa `/implementar`.
- Commits:
- Tests: antes N → después N
- ADR creado o actualizado: ADR-059 (nota sobre el selector buscable)
- Lección aprendida (LL-XXX):
