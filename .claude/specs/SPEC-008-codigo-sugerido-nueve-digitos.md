---
id: SPEC-008
titulo: El código sugerido al crear una cuenta es de 9 dígitos (cuenta de movimiento), no de 4
estado: BORRADOR   # 2 preguntas abiertas en §11 (una de producto, una para la contadora)
fecha: 2026-10-05
rama: feat/spec-008-codigo-sugerido-nueve-digitos
arbol: "[3]+[10]"  # Server Action de lectura modificada + formulario de cuentas
zonas: []
adrs: [ADR-059]
---

# El código sugerido al crear una cuenta es de 9 dígitos

## 1. Problema
Desde ADR-059 solo las cuentas de 9 dígitos reciben movimiento. Pero el formulario "Nueva cuenta" sigue
proponiendo códigos de 4 dígitos (`1000`, `2105`…): `getNextAccountCodeAction` usa rangos numéricos planos
(1000-1999…) y **ignora todo código con puntos** (`Number("1.1.01.01.001")` es `NaN`). Con un plan jerárquico
de 9 dígitos devuelve siempre el inicio del rango (`1000`), y quien acepta la sugerencia crea, sin saberlo, un
**título** que no puede usar en ningún asiento (solo ve el aviso después de guardar).

## 2. Base legal / contable
Ninguna — decisión de producto. El criterio contable (cuenta de movimiento = 9 dígitos; menos = título) lo fijó
la contadora el 2026-10-04 y ya está en ADR-059. La **estructura de los niveles** (1/1/2/2/3 dígitos) sale de un
solo plan real, ver PREGUNTA PARA CONTADOR en §11.

## 3. Alcance
**Incluye:**
- Nueva utilidad pura que propone el siguiente código de 9 dígitos (con padre y sin padre).
- `getNextAccountCodeAction` pasa a aceptar `parentId` opcional y a devolver siempre un código de 9 dígitos.
- Formulario "Nueva cuenta" (`AccountsTable`): selector de cuenta padre (título de 6 dígitos) y código sugerido
  que se recalcula al cambiar tipo o padre.
- Eliminar la utilidad vieja (`nextAccountCode`/`deducirPaso`) y sus tests, que ya no tienen consumidores válidos.

**No incluye (explícito):**
- Crear títulos automáticamente ni sugerir códigos de **título** (se siguen tecleando a mano, con su aviso).
- Cambiar el esquema de datos: no hay campo `parentId` en `Account`; la jerarquía es solo el prefijo del código.
- Renumerar cuentas existentes.
- Formularios de importación (ya derivan título/movimiento por código, ADR-059).

## 4. Reglas de negocio
- RN-1: Todo código sugerido tiene la forma `A.B.CC.DD.EEE` (1+1+2+2+3 dígitos) y `isPostableCode(código) === true`.
- RN-2: Con padre, el sugerido es `${padre.code}.${EEE}` donde `EEE` es el **primer valor libre de 001 a 999**
  entre los hijos directos (códigos `padre.code + "." + 3 dígitos`).
- RN-3: "Libre" se decide contra **todas** las filas de la empresa, **incluidas las eliminadas** (`deletedAt != null`):
  el `@@unique([companyId, code])` las cuenta. Sugerir el código de una cuenta eliminada haría fallar el alta.
- RN-4: Si el padre ya tiene los 999 hijos, error de negocio (no se inventa otro padre).
- RN-5: El padre debe ser una cuenta de la **misma empresa**, no eliminada, `isPostable = false` y de **exactamente
  6 dígitos**; si no, error de negocio. El `companyId` sale del contexto verificado, nunca del input.
- RN-6: Compatibilidad de tipo padre↔hijo: el hijo es del mismo tipo que el padre, salvo `CONTRA_ASSET`, que cuelga
  de un padre `ASSET`. Un padre de otro tipo se rechaza.
- RN-7: Sin padre, el sugerido es `D.1.01.01.EEE` con `D` = 1 Activo/Contra-activo, 2 Pasivo, 3 Patrimonio,
  4 Ingreso, 5 Gasto, y `EEE` el primer libre (RN-3). Con `EEE` agotado → error de negocio.
- RN-8: La sugerencia es solo una propuesta editable; `createAccountAction` sigue validando unicidad y formato.
- RN-9: La action es de **lectura**: `limiters.read`, `MEMBER_ANY`, sin AuditLog (no muta nada).
- RN-10: Las únicas cuentas ofrecidas como padre en la UI son las de RN-5/RN-6, ordenadas por código y mostradas
  como `código — nombre`.

## 5. Asientos contables
No genera ni modifica asientos.

## 6. Modelo de datos
Sin cambios de schema. Sin migración.

## 7. Contrato de servicio y actions
```ts
// src/lib/account-code.ts (se amplía)
export const TITLE_PARENT_DIGITS = 6;
export function isTitleParentCode(code: string): boolean; // exactamente 6 dígitos

// src/modules/accounting/utils/next-account-code.ts (se reescribe; reemplaza nextAccountCode/deducirPaso)
export function nextChildCode(args: { parentCode: string; existingCodes: readonly string[] }): string | null;
export function nextRootCode(args: { type: AccountType; existingCodes: readonly string[] }): string | null;

// actions — account.actions.ts
const NextCodeInput = z.object({
  type: z.enum(["ASSET", "CONTRA_ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
  companyId: z.string().min(1),
  parentId: z.string().min(1).optional(),
});
export async function getNextAccountCodeAction(
  type: AccountType,
  companyId: string,
  parentId?: string
): Promise<ActionResult<{ code: string }>>;
```
- Roles: `MEMBER_ANY` · Limiter: `limiters.read` (como hoy) · AuditLog: no (lectura) · Período CLOSED: no aplica.
- Las `existingCodes` salen de `prisma.account.findMany({ where: { companyId }, select: { code: true } })` **sin**
  filtrar `deletedAt` (RN-3). El padre se busca con `findFirst({ where: { id: parentId, companyId, deletedAt: null } })`.
- El selector de padres se calcula en cliente con las cuentas que `AccountsTable` ya recibe (`isPostable` ya viaja en
  `getAccountsAction`); **no** se crea una action nueva (YAGNI).

## 8. UI
- Ruta/componente: `AccountsTable` → diálogo "Nueva cuenta".
- Campo nuevo **"Cuenta padre (título)"** entre "Tipo de Cuenta" y "Código", `Select` con la opción
  "Sin cuenta padre" y los títulos de RN-10. Al cambiar tipo o padre se vuelve a pedir la sugerencia.
- Estados: **cargando** (el input de código con `aria-busy` y `disabled` mientras llega la sugerencia),
  **vacío** (sin títulos del tipo: el selector queda solo con "Sin cuenta padre" y una ayuda), **error**
  (toast con el mensaje de negocio; el código se deja como estaba), **éxito** (código rellenado, editable).
- Accesibilidad: `FormLabel` asociado al `Select`; la ayuda bajo el código con `aria-live="polite"` para anunciar
  el cambio; foco no se mueve al recalcular; contraste AA.
- Copy exacto:
  - Etiqueta: "Cuenta padre (título)". Opción nula: "Sin cuenta padre".
  - Ayuda con padre: "Código sugerido dentro de {código} — {nombre}. Puedes editarlo."
  - Ayuda sin padre: "Sin cuenta padre: la cuenta no quedará agrupada bajo ningún título. Puedes editarlo."
  - Sin títulos: "Aún no hay títulos de 6 dígitos para este tipo. Crea primero el título o continúa sin padre."
  - Error RN-4: "La cuenta {código} ya tiene 999 cuentas; elige otro título."
  - Error RN-5/RN-6: "La cuenta padre no es válida para este tipo de cuenta."

## 9. Criterios de aceptación
- [ ] CA-1: Dado el plan real (`1.1.01.01.001`, `1.1.01.01.002`), cuando se pide el siguiente con padre `1.1.01.01`,
      entonces devuelve `1.1.01.01.003`.
- [ ] CA-2: Dado un hueco (`…001`, `…003`), devuelve `…002` (primer libre, RN-2).
- [ ] CA-3: Dado que `1.1.01.01.003` existe **eliminada**, no se sugiere ese código (RN-3).
- [ ] CA-4: Dado un padre con los 999 hijos, devuelve el error de RN-4 y no un código.
- [ ] CA-5: Padre de otra empresa, eliminado, con 9 dígitos, con 4 dígitos o con `isPostable = true` → error RN-5
      (un test por caso).
- [ ] CA-6: Tipo `CONTRA_ASSET` con padre `ASSET` es válido; `LIABILITY` con padre `ASSET` se rechaza (RN-6).
- [ ] CA-7: Sin padre, tipo `LIABILITY` en una empresa vacía → `2.1.01.01.001`; con `…001` ocupado → `…002` (RN-7).
- [ ] CA-8: Todo código devuelto cumple `isPostableCode` y la forma `A.B.CC.DD.EEE` (propiedad, RN-1).
- [ ] CA-9: Empresa con códigos de 4 dígitos heredados: la sugerencia sigue siendo de 9 dígitos y no choca con ellos.
- [ ] CA-tenant: un usuario de otra empresa no obtiene sugerencias ni ve códigos ocupados de la empresa ajena.
- [ ] CA-UI: al elegir padre se rellena el código; con `isPending` el input queda `aria-busy`; con error el valor
      anterior se conserva.
- [ ] CA-limpieza: no queda ninguna referencia a `nextAccountCode`/`deducirPaso` ni a `RANGES` para sugerir códigos.

## 10. Plan de agentes
Lo completa `/implementar`.

| Paso | Agente | Subtarea | TDD |
|---|---|---|---|

## 11. Riesgos y preguntas abiertas
- **PREGUNTA PARA CONTADOR:** ¿la estructura de niveles **1 / 1 / 2 / 2 / 3** dígitos (`A.B.CC.DD.EEE`) es la misma en
  todos los planes de cuentas venezolanos o cada empresa define la suya? Hoy se sostiene en **un solo plan real**
  (242 cuentas, 100 % con esa forma y con título padre de 6 dígitos). Si varía, el padre no puede suponerse de
  6 dígitos y RN-1/RN-5/RN-7 hay que generalizarlos (padre = cualquier título; hijo = padre + segmento).
- **PREGUNTA DE PRODUCTO (dueño):** ¿se permite crear una cuenta de movimiento **sin** título padre (RN-7)? Propuesta
  de esta spec: sí, con el aviso de la ayuda, porque una empresa nueva que arma su plan a mano tendría que crear
  antes cuatro títulos (`1`, `1.1`, `1.1.01`, `1.1.01.01`) solo para poder usar su primera cuenta. La alternativa es
  exigir padre y bloquear el alta si no existe.
- Riesgo: sin `parentId` en el schema, la jerarquía es solo prefijo de texto; renombrar un título no mueve a sus
  hijos. Fuera de alcance, ya era así.
- Riesgo: concurrencia — dos usuarios pidiendo la sugerencia a la vez reciben el mismo código; el segundo alta falla
  con "código ya en uso" (mensaje de negocio ya existente). Aceptado: es una sugerencia, no una reserva.

## 12. Cierre
Lo completa `/implementar`.
- Commits:
- Tests: antes N → después N
- ADR creado o actualizado: ADR-059 (nota de que la sugerencia ya es de 9 dígitos)
- Lección aprendida (LL-XXX):
