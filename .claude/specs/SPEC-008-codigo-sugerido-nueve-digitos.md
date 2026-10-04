---
id: SPEC-008
titulo: Una cuenta de movimiento es de 9 dígitos y siempre cuelga de un título padre (sugerencia de código + validación)
estado: HECHA   # aprobada 2026-10-05; implementada en la rama, pendiente de merge (lo decide el dueño)
fecha: 2026-10-05
rama: feat/spec-008-codigo-sugerido-nueve-digitos
arbol: "[3]+[10]"  # Server Actions (lectura + alta/edición) + formulario de cuentas + importador
zonas: []
adrs: [ADR-059]
---

# Una cuenta de movimiento es de 9 dígitos y siempre cuelga de un título padre

## 1. Problema
Desde ADR-059 solo las cuentas de 9 dígitos reciben movimiento. Pero el formulario "Nueva cuenta" sigue
proponiendo códigos de 4 dígitos (`1000`, `2105`…): `getNextAccountCodeAction` usa rangos numéricos planos
(1000-1999…) y **ignora todo código con puntos** (`Number("1.1.01.01.001")` es `NaN`). Con un plan jerárquico
devuelve siempre el inicio del rango (`1000`), y quien acepta la sugerencia crea, sin saberlo, un **título** que no
puede usar en ningún asiento (solo lo ve en un aviso después de guardar).

Además, nada impide hoy crear una cuenta de movimiento suelta, sin el título que la agrupa: el dueño decidió
(2026-10-05) que **no se permite**.

## 2. Base legal / contable
Ninguna — decisión de producto. Decisiones del dueño del 2026-10-05 (en respuesta a las preguntas de la v1 de esta
spec): (a) la estructura de niveles **1 / 1 / 2 / 2 / 3** dígitos (`A.B.CC.DD.EEE`) es la misma en todos los planes;
(b) **no** se permite crear una cuenta de movimiento sin título padre.

## 3. Alcance
**Incluye:**
- Utilidad pura que propone el siguiente código de 9 dígitos dentro de un título padre.
- `getNextAccountCodeAction` pasa a exigir `parentId` y devuelve siempre un código de 9 dígitos.
- Regla de servidor: una cuenta de movimiento solo se crea (o se edita a movimiento) si existe su título padre.
  Aplica a `createAccountAction`, `updateAccountAction` e `ImportService.importAccounts`.
- Formulario "Nueva cuenta" (`AccountsTable`): selector de cuenta padre y código sugerido.
- Eliminar la utilidad vieja (`nextAccountCode`/`deducirPaso`) y sus tests.

**No incluye (explícito):**
- Crear títulos automáticamente ni sugerir códigos de **título** (se siguen tecleando a mano, con su aviso).
- Cambiar el schema: no hay `parentId` en `Account`; la jerarquía es solo el prefijo del código.
- Tocar cuentas ya existentes (la regla **no es retroactiva**; ver riesgo de las empresas demo en §11).
- Crear el esqueleto de títulos de las empresas demo (posible tarea aparte).

## 4. Reglas de negocio
**Forma y padre**
- RN-1: Una cuenta de movimiento tiene la forma exacta `A.B.CC.DD.EEE` (1+1+2+2+3 dígitos, separada por puntos).
  Su **padre** es el código sin el último segmento (`A.B.CC.DD`, 6 dígitos).
- RN-2: Un padre válido es una cuenta de la **misma empresa**, no eliminada, con `isPostable = false` y exactamente
  6 dígitos. El `companyId` sale del contexto verificado, nunca del input.
- RN-3: Compatibilidad de tipo padre↔hijo: el hijo es del mismo tipo que el padre, salvo `CONTRA_ASSET`, que cuelga
  de un padre `ASSET`.

**Sugerencia**
- RN-4: El sugerido es `${padre.code}.${EEE}` con `EEE` el **primer valor libre de 001 a 999** entre los hijos directos.
- RN-5: "Libre" se decide contra **todas** las filas de la empresa, **incluidas las eliminadas** (`deletedAt != null`):
  el `@@unique([companyId, code])` las cuenta. Sugerir el código de una cuenta eliminada haría fallar el alta.
- RN-6: Si el padre ya tiene los 999 hijos, error de negocio (no se inventa otro padre).
- RN-7: No existe sugerencia sin padre: `parentId` es obligatorio en `getNextAccountCodeAction`.
- RN-8: La sugerencia es solo una propuesta editable; lo que vale es la validación del servidor (RN-9..RN-11).

**Validación en el servidor (no se puede esquivar tecleando el código)**
- RN-9: `createAccountAction` con un código de movimiento (≥ 9 dígitos, ADR-059) exige RN-1 y que exista el padre
  (RN-2) con tipo compatible (RN-3); si no, rechaza con error de negocio y **no crea nada**. Un código de menos de
  9 dígitos sigue creándose como título, sin padre obligatorio.
- RN-10: `updateAccountAction`: si el código cambia y el nuevo es de movimiento, aplica el mismo chequeo que RN-9.
  Cambiar solo el nombre u otros campos con el mismo código **no** dispara el chequeo (el formulario reenvía siempre
  `code`; ver ADR-059/H-1).
- RN-11: `ImportService.importAccounts`: la misma regla por fila. El padre puede existir en la base **o** venir como
  título en el mismo archivo (independiente del orden de las filas). Una fila sin padre se reporta como error de
  fila (`reason: "missing_parent"`) y **no aborta** el resto del lote.
- RN-12: Lo ya existente no se toca: ninguna cuenta actual se cambia ni se bloquea por esta regla.

**Lectura**
- RN-13: `getNextAccountCodeAction` es de **lectura**: `limiters.read`, `MEMBER_ANY`, sin AuditLog.
- RN-14: En la UI solo se ofrecen como padre las cuentas de RN-2/RN-3, ordenadas por código y como `código — nombre`.

## 5. Asientos contables
No genera ni modifica asientos.

## 6. Modelo de datos
Sin cambios de schema. Sin migración.

## 7. Contrato de servicio y actions
```ts
// src/lib/account-code.ts (se amplía)
export const MOVEMENT_CODE_REGEX = /^\d\.\d\.\d{2}\.\d{2}\.\d{3}$/;
export function parentCodeOf(movementCode: string): string | null; // null si no cumple MOVEMENT_CODE_REGEX
export function isTitleParentCode(code: string): boolean;          // exactamente 6 dígitos

// src/modules/accounting/utils/next-account-code.ts (se reescribe; reemplaza nextAccountCode/deducirPaso)
export function nextChildCode(args: { parentCode: string; existingCodes: readonly string[] }): string | null;

// src/modules/accounting/services/ (nuevo, compartido por create/update/import)
export function assertValidParentTitle(args: {
  companyId: string; code: string; type: AccountType;
}): Promise<{ ok: true } | { ok: false; message: string }>;

// actions — account.actions.ts
const NextCodeInput = z.object({
  type: z.enum(["ASSET", "CONTRA_ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
  companyId: z.string().min(1),
  parentId: z.string().min(1),
});
export async function getNextAccountCodeAction(
  type: AccountType, companyId: string, parentId: string
): Promise<ActionResult<{ code: string }>>;

// import.schema.ts — ImportErrorReasonSchema: "duplicate_code" | "missing_parent" | "unknown"
```
- Roles: `MEMBER_ANY` (lectura) · Limiter: `limiters.read` · AuditLog de lectura: no.
- Alta/edición/import: roles y limiters **sin cambios** (`ROLES.ACCOUNTING`, `limiters.fiscal`); el AuditLog existente
  de `createAccountAction`/`updateAccountAction` no cambia.
- `existingCodes` = `prisma.account.findMany({ where: { companyId }, select: { code: true } })` **sin** filtrar
  `deletedAt` (RN-5). El padre se busca con `findFirst({ where: { id | code, companyId, deletedAt: null } })`.
- El selector de padres se calcula en cliente con las cuentas que `AccountsTable` ya recibe (`isPostable` ya viaja en
  `getAccountsAction`); no se crea una action nueva (YAGNI).
- Período CLOSED: no aplica (no hay asientos).

## 8. UI
- Ruta/componente: `AccountsTable` → diálogo "Nueva cuenta".
- Campo **"Cuenta padre (título)"** entre "Tipo de Cuenta" y "Código": `Select` con los títulos de RN-14 y la opción
  "Sin cuenta padre (crear un título)". Al elegir un padre se pide la sugerencia; al cambiar el tipo se limpia el padre.
- Sin padre elegido: el código queda vacío y editable, solo se aceptan códigos de **título** (< 9 dígitos); si
  teclea uno de movimiento, el servidor lo rechaza con el mensaje de RN-9.
- Estados: **cargando** (input de código `aria-busy` + `disabled` mientras llega la sugerencia), **vacío** (sin
  títulos del tipo: ayuda "Aún no hay títulos…"), **error** (toast con el mensaje de negocio; el código se deja
  como estaba), **éxito** (código rellenado, editable).
- Accesibilidad: `FormLabel` asociado al `Select`; ayuda bajo el código con `aria-live="polite"`; el foco no se
  mueve al recalcular; contraste AA; botón de guardar con `disabled={isPending}` y `aria-busy`.
- Copy exacto:
  - Etiqueta: "Cuenta padre (título)". Opción nula: "Sin cuenta padre (crear un título)".
  - Ayuda con padre: "Código sugerido dentro de {código} — {nombre}. Puedes editarlo."
  - Ayuda sin padre: "Sin cuenta padre solo puedes crear títulos (menos de 9 dígitos). Para una cuenta de movimiento elige un título padre."
  - Sin títulos: "Aún no hay títulos de 6 dígitos para este tipo. Crea primero el título."
  - Error RN-6: "El título {código} ya tiene 999 cuentas; elige otro título."
  - Error RN-9 (sin padre): "La cuenta {código} necesita un título padre ({padre}) que no existe. Créalo primero."
  - Error RN-9 (forma): "El código de una cuenta de movimiento debe tener el formato A.B.CC.DD.EEE (ej: 1.1.01.01.001)."
  - Error RN-3: "El título padre {código} es de otro tipo de cuenta."
  - Importador, fila: "Fila {código}: falta el título padre {padre}."

## 9. Criterios de aceptación
- [x] CA-1: Dado el plan real (`1.1.01.01.001`, `…002`), con padre `1.1.01.01` devuelve `1.1.01.01.003`.
- [x] CA-2: Dado un hueco (`…001`, `…003`), devuelve `…002`.
- [x] CA-3: Dado que `1.1.01.01.003` existe **eliminada**, no se sugiere ese código (RN-5).
- [x] CA-4: Padre con los 999 hijos → error RN-6, no un código.
- [x] CA-5: Padre de otra empresa, eliminado, con 9 dígitos, con 4 dígitos o con `isPostable = true` → error (un test
      por caso).
- [x] CA-6: `CONTRA_ASSET` con padre `ASSET` es válido; `LIABILITY` con padre `ASSET` se rechaza (RN-3).
- [x] CA-7: `getNextAccountCodeAction` sin `parentId` → error de validación (RN-7).
- [x] CA-8: Todo código sugerido cumple `MOVEMENT_CODE_REGEX` e `isPostableCode` (propiedad).
- [x] CA-9: `createAccountAction` con `1.1.01.01.050` y el padre `1.1.01.01` existente → crea; sin el padre → rechaza y
      **no llama a `account.create`**.
- [x] CA-10: `createAccountAction` con `110101001` (sin puntos) o `1.1.01.01.0010` (10 dígitos) → rechaza por forma.
- [x] CA-11: `createAccountAction` con un título (`1.1.01`) sigue creándose sin padre.
- [x] CA-12: `updateAccountAction` editando solo el nombre de una cuenta con el mismo código → no consulta el padre.
- [x] CA-13: `updateAccountAction` cambiando el código a uno de movimiento sin padre → rechaza.
- [x] CA-14: Importación con una fila de movimiento cuyo padre viene **después** en el archivo → importa; con padre
      inexistente → esa fila falla con `missing_parent` y las demás se importan.
- [x] CA-15: Una empresa con cuentas de movimiento ya existentes sin título padre (demo) no se ve afectada al editar
      su nombre ni al leer el plan (RN-12).
- [x] CA-tenant: un usuario de otra empresa no obtiene sugerencias ni valida padres de la empresa ajena (`companyId`
      sale del contexto).
- [x] CA-UI: al elegir padre se rellena el código; con `isPending` el input queda `aria-busy`; con error el valor
      anterior se conserva.
- [x] CA-limpieza: no queda ninguna referencia a `nextAccountCode`/`deducirPaso` ni a `RANGES` para sugerir códigos.

## 10. Plan de agentes
Sin cambios de schema → se omite el paso ARCH GATE. Línea base (2026-10-05): tsc 0 · **5638 tests** en verde
(1 timeout intermitente de `audit.actions.test.ts` por import dinámico en frío; pasa al repetir, ajeno a esta spec).

| Paso | Agente | Subtarea | TDD |
|---|---|---|---|
| 1 | test-agent | Tests en RED de CA-1..CA-14, CA-tenant y CA-limpieza: `account-code` (`parentCodeOf`, `isTitleParentCode`, `MOVEMENT_CODE_REGEX`), `nextChildCode` (huecos, eliminadas, 999, propiedad RN-1), validación de padre (RN-2/RN-3, un test por caso de CA-5/CA-6), `getNextAccountCodeAction` (CA-7), `createAccountAction`/`updateAccountAction` (CA-9..CA-13) e `importAccounts` (CA-14). Ajustar los tests existentes que crean cuentas de 9 dígitos sin padre. | RED |
| 2 | ledger-agent | `account-code.ts` + `nextChildCode` (reescribe `next-account-code.ts`, borra `nextAccountCode`/`deducirPaso` y `RANGES` para sugerir) + validación de padre compartida (función pura con lookup inyectable: BD en create/update, BD **o** títulos del mismo archivo en import) + `getNextAccountCodeAction(type, companyId, parentId)` con Zod + reglas RN-9/RN-10 en `createAccountAction`/`updateAccountAction` + RN-11 en `ImportService.importAccounts` (`missing_parent`, sin abortar el lote). | GREEN |
| 3 | test-agent | Auditoría de cobertura de lo nuevo (servicios 100 %, actions 90 %, schemas 100 %); cierra huecos MUST-FIX. | — |
| 4 | ui-agent | `AccountsTable`: selector "Cuenta padre (título)" (títulos de 6 dígitos del tipo, RN-14), sugerencia al elegir padre, estados cargando/vacío/error/éxito, `aria-busy`/`aria-live`, copy exacto de §8; mensaje `missing_parent` en el importador (`AccountsImporter`). Test jsdom de CA-UI. | GREEN |
| 5 | security-agent | Auditoría (trigger: Server Actions modificadas + input de usuario → DB): IDOR del padre (`companyId` del contexto), validación Zod de `parentId`, no filtración de códigos de otra empresa, regresión del H-1 (el chequeo solo si el código cambia), rate limit. CRITICAL/HIGH bloquean. | — |
| 6 | (sesión principal) | Gates: `tsc`, `vitest` (6 shards), `pnpm lint`, `format:check`; CA marcados `[x]`; sección 12; ADR-059 actualizado (sugerencia de 9 dígitos y padre obligatorio); línea en Estado Activo; LL si aparece un patrón nuevo. Commits por capa. **Sin merge.** | — |

**Estado de ejecución (2026-10-05, checkpoint al 92 % de tokens):**
- Paso 1 **HECHO** (test-agent, RED): 224 tests nuevos en rojo, cada uno por su razón (verificado por la sesión
  principal: 224 failed / 153 passed en los 7 archivos tocados; tsc 0; producción sin tocar). Archivos:
  `src/lib/account-code.test.ts`, `src/modules/accounting/__tests__/{next-account-code,parent-title}.test.ts`,
  `src/modules/accounting/actions/account.actions.test.ts`, `src/modules/import/{services/ImportService,schemas/import.schema}.test.ts`
  y el helper `src/__tests__/helpers/in-memory-account-db.ts` (tabla `Account` en memoria detrás de `prisma.account.*`
  para que un `where` sin `companyId`/`deletedAt` haga fallar el test). El agente validó los tests contra una
  implementación de referencia descartable (38/38 mutantes muertos).
- Pasos 2-6 **PENDIENTES**. Contrato exacto que usaron los tests (el ledger-agent debe implementarlo tal cual):
  `parentCodeOf`, `isTitleParentCode`, `MOVEMENT_CODE_REGEX` en `src/lib/account-code.ts`; `nextChildCode` en
  `src/modules/accounting/utils/next-account-code.ts`; `checkMovementParent` y `parentCheckMessage` en
  `src/modules/accounting/utils/parent-title.ts` (pura: recibe `parent` ya cargado, no un lookup);
  `getNextAccountCodeAction(type, companyId, parentId)`.
- **Decisiones del dueño pendientes antes del paso 2** (ambigüedades del test-agent):
  1. `getNextAccountCodeAction` con padre inválido: los tests exigen el mensaje genérico "La cuenta padre no es válida
     para este tipo de cuenta." para TODA causa (incluido tipo incompatible); §8 define además "El título padre {código}
     es de otro tipo de cuenta." (ese lo usa `parentCheckMessage` en alta/edición/import). Recomendación: dejarlo así.
  2. RN-3: los tests aceptan CONTRA_ASSET bajo padre CONTRA_ASSET y rechazan ASSET bajo padre CONTRA_ASSET.
     Irrelevante en la práctica (los títulos son ASSET), recomendación: dejarlo.
  3. Importador: re-importar una cuenta de movimiento que ya existe sin padre en la BD se **omite** (`skipped`), sin
     error (RN-12). El motivo de error por código mal formado no se fija (`reason` libre entre los permitidos).
  4. `tsc` se rompe entre el paso 2 y el 4: `AccountsTable.tsx` llama a `getNextAccountCodeAction` con 2 argumentos
     (líneas ~162 y ~207) y el paso 2 exige `parentId`. Recomendación: que el ledger-agent adapte esas dos llamadas de
     forma mínima (p. ej. pasar el padre elegido o no sugerir hasta elegir padre) para no dejar la rama en rojo de tipos;
     el ui-agent rehace el formulario completo en el paso 4.
- La spec §7 describe `services/assertValidParentTitle` (async); los tests siguen la versión pura `utils/parent-title.ts`
  (más simple y suficiente). Alinear §7 al cerrar.

Notas de diseño para el paso 2:
- Sin migración y sin tocar producción en toda esta spec.
- La función de validación de padre es pura (recibe un `lookup(code) => título | null`); así el importador valida
  contra la base **y** contra los títulos del mismo archivo sin duplicar la regla ni acoplar módulos (DDD).
- `existingCodes` para la sugerencia incluye las cuentas eliminadas (RN-5); el padre excluye eliminadas (RN-2).

## 11. Riesgos y preguntas abiertas
**Resueltas (dueño, 2026-10-05):** estructura 1/1/2/2/3 fija en todos los planes · cuenta de movimiento sin título
padre **no** se permite.

- Riesgo resuelto (2026-10-05): las dos **empresas demo** renumeradas a 9 dígitos no tenían títulos. Se les creó la
  jerarquía completa (migración `20261005_demo_account_titles`, 169 títulos) y los seeds la generan; para ellas ya
  se puede crear una cuenta de movimiento nueva eligiendo un título padre.
- Riesgo: el importador pasa a rechazar filas de movimiento sin padre. Un archivo que traiga solo cuentas de 9 dígitos
  y ningún título (formato plano) ya no se importará completo; el mensaje de fila dice qué título falta. El plan real
  de la tester (títulos incluidos, 242 cuentas) cumple la regla al 100 %.
- Riesgo: sin `parentId` en el schema, la jerarquía es solo prefijo de texto; renombrar un título no mueve a sus hijos.
  Fuera de alcance, ya era así.
- Riesgo: concurrencia — dos usuarios que piden la sugerencia a la vez reciben el mismo código; el segundo alta falla
  con "código ya en uso" (mensaje de negocio existente). Aceptado: es una sugerencia, no una reserva.
- Tamaño: toca action de lectura, alta, edición, importador y formulario. Si al planificar no cabe en una rama, partir
  en (1) utilidad + validación de servidor + importador y (2) formulario con sugerencia.

## 12. Cierre
- Commits (rama `feat/spec-008-codigo-sugerido-nueve-digitos`): `1ff66b16` tests en RED (paso 1) · `676417cc` lógica
  (util, validación de padre, actions, importador) · `53b76a88` formulario con selector de padre · commit de cierre
  (limiter de update, desbloqueo de la UI, topes del importador, docs). Sin merge a `main`.
- Tests: antes 5638 → después **5903** (+265; 0 fallos). Gates: tsc 0 · eslint 0 errores · prettier OK · 6 shards verdes.
  Mutaciones verificadas: H-1 (update solo si el código cambia), limiter de update, `catch` de la sugerencia, padre sin
  `companyId`/`deletedAt` (el helper `in-memory-account-db` hace fallar un `where` incompleto).
- security-agent: **GO**, 0 CRITICAL/HIGH. Corregidos M-1 (update sin limiter), L-1 (UI bloqueada si la sugerencia falla
  por red) y L-2 (topes de longitud del importador). Pendientes documentados en ADR-059: M-2 (AuditLog del import sin
  IP/UA ni `$transaction`), L-3, L-4, I-1..I-5.
- Decisiones tomadas por la sesión principal (ambigüedades del test-agent): mensaje genérico de padre inválido en la
  sugerencia (no confirma si un id ajeno existe); re-importar una cuenta existente sin padre se omite (`skipped`); la
  validación de padre es una función pura (`utils/parent-title.ts`) en vez del `assertValidParentTitle` async de §7.
- ADR creado o actualizado: ADR-059.
- Lección aprendida: LL-017.
