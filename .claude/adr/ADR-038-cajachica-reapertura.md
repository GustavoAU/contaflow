# ADR-038 — Reapertura de Caja Chica cerrada (F-17)

- **Estado:** ACEPTADO
- **Fecha:** 2026-06-22
- **Rama:** `feat/cajachica-reapertura`
- **Módulo:** Caja Chica (`src/modules/cajachica`)
- **Relacionados:** ADR-036 (cierre de caja chica), ADR-037 (RIF/soporte/auditoría), ADR-015 (ajustes a período cerrado), R-1, R-3, R-6, Z-1
- **Decide:** arquitectura. **No** implementa código de producción (lo hará `ledger-agent`).

---

## 1. Contexto

ADR-036 introdujo el cierre de caja chica (`closeCajaCaja`): valida que no haya
movimientos `PENDING`/`APPROVED`, calcula el remanente como saldo GL real de la
cuenta de la caja (`SUM(JournalEntry.amount)` de Transactions `POSTED`), y:

- si remanente > 0 → crea el Transaction de liquidación `CCC-LIQ-NNNNNN`
  (Dr `returnAccount` / Cr cuenta caja) y lo enlaza en `CajaCaja.closeTransactionId`
  (FK `@unique`, `onDelete: Restrict`);
- si remanente == 0 → sin asiento, `closeTransactionId = null`;
- marca `status=CLOSED`, `closedAt`, `closedBy`, y registra `AuditLog CLOSE_CAJA_CHICA`.

La auditoría de Caja Chica 2026-06 detectó que **el cierre no es reversible**: un
cierre por error (caja equivocada, cuenta de retorno equivocada, cierre prematuro)
deja la caja inutilizable y obliga a crear una caja nueva, perdiendo continuidad
operativa y de control interno (custodio, histórico). Se necesita una operación
de **reapertura** que sea contablemente honesta (R-1: VOID nunca borra) y que
restaure la caja a estado operativo.

El módulo ya tiene un patrón de reversa probado: `voidDeposit`
(`CajaCajaDepositService.ts`) carga el Transaction original con `entries`, y si no
está `VOIDED` crea una **contrapartida espejo** (cada entry con `amount` negado)
como nuevo Transaction (fecha hoy, período `OPEN`, correlativo `DEP-REV-NNNNNN`),
marcando el original `status=VOIDED`. La reapertura sigue este mismo patrón.

---

## 2. Decisión

Nueva operación `reopenCajaCaja` (servicio `CajaCajaService.ts`) +
`reopenCajaCajaAction` (`cajachica.actions.ts`), bajo `$transaction` **Serializable**
(Z-1: crea un Transaction con correlativo `@@unique([companyId, number])`).

### 2.A — Semántica de la reapertura

**A.1 — Solo reabre `status=CLOSED` (idempotencia).** CONFIRMADO.
Guard al inicio del `$transaction`:
- caja no encontrada (con `companyId`, ADR-004) → "Caja Chica no encontrada";
- `status !== "CLOSED"` → "Solo se puede reabrir una Caja Chica cerrada".
Esto hace la operación idempotente frente a doble-submit: el segundo intento ve
`ACTIVE` y es rechazado con mensaje de negocio (no produce doble reversa).

**A.2 — Reversa GL cuando `closeTransactionId != null`.** DE ACUERDO con el patrón.
Reproduce exactamente `voidDeposit`:
1. Cargar el `closeTransaction` original con `entries` (filtrando `companyId`, ADR-004).
2. Verificar `status !== "VOIDED"` (ver A.6).
3. Resolver el período `OPEN` actual (ver A.5).
4. Construir las entries espejo: `{ accountId, amount: amount.negated(), description }`
   por cada entry original. Esto produce **Dr cuenta caja / Cr returnAccount** por el
   remanente, inverso exacto del cierre. Usar `Decimal` (R-5) — `new Decimal(e.amount.toString()).negated()`.
5. `assertBalancedGLEntries(reverseEntries)` (R-1: invariante partida doble).
6. Crear el Transaction de reversa.
7. `tx.transaction.update(original → status: "VOIDED")`.

> Construir las entries espejo a partir de las entries **reales** del Transaction
> original (no recalcular el remanente) es deliberado: garantiza que la reversa anula
> exactamente lo asentado, aunque el saldo de la caja haya cambiado por otra vía.

**Correlativo:** `CCC-REOP-NNNNNN`.
- Prefijo nuevo y distinto de `CCC-LIQ` → no colisiona con la secuencia de cierres y
  es legible en el Libro Diario ("reapertura de caja chica").
- Contador: `count` de cajas con cierres previos no sirve aquí (la reapertura limpia
  `closeTransactionId`, ver A.4). Numerar contando los Transactions cuyo `number`
  empieza por `CCC-REOP-` en la empresa:
  `tx.transaction.count({ where: { companyId, number: { startsWith: "CCC-REOP-" } } }) + 1`,
  `padStart(6, "0")`. Mismo patrón conceptual que `DEP-REV` (cuenta de la entidad base).
- Capturar `P2002` sobre `@@unique([companyId, number])` → "Error transitorio — intenta de nuevo."
  (Z-1, idéntico a `closeCajaCaja`).

**A.3 — Cierre con remanente 0 (`closeTransactionId == null`).** CONFIRMADO.
No hay asiento que revertir. La reapertura solo restaura el estado (A.4); no crea
ningún Transaction `CCC-REOP`. El `AuditLog` registra `closeTransactionReversed: null`.

**A.4 — Restaurar estado: LIMPIAR `closedAt`/`closedBy`/`closeTransactionId`.**
RECOMENDACIÓN: **limpiar** (poner a `null`), no preservar. DE ACUERDO con la opción A.

```
status: "ACTIVE", closedAt: null, closedBy: null, closeTransactionId: null
```

Razones:
1. **Obligatorio por el `@unique`.** `closeTransactionId String? @unique`. Si no se
   limpia, un cierre futuro de la misma caja intentaría escribir un nuevo
   `closeTransactionId`, y mientras el viejo siga presente la caja quedaría enlazada
   a un Transaction ahora `VOIDED` — estado inconsistente. Limpiarlo deja el slot
   libre para el próximo ciclo cerrar→reabrir→cerrar.
2. **El histórico ya está en el AuditLog (R-6).** `CLOSE_CAJA_CHICA` (con `closedAt`,
   `returnAccountId`, `remainingAmount`, `closeTransactionId`) + el nuevo
   `REOPEN_CAJA_CHICA` (con el id del cierre revertido y el id de la reversa) forman
   la traza completa e inmutable. No se pierde información al limpiar las columnas.
3. **`closedAt`/`closedBy` son estado del ciclo de vida actual**, no historial: su
   semántica es "esta caja está cerrada, por X, en Y". Reabierta, esa afirmación es
   falsa; mantener valores viejos sería un dato mentiroso en la UI/exports
   (`serializeCaja` expone `closedAt`).

**A.5 — Sin período `OPEN` al reabrir (para postear la reversa).** Error claro. CONFIRMADO.
- Si `closeTransactionId != null` y no existe período `OPEN` → abortar con
  "No hay período contable abierto para registrar la reapertura de la Caja Chica."
  (mismo criterio que `voidDeposit`). La fecha de la reversa es **hoy** y debe caer
  en período `OPEN` (R-3). Se reutiliza `PeriodService.assertDateInOpenPeriod(companyId, today, tx)`
  para consistencia con `closeCajaCaja`/`createDeposit` (lanza si la fecha no cae en
  período `OPEN`).
- Si `closeTransactionId == null` (remanente 0) → **no se exige período OPEN**: no hay
  asiento, solo cambio de estado. La reapertura nunca toca el período del cierre original
  (R-3 / ADR-015: jamás se reabre ni se postea en un período `CLOSED`).

**A.6 — Edge: `closeTransaction` original ya `VOIDED`.** Guard definido.
Si `closeTransactionId != null` pero el Transaction original ya está `VOIDED`
(estado inconsistente, p. ej. anulado por otra vía), **no crear una segunda reversa**.
Lógica (idéntica al guard de `voidDeposit`, `if (original && original.status !== "VOIDED")`):
- cargar `original`; si `original` no existe **o** `original.status === "VOIDED"` →
  **saltar** la creación de la reversa y proceder solo con la restauración de estado (A.4).
- registrar en el `AuditLog` la condición (`closeTransactionAlreadyVoided: true`) para
  trazabilidad. No es un error bloqueante: la meta es dejar la caja `ACTIVE` y limpia,
  y un asiento ya `VOIDED` ya está revertido.

### 2.B — Permiso

**DECISIÓN: `guardAdmin` (OWNER/ADMIN), SIN step-up 2FA.** Consistente con `closeCajaCaja`.

Criterio (costo/beneficio):
- La auditoría la llamó "permiso Gerente"; en el modelo de roles de ContaFlow no
  existe rol "Gerente" separado — mapea a `ADMIN`. `ROLES.ADMIN_ONLY = [OWNER, ADMIN]`
  ya satisface esa intención. El cierre usa `guardAdmin`; reabrir el cierre debe exigir
  **al menos** el mismo nivel → `guardAdmin` (no degradar a `guardOperations`).
- **No step-up 2FA.** Step-up (`src/lib/step-up.ts`, `useReverification`, `has()` en el
  guard) está reservado a operaciones de impacto estructural/irreversible (cierre de
  ejercicio, eliminar miembro, datos SENIAT, archivar empresa). La reapertura de caja
  chica:
  - es **reversible y autocorrectiva** (siempre se puede volver a cerrar);
  - opera sobre **montos bajos** (fondo fijo de caja chica);
  - genera una contrapartida `POSTED` auditable + `AuditLog` con IP/UA (R-6) —
    la traza forense ya existe sin 2FA;
  - añadir step-up implica `useReverification` en el cliente + `has()` en el guard +
    manejo de `clerk_error` en tests, complejidad desproporcionada para el riesgo.
- Rate limiting: ya provisto por `guardRole` vía `limiters.fiscal` (30/min). Suficiente
  (ADR-006 D-5).

### 2.C — Schema

**SIN cambios de schema. SIN migración.** CONFIRMADO.
La reapertura reutiliza columnas existentes en `CajaCaja`:
`status` (`CajaCajaStatus` ACTIVE/CLOSED), `closedAt`, `closedBy`, `closeTransactionId`.
La nueva acción de auditoría `REOPEN_CAJA_CHICA` es un **valor de string** en
`AuditLog.action` (campo libre, sin enum) → no requiere columna ni enum nuevo.
El Transaction de reversa usa el modelo `Transaction`/`JournalEntry` existente.

---

## 3. Alternativas consideradas

1. **No permitir reapertura (statu quo).** Rechazada. Obliga a crear una caja nueva
   ante cualquier cierre por error; pierde continuidad de custodio/histórico y
   contradice el hallazgo de auditoría.
2. **Crear caja nueva en lugar de reabrir.** Rechazada. Duplica configuración,
   fragmenta el histórico de una misma caja física en dos entidades, y deja la caja
   cerrada-por-error como ruido permanente. La reapertura conserva la identidad de la caja.
3. **Reabrir borrando (DELETE) el Transaction de cierre.** Rechazada de plano (R-1:
   asientos nunca se borran, solo `VOID` con contrapartida). El patrón espejo de
   `voidDeposit` es la única forma contablemente válida.
4. **Preservar `closedAt`/`closedBy` como "último cierre".** Rechazada (ver A.4):
   choca con el `@unique` de `closeTransactionId`, ensucia la UI con datos falsos, y
   el histórico ya vive en el `AuditLog` inmutable.
5. **Exigir step-up 2FA.** Rechazada (ver B): desproporcionado para una operación
   reversible de montos bajos ya cubierta por `AuditLog` R-6 + `guardAdmin`.

---

## 4. Consecuencias

**Positivas**
- Cierre por error recuperable sin perder la caja ni su control interno.
- GL siempre cuadrado: el remanente devuelto al cerrar vuelve a la caja al reabrir vía
  contrapartida `POSTED`; el Transaction de cierre queda `VOIDED` (no borrado).
- Traza forense completa e inmutable (CLOSE + REOPEN en `AuditLog`, ambos con IP/UA).
- Cero deuda de schema; reutiliza patrones ya probados (`voidDeposit`, `closeCajaCaja`).

**Negativas / riesgos**
- Una caja puede ciclar cerrar↔reabrir varias veces, generando varios `CCC-LIQ` +
  `CCC-REOP` en el Libro Diario. Es ruido legítimo y trazable (no un bug).
- La reapertura depende de un período `OPEN` cuando hubo asiento de cierre; si todos
  los períodos están `CLOSED`, la reapertura se bloquea hasta abrir uno (correcto por R-3).
- `reopenCajaCaja` debe mantenerse alineada con la convención de signos de
  `closeCajaCaja` (amount positivo = Débito). Al negar las entries reales del cierre,
  esa convención se respeta automáticamente.

---

## 5. Invariantes verificadas

- **R-1 (VOID no borra):** el Transaction de cierre se marca `VOIDED`, nunca se borra;
  la reversa es una contrapartida espejo balanceada (`assertBalancedGLEntries`).
- **R-3 (períodos):** la reversa se postea con fecha hoy en período `OPEN`
  (`assertDateInOpenPeriod`); jamás se toca el período del cierre original.
- **R-5 (cero flotantes):** montos con `Decimal.js`; entries espejo vía
  `new Decimal(e.amount.toString()).negated()`.
- **R-6 (trazabilidad):** `AuditLog REOPEN_CAJA_CHICA` con `ipAddress`/`userAgent`,
  dentro del mismo `$transaction`, registrando `closeTransactionId` revertido +
  id de la reversa (o `null`/`alreadyVoided`).
- **Z-1 (Serializable):** `$transaction` con `isolationLevel: "Serializable"` por el
  correlativo `CCC-REOP-NNNNNN`; `P2002` sobre `@@unique([companyId, number])` →
  mensaje de negocio "Error transitorio — intenta de nuevo."
- **ADR-004 (multi-tenant):** todo `findFirst` filtra por `companyId` (caja y Transaction).
- **ADR-006 (autorización + rate limit):** `guardAdmin` + `limiters.fiscal` (30/min).

---

## 6. Contrato de implementación (para `ledger-agent`)

- **Schema Zod nuevo** en `cajachica.schema.ts`:
  `ReopenCajaCajaSchema = z.object({ cajaCajaId: z.string().min(1), companyId: z.string().min(1) })`.
  (No requiere `returnAccountId`: la reversa se deriva de las entries del cierre original.)
- **Servicio** `reopenCajaCaja(input, userId, ipAddress?, userAgent?)` en `CajaCajaService.ts`,
  firma y estilo idénticos a `closeCajaCaja`; `$transaction` Serializable.
- **Acción** `reopenCajaCajaAction(raw)` en `cajachica.actions.ts`: `safeParse` →
  `guardAdmin` → `getIpAndUa` → `reopenCajaCaja` → `rejectAndReport` con
  `action: "REOPEN_CAJACAJA"`, `entityName: "CajaCaja"`, `entityId: cajaCajaId`.
- **Tests** (Vitest 4): solo CLOSED es reabrible; reversa espejo cuando hay
  `closeTransactionId`; sin reversa cuando es `null`; idempotencia (segundo intento sobre
  ACTIVE falla); guard de cierre ya `VOIDED` (no doble reversa); error sin período OPEN
  cuando hubo asiento; `P2002` → mensaje transitorio; columnas limpiadas a `null`.
