# ADR-037 — Caja Chica: RIF del proveedor, logging de rechazos y soporte siempre obligatorio

- **Estado:** ACCEPTED
- **Fecha:** 2026-06-21
- **Fase:** Auditoría Caja Chica — Fase 3 (rama `feat/cajachica-rif-auditoria`)
- **Autor:** arch-agent
- **Relacionados:** ADR-036 (Fase 2 — custodio/cierre), ADR-035 (Fase 1 — índice parcial reembolsos), ADR-002 (Decimal), ADR-003 (onDelete Restrict), ADR-004 (companyId guard), ADR-006 (security), R-5/R-6, Z-2
- **Hallazgos que resuelve:** HC-10 (RIF del proveedor en el gasto), HC-08 (no se registran los intentos rechazados), HC-01 (soporte obligatorio solo sobre umbral)

## Contexto

La auditoría externa (María F. Rojas, CPC 45.821) detectó en Fase 3 tres deficiencias de trazabilidad y control sobre los gastos del fondo fijo (`CajaCajaMovement`):

1. **HC-10** — El gasto de caja chica no captura el RIF del proveedor. Sin él se pierde trazabilidad fiscal: no se puede cruzar el gasto con el proveedor para deducibilidad (Art. 90 LISLR exige soporte con identificación del emisor) ni alimentar reportes de terceros.
2. **HC-08** — Solo las operaciones **exitosas** generan `AuditLog`. Los intentos **rechazados** por reglas de negocio (saldo insuficiente, caja cerrada, cuenta de tipo incorrecto, fecha fuera de período, etc.) no dejan rastro. Control interno COSO y COT Art. 126 (deber de conservar registros) exigen rastro de los rechazos: un patrón de rechazos repetidos es señal de fraude o de error de proceso.
3. **HC-01** — El documento soporte (`supportingDocumentId`) hoy es obligatorio solo si el monto VES supera 500.000 (refine en `CreateMovementSchema`). La política contable de la empresa pasa a exigir **soporte siempre** (todo desembolso de caja chica debe tener comprobante).

## Decisiones

### D-1 (HC-10) — `providerRif` nullable, validado solo si se provee

El RIF del proveedor es una **columna `String?` nullable** en `CajaCajaMovement`, validada con `VEN_RIF_REGEX` en Zod **solo cuando viene un valor** (`.optional()` + refine condicional).

**Por qué opcional y no obligatorio** — desde la realidad del fondo fijo:

- El fondo fijo (imprest) existe justamente para **gastos menudos** (café, taxi, estacionamiento, propinas, peajes) donde con frecuencia **no hay un proveedor formal con RIF**. Forzar un RIF obligatorio empujaría a los usuarios a inventar RIFs (`J-00000000-0`) — peor que un `NULL`, porque contamina datos fiscales con basura que parece válida.
- Fiscalmente: un gasto sin RIF no es no-deducible *per se*; lo que la deducibilidad exige es soporte (D-3) y, cuando el monto y la naturaleza lo ameritan, factura con RIF. La granularidad "obligar RIF según monto" no fue pedida por el negocio y añadiría un segundo umbral frágil (mismo anti-patrón que HC-01 corrige). **YAGNI**: si más adelante se exige RIF sobre cierto monto, es un refine adicional, no un cambio de schema.
- La **trazabilidad** que pide HC-10 se cumple con capturar el RIF *cuando existe*. La columna nullable lo permite sin penalizar el gasto legítimo sin RIF.

**Validación Zod** (la implementa el agente de schema/test): el campo se valida con `VEN_RIF_REGEX` únicamente si tiene contenido. Patrón sugerido:

```ts
providerRif: z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v.toUpperCase() : undefined))
  .refine((v) => v === undefined || VEN_RIF_REGEX.test(v), {
    error: "RIF inválido (formato J-12345678-9)",
  }),
```

**Normalización** — guardar normalizado en `uppercase`. No existe helper de normalización de RIF en el repo (revisado `src/lib/tax-config.ts` y `src/lib/fiscal-validators.ts`: solo está `VEN_RIF_REGEX` y `validateVenezuelanRif`, ambos case-insensitive vía flag `i`, ninguno normaliza). Decisión:

- **Uppercase sí** (la letra del tipo de RIF — J/V/E/G/C/P — se almacena en mayúscula para consistencia y para futuras búsquedas exactas).
- **Guiones: NO reescribir.** `VEN_RIF_REGEX` (`/^[JVEGCP]-\d{8}-?\d$/i`) acepta el formato con guiones `J-12345678-9`, que es el formato canónico que el usuario ve y teclea. Inventar una normalización de guiones (quitarlos / re-insertarlos) implicaría un helper nuevo no justificado por el negocio (YAGNI) y arriesgaría divergir de cómo se almacena el RIF en el resto del sistema (`Contact`, `Vendor`), que guardan el string tal cual tecleado. **Solo `.trim()` + `.toUpperCase()`.** El refine valida; no transforma la puntuación.
- Esta normalización vive en el **schema Zod** (capa de aplicación), no en la DB. La columna almacena lo que el Zod ya normalizó.

**Schema (no se indexa)** — no se busca por RIF en este módulo (la lista de gastos se filtra por caja y fecha, no por proveedor). Un índice sería costo de escritura sin lector. **Sin índice.**

Bloque Prisma (añadir a `model CajaCajaMovement`, junto a `supportingDocumentId`):

```prisma
  // HC-10 (ADR-037): RIF del proveedor del gasto, para trazabilidad fiscal.
  // Nullable: el fondo fijo cubre gastos menudos que a menudo no tienen proveedor
  // formal con RIF (café, taxi). Si se provee, el Zod lo valida con VEN_RIF_REGEX
  // y lo normaliza a uppercase. Sin índice: no se busca por RIF en este módulo.
  providerRif String? @db.VarChar(20)
```

`@db.VarChar(20)` — el RIF más largo (`J-12345678-9`) son 12 caracteres; 20 da holgura sin desperdicio. No `Decimal`, no monetario.

### D-2 (HC-08) — Helper `logRejection` best-effort, fuera de la transacción

#### D-2.1 Dónde y cómo

Los rechazos de regla de negocio se lanzan como `Error` **dentro del `$transaction`** del servicio → el rollback revierte cualquier `AuditLog` escrito ahí. Por tanto **el log del rechazo debe escribirse FUERA de la transacción fallida**, en el `catch` de la action, como un `auditLog.create` independiente.

**Decisión:** un helper `logRejection(...)` invocado en el `catch` de las actions de mutación financiera, **antes** de `return toActionError(e)`:

```ts
// src/modules/cajachica/utils/log-rejection.ts (esquema — lo implementa el agente)
export async function logRejection(params: {
  companyId: string;
  userId: string;
  action: string;        // p.ej. "CREATE_MOVEMENT"
  entityName: string;    // p.ej. "CajaCajaMovement"
  entityId?: string;     // id si se conoce; si no, ver D-2.2
  error: unknown;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    if (!shouldLog(params.error)) return;   // filtro D-2.3
    await prisma.auditLog.create({
      data: {
        companyId: params.companyId,
        userId: params.userId,
        action: `${params.action}_REJECTED`,
        entityName: params.entityName,
        entityId: params.entityId ?? "N/A",
        newValue: { reason: businessReason(params.error), outcome: "REJECTED" },
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    });
  } catch {
    // best-effort: NUNCA romper el flujo ni cambiar el error que ve el usuario.
  }
}
```

Llamada en cada action de mutación financiera dentro del `catch`:

```ts
  } catch (e) {
    await logRejection({ companyId: parsed.data.companyId, userId: g.userId,
      action: "CREATE_MOVEMENT", entityName: "CajaCajaMovement", error: e,
      ipAddress, userAgent });
    return toActionError(e);
  }
```

Actions cubiertas (las 9 de mutación financiera): `createMovement`, `createDeposit`, `voidDeposit`, `postReimbursement`, `voidReimbursement`, `createReimbursement`, `closeCajaCaja`, `createCajaCaja`, `approveMovement`, `voidMovement`, `assignCustodian`. Las actions de solo lectura (`list*`, `get*`) **no** se loguean (no son mutaciones; un fallo ahí es infra, no rechazo de regla).

> Nota: el helper requiere `g.userId`, que solo existe si el guard de rol pasó. Si el guard de rol **falla** (no autenticado / rol insuficiente / rate limit), el flujo retorna *antes* del `try`; ese caso no genera `logRejection` (no hay userId fiable y no es un rechazo de regla de negocio del dominio, sino de autorización — que ya tiene su propio rastro en Clerk/rate-limit). Solo se loguean los rechazos que ocurren **después** de superar el guard, es decir, los rechazos de **regla de negocio del servicio**.

#### D-2.2 Convención de campos

- `action`: `"<ACCION>_REJECTED"` — sufijo uniforme sobre el `action` del log exitoso correspondiente (`CREATE_MOVEMENT` → `CREATE_MOVEMENT_REJECTED`). Permite filtrar todos los rechazos con `action LIKE '%_REJECTED'` y correlacionar con el éxito por el prefijo.
- `entityName`: el modelo afectado (`"CajaCaja"`, `"CajaCajaMovement"`, `"CajaCajaDeposit"`, `"CajaCajaReimbursement"`). Igual que el log exitoso.
- `entityId`: el id de la entidad si se conoce en la action (p.ej. `voidMovement` recibe `movementId`). **Para creaciones (`createMovement`, `createDeposit`, `createCajaCaja`) el id aún no existe** → usar el sentinel `"N/A"`. `entityId` es `String` requerido (no nullable), por eso un sentinel y no `null`. No inventar un UUID (sería un id que no apunta a nada).
- `newValue` (REQUERIDO, no nullable): `{ reason, outcome: "REJECTED" }`, donde `reason` = mensaje de negocio derivado del error (ver D-2.3). Opcionalmente, los campos de contexto no sensibles que la action ya tiene (p.ej. `{ reason, outcome: "REJECTED", cajaCajaId }`). **R-6** ya cubre IP/UA, que se pasan al helper.

#### D-2.3 Qué se loguea: solo rechazos de regla de negocio, no infra ni Zod

`shouldLog(error)` filtra para evitar ruido y log inútil:

- **Sí loguear:** `Error` de negocio lanzado por el servicio (mensajes nuestros: "Saldo insuficiente…", "La Caja Chica no está activa", "La cuenta de gasto del movimiento debe ser de tipo Gasto", "No hay período contable abierto", etc.). Son rechazos de regla → es exactamente lo que HC-08 quiere rastrear.
- **No loguear errores de infraestructura:** `PrismaClientInitializationError`, errores de conexión/timeout (la heurística de `isConnectionError` en `prisma-errors.ts`). Razón doble: (a) no son rechazos de regla; (b) si la DB está caída, el propio `auditLog.create` también fallaría — por eso el helper es best-effort con `try/catch` interno que traga el error sin romper el flujo.
- **No loguear P2002 de correlativo transitorio:** `isPrismaError(e, "P2002")` sobre `voucherNumber`/`number` es un reintento transitorio (Z-1), no una violación de regla — sería ruido. Filtrarlo.
- **Validación Zod:** ocurre **antes** del guard y del `try` (la action hace `safeParse` y retorna temprano). Nunca llega al `catch`, así que no se loguea — correcto: un input malformado del cliente no es un rechazo de regla de negocio que amerite rastro de control interno.

`businessReason(error)` reutiliza `mapPrismaError`/el `message` del `Error` — **el mismo mensaje de negocio que ya ve el usuario**. No el stack ni el error crudo.

#### D-2.4 Volumen y PII

- **Volumen:** el filtro D-2.3 acota a rechazos de regla reales (un usuario que tropieza con "saldo insuficiente"), no a cada timeout o validación de formulario. Volumen esperado bajo. `AuditLog` está **EXENTO del billing gate** (`prisma-billing-gate.ts` EXEMPT_MODELS), así que el log de rechazo funciona incluso si la suscripción venció — correcto: el rastro de control interno no debe depender del estado de pago.
- **PII:** el `reason` es **un mensaje de negocio compuesto por nosotros** (string fijo o con montos/ids), **no input crudo del usuario**. No contiene datos del proveedor, ni el RIF, ni texto libre tecleado. Criterio confirmado: `reason` es seguro para auditoría; no volcar en él `concept`, `description`, `notes` ni `providerRif` (esos sí son input libre y podrían traer PII). Solo el mensaje de regla + ids técnicos.
- **Append-only (ADR-006 D-4):** el helper solo hace `auditLog.create`. Nunca `update`/`delete`. Se mantiene la invariante.

### D-3 (HC-01) — Soporte siempre obligatorio

`CreateMovementSchema`: **eliminar el `.refine()` del umbral 500.000** y cambiar `supportingDocumentId` de `z.string().optional()` a `z.string().min(1, { error: "Documento soporte requerido" })`.

- **Sin efecto sobre filas existentes:** es validación de **creación nueva** (`CreateMovementSchema`). No hay migración, no hay backfill, no toca movimientos ya creados. Las cajas y movimientos legacy con `supportingDocumentId = NULL` siguen válidos en DB; solo los gastos **nuevos** exigirán soporte.
- **Efecto en tests:** los tests de `createMovement`/`createMovementAction` que hoy crean un movimiento **sin** `supportingDocumentId` (apoyándose en que era opcional bajo el umbral) **fallarán** y deben actualizarse para pasar un `supportingDocumentId`. Esto es esperado y deseable (el test debe reflejar la nueva política). El agente de tests lo ajusta.
- **Importación masiva:** no hay importación masiva de movimientos de caja chica en el módulo (la importación CSV de ALERTA 12 es de **facturas**, no de caja chica). Sin impacto colateral.
- El `supportingDocumentId` sigue siendo `String? @db.VarChar(255)` en la DB (nullable) — la obligatoriedad vive en el Zod de creación, no en el schema. No se cambia el schema Prisma por HC-01.

## Migración (HC-10 — única que toca la DB)

Solo D-1 modifica el schema. SQL idempotente, aplicado por HTTP 443 (VPN bloquea TCP 5432 — memoria `migraciones-neon-vpn-http`):

```sql
-- prisma/migrations/20260621_cajachica_provider_rif/migration.sql
ALTER TABLE "caja_caja_movements"
  ADD COLUMN IF NOT EXISTS "providerRif" VARCHAR(20);
```

Aplicación: `node scripts/apply-migration-http.mjs 20260621_cajachica_provider_rif` → luego `npx prisma generate`.

**Análisis de riesgo de migración:**
- `ADD COLUMN ... NULL` es no destructivo, no requiere reescritura de tabla en Postgres (columna nullable sin default → metadata-only). 0 filas de datos modificadas.
- Idempotente (`IF NOT EXISTS`): re-ejecutable sin daño si falla a mitad o se reintenta.
- Sin backfill: las filas existentes quedan con `providerRif = NULL`, que es semánticamente correcto (gastos legacy sin RIF capturado).
- Rollback: `ALTER TABLE "caja_caja_movements" DROP COLUMN IF EXISTS "providerRif";` (no incluido en la migración; documentado por si se necesita revertir manualmente).

## Alternativas consideradas

- **`providerRif` obligatorio** (rechazada): el fondo fijo cubre gastos sin proveedor formal; obligar el RIF produce datos basura (RIFs inventados) peores que un `NULL`. La trazabilidad de HC-10 se cumple capturándolo cuando existe.
- **RIF obligatorio sobre un umbral de monto** (rechazada — YAGNI): no fue pedido, reintroduce el anti-patrón de doble umbral que HC-01 elimina. Si el negocio lo pide luego, es un refine adicional sin cambio de schema.
- **Normalizar guiones del RIF** (rechazada — YAGNI): no hay helper en el repo y el resto del sistema almacena el RIF tal cual se teclea; inventar normalización de puntuación arriesga divergencia. Solo `trim` + `uppercase`.
- **Índice en `providerRif`** (rechazada): no hay lector (no se busca por RIF en el módulo). Costo de escritura sin beneficio.
- **Loguear rechazos dentro del `$transaction`** (rechazada — es la raíz del bug HC-08): el rollback los revertiría. Deben escribirse fuera, en el `catch` de la action.
- **Loguear TODOS los errores** (rechazada): los errores de infra/conexión no son rechazos de regla y, peor, el `auditLog.create` también fallaría si la DB está caída → log inútil + ruido. Filtro D-2.3.
- **Un modelo nuevo `RejectionLog`** (rechazada — KISS): `AuditLog` ya tiene IP/UA, companyId, userId, está exento del billing gate y es append-only. Reusarlo con el sufijo `_REJECTED` evita un modelo paralelo y mantiene la auditoría en una sola tabla.
- **HC-01: obligatoriedad en el schema Prisma (`NOT NULL`)** (rechazada): rompería las filas legacy con `supportingDocumentId = NULL` y exigiría backfill. La obligatoriedad es política de creación → vive en el Zod, la columna sigue nullable.

## Consecuencias

**Positivas**
- HC-10: trazabilidad fiscal del proveedor cuando existe, sin penalizar el gasto menudo legítimo.
- HC-08: rastro de control interno de los rechazos de regla (COSO / COT Art. 126), sin romper el flujo del usuario (best-effort) ni depender del estado de suscripción (AuditLog exento del gate).
- HC-01: política contable cumplida — todo gasto de caja chica nuevo exige comprobante.
- Cero modelos nuevos; se reutiliza `AuditLog`. Una sola columna nueva, nullable, metadata-only.

**Negativas / costos**
- Cada action de mutación gana una línea (`await logRejection(...)`) en el `catch` — superficie pequeña pero repetida; mitigado por el helper centralizado.
- Tests de creación de movimiento sin soporte deben actualizarse (HC-01).
- El sufijo `_REJECTED` introduce una convención que el agente de UI/reportes debe conocer si más adelante se muestra "actividad de rechazos".

**Riesgo de migración** — ver sección Migración. No destructiva, idempotente, sin backfill, 0 filas modificadas.

## Checklist SCHEMA_AUDITOR
- [x] Nueva columna no monetaria (RIF — `VarChar(20)`, no Decimal/Float)
- [x] Sin relaciones nuevas → no aplica `onDelete: Restrict` / Cascade
- [x] Nullable justificado (gastos sin proveedor formal); sin backfill obligatorio
- [x] Sin índice nuevo (sin lector — justificado)
- [x] `AuditLog` reutilizado y append-only — solo `create`, nunca `update`/`delete` (ADR-006 D-4)
- [x] `logRejection` best-effort: `try/catch` interno, no cambia el error que ve el usuario
- [x] `reason` = mensaje de negocio nuestro, no input crudo → sin PII (ADR-006)
- [x] AuditLog exento del billing gate → rechazos se registran aun con suscripción vencida
- [x] R-6: IP/UA propagados al log de rechazo
- [x] No se aceptan tasas de impuesto del cliente (ADR-006 D-3) — N/A (RIF no es tasa)
- [x] HC-01: obligatoriedad en Zod de creación, no en DB → filas legacy intactas
- [x] Riesgo de migración documentado + rollback manual indicado
- [x] Migración idempotente, aplicada por HTTP 443 (VPN)
