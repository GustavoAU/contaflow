# ADR-039 — Step-up 2FA condicional por umbral de monto en Caja Chica (cierre y reapertura)

- **Estado:** ACEPTADO
- **Fecha:** 2026-06-22
- **Rama:** `feat/cajachica-stepup-umbral`
- **Contexto previo:** Q2-3 (step-up `STEP_UP_CONFIG` en `src/lib/step-up.ts`), ADR-036 (cierre Caja Chica + GL), ADR-038 (reapertura Caja Chica + reversa GL), gate F-17.
- **Invariantes que NO se rompen:** R-1 (separación Diario/Mayor), R-3 (períodos CLOSED), R-5 (Decimal.js), R-6 (IP/UA en AuditLog), Z-1 (correlativos Serializable), ADR-004 (companyId en toda lectura), ADR-006 D-1 (rol en acción destructiva).

---

## 1. Problema

El gate F-17 recomienda exigir step-up 2FA en operaciones de Caja Chica de alto monto,
sin penalizar la operación cotidiana de bajo monto (cajas chicas manejan montos pequeños).

A diferencia de `closeFiscalYearAction` / `removeMemberAction` (step-up SIEMPRE),
aquí el step-up debe ser **CONDICIONAL al monto involucrado**:

- `closeCajaCajaAction` → monto = remanente liquidado = saldo GL de la cuenta caja.
- `reopenCajaCajaAction` → monto = magnitud revertida = remanente del cierre original.

Esto obliga a **pre-calcular el monto en la action** (lectura barata) ANTES de decidir
si exigir step-up. El patrón Q2-3 actual no contempla la condicionalidad.

---

## 2. Decisiones

### D-A — Umbral: mecanismo y valor

**D-A.1 — Mecanismo: constante central en `src/lib/step-up.ts`. SIN migración, SIN campo en `CompanySettings`.**

Es una mejora de seguridad no bloqueante sobre montos típicamente bajos. Un campo
configurable por empresa (`CompanySettings`) exige migración + backfill + UI + tests de
permisos de edición del propio umbral (quién puede subirlo = vector de evasión del control).
Costo/beneficio negativo para v1. Una constante:

- Es defendible (un umbral uniforme de plataforma es auditable y simple).
- No introduce superficie de ataque nueva (no es editable desde el cliente).
- Se puede migrar a `CompanySettings` después si un cliente lo pide (cambio aditivo).

```ts
// src/lib/step-up.ts
/**
 * Umbral (en VES) por encima del cual el cierre/reapertura de Caja Chica exige
 * step-up 2FA (ADR-039). El monto comparado es SIEMPRE el monto VES del asiento GL
 * (libros en VES), aunque la caja sea USD/EUR. Constante de plataforma, no editable
 * por el cliente. REVISAR PERIÓDICAMENTE por inflación VES (ver D-A.2).
 */
export const CAJA_CHICA_STEP_UP_THRESHOLD_VES = new Decimal("20000");
```

> Nota de implementación: `step-up.ts` hoy no importa Decimal. Exportar la constante como
> string (`"20000"`) y construir el `Decimal` en el sitio de uso es aceptable si se prefiere
> mantener `step-up.ts` libre de dependencias. Decidir en implementación; el contrato es:
> **una sola fuente de verdad, comparación con Decimal.js (R-5), nunca `number`**.

**D-A.2 — Inflación VES: constante en VES documentada como "revisar periódicamente". NO acoplar a tasa BCV.**

Se evaluó (b) umbral en USD convertido a VES con tasa BCV vigente. Se descarta para v1:

- Acopla un control de seguridad a `exchange-rates` / disponibilidad de la tasa BCV.
  Si la tasa falla o está desactualizada, ¿se exige o no step-up? Fragiliza el control.
- Introduce no-determinismo: el mismo monto puede cruzar el umbral o no según el día.
  Un control de seguridad debe ser predecible y testeable.

La constante VES es la opción **más simple y defendible**. La erosión inflacionaria se
gestiona con un comentario explícito de "revisar periódicamente" y queda como deuda
conocida; revisar el valor es un cambio de una línea. Si en el futuro la erosión obliga
a robustez, migrar a (b) será una decisión consciente con su propio ADR.

**Valor por defecto: `20.000 VES`.** Justificación:

- Caja chica = gastos menores; un remanente a liquidar > 20.000 VES (a la tasa de
  ~2026-06 son decenas a centenas de USD) representa un evento atípico y de mayor riesgo
  que justifica fricción 2FA.
- Suficientemente alto para no molestar en cierres rutinarios de bajo monto.
- Suficientemente bajo para que un cierre/reapertura con monto material exija el 2do factor.
- Redondo y memorable, fácil de auditar y de ajustar.

**D-A.3 — El umbral aplica SIEMPRE sobre el monto VES del asiento GL. CONFIRMADO.**

Los libros están en VES. El saldo GL de la cuenta caja (`journalEntry.amount`) está en VES
aunque la caja opere en USD/EUR. El umbral se compara contra ese monto VES. No se convierte
ni se compara contra la moneda nativa de la caja. Esto es consistente con que el control
protege el impacto contable de la operación, que es VES.

---

### D-B — Dónde computar el monto (sin duplicar lógica)

**D-B.1 — Exponer helpers de LECTURA en `CajaCajaService` (no inline en la action).**

Para no duplicar el `journalEntry.aggregate` que el service ya hace internamente, se
exponen dos funciones de lectura puras y reutilizables en `CajaCajaService`:

```ts
// CajaCajaService.ts — lecturas (fuera de $transaction), companyId-scoped (ADR-004)

/**
 * Saldo GL (VES) de la cuenta de la caja = SUM(JournalEntry.amount) POSTED.
 * Misma fórmula que usa closeCajaCaja internamente (ADR-036 D-2.3) — fuente única.
 * Usado por closeCajaCajaAction para el gate de step-up (ADR-039).
 */
export async function getCajaGlBalance(cajaCajaId: string, companyId: string): Promise<Decimal>;

/**
 * Magnitud (VES) que revertiría una reapertura = |suma de las entries del
 * closeTransaction sobre la cuenta de la caja| (ADR-038 A.2). 0 si no hubo asiento
 * de liquidación o si el cierre ya está VOIDED. Usado por reopenCajaCajaAction (ADR-039).
 */
export async function getCajaReopenMagnitude(cajaCajaId: string, companyId: string): Promise<Decimal>;
```

- `getCajaGlBalance`: refactoriza el aggregate de `closeCajaCaja` (líneas 276-286) a esta
  función; `closeCajaCaja` la invoca dentro de su `$transaction` (pasando `tx`) y la action
  la invoca fuera (con `prisma`). **Patrón: la función acepta un client opcional**
  (`tx` o el `prisma` global) para servir ambos contextos sin duplicar el `where`.
- `getCajaReopenMagnitude`: lee el `closeTransactionId` de la caja y suma las entries de la
  cuenta caja del closeTransaction. Define el monto **a partir de las entries reales del
  cierre** (no recalculando remanente) — coherente con ADR-038 A.2, que ya anula
  exactamente lo asentado leyendo `original.entries`.

**D-B.2 — `reopen`: el monto se lee de las entries del `closeTransaction` (no del helper de saldo vivo).**

Tras un cierre, el GL de la caja quedó en 0 (la liquidación lo barrió). El "monto involucrado"
de la reapertura es lo que se va a revertir = lo asentado en el cierre, no el saldo actual.
Por eso `reopen` usa `getCajaReopenMagnitude` (lee entries del closeTransaction), NO
`getCajaGlBalance`. Si `closeTransactionId` es null o el cierre ya está VOIDED, la magnitud
es 0 → nunca exige step-up (no hay reversa GL que proteger). Esto degrada con gracia y es
consistente con ADR-038 A.6.

**D-B.3 — Doble cómputo del monto (action + service): ACEPTABLE. CONFIRMADO.**

El monto se calcula dos veces: una en la action (lectura, fuera de transacción, para el gate
de step-up) y otra dentro del service en su `$transaction` Serializable (fuente de verdad
transaccional). Es aceptable porque:

- La lectura de la action es **read-only**, idempotente y barata (un aggregate / una suma de
  entries). No muta nada (no rompe R-6 ni Z-1).
- El service SIGUE siendo la única fuente de verdad transaccional: el asiento se calcula y
  postea dentro del Serializable. Si entre la lectura de la action y la del service el saldo
  cambiara (concurrencia), el peor caso es que el gate de step-up haya decidido con un valor
  marginalmente distinto. **Esto NO compromete la integridad contable** — solo la decisión
  de fricción 2FA, que es un control de proceso, no un invariante de libros.
- Compartir el helper (D-B.1) garantiza que ambos cómputos usan exactamente la misma fórmula.

---

### D-C — Orden de guards en la action

Replicando el orden canónico de `closeFiscalYearAction` (parse → auth/has → step-up →
rateLimit → role), adaptado a que en Caja Chica el rol+rate-limit viven juntos en
`guardAdmin` y el step-up es CONDICIONAL al monto:

**Orden definido para `closeCajaCajaAction` / `reopenCajaCajaAction`:**

```
1. parse (Zod safeParse)                         → input válido
2. guardAdmin(companyId)                          → auth + rate-limit + rol ADMIN (ADR-006 D-1)
3. pre-cálculo del monto (helper de LECTURA)      → getCajaGlBalance / getCajaReopenMagnitude
4. si monto > THRESHOLD:                           → gate condicional de step-up
       const { has } = await auth();
       if (!has({ reverification: STEP_UP_CONFIG }))
           return reverificationError(STEP_UP_CONFIG);
5. service (closeCajaCaja / reopenCajaCaja)        → $transaction Serializable (fuente de verdad)
```

Justificación del orden:

- **guardAdmin ANTES del pre-cálculo:** no se ejecuta ninguna lectura de saldo para un
  usuario sin rol ni autenticación, y el rate-limit se aplica primero (no se gasta cómputo
  ni se filtra existencia de la caja a no-miembros — ADR-004).
- **pre-cálculo ANTES del gate de step-up:** la condicionalidad EXIGE conocer el monto antes
  de decidir. Es la diferencia estructural con fiscal-close (que no calcula nada: siempre
  exige). El pre-cálculo es read-only (no rompe R-6 / Z-1).
- **step-up DESPUÉS del rol:** un usuario sin rol nunca llega a ver el prompt 2FA. El
  step-up es la última barrera antes del trabajo transaccional, igual que en fiscal-close.
- **service AL FINAL:** sin cambios. Sigue recalculando el monto y posteando dentro de su
  Serializable. El gate de la action no sustituye ninguna validación del service.

**Tipo de retorno:** ambas actions pasan de `Promise<ActionResult<void>>` a
`Promise<ActionResult<void> | StepUpError>` (igual que las protegidas en Q2-3).

**Cliente:** envolver con `const fn = useReverification(closeCajaCajaAction)` (NO array
destructuring — @clerk/shared@4.12.2, ver CLAUDE.md quick-ref) + try/catch con
`isReverificationCancelledError`. El flujo de bajo monto no dispara prompt (la action no
retorna `clerk_error`), así que el envoltorio es transparente.

---

## 3. Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Umbral configurable en `CompanySettings` | Migración + UI + el propio umbral es editable = vector de evasión del control. Sobre-ingeniería para v1 (YAGNI). Migrable después de forma aditiva. |
| Umbral en USD vía tasa BCV (D-A.2 opción b) | Acopla un control de seguridad a `exchange-rates`; no-determinista; frágil ante fallo de tasa. Reconsiderar con ADR propio si la inflación lo obliga. |
| Step-up SIEMPRE (como fiscal-close) | Penaliza la operación cotidiana de bajo monto; contradice la recomendación F-17 (condicional). |
| Calcular el monto solo dentro del service | El gate de step-up debe decidirse en la action ANTES del `$transaction`; el service no puede pedir step-up a mitad de transacción. |
| Reusar `getCajaGlBalance` en reopen | Tras el cierre el GL está en 0; el monto a proteger es lo asentado en el cierre, no el saldo vivo. Por eso helper separado (D-B.2). |

---

## 4. Consecuencias

**Positivas**
- Fricción 2FA proporcional al riesgo: solo cierres/reaperturas de monto material.
- Cero migración, cero schema, cero superficie de ataque nueva.
- Fórmula del monto compartida entre action y service (helper único) → sin drift.
- Patrón Q2-3 extendido limpiamente a un caso condicional, reutilizable para futuros gates por umbral.

**Negativas / deuda conocida**
- El umbral VES se erosiona con inflación → requiere revisión manual periódica (D-A.2).
  Mitigación: comentario explícito + valor en un solo lugar.
- Doble cómputo del monto (aceptado, D-B.3): coste despreciable (una lectura extra).
- `step-up.ts` adquiere una constante de dominio (Caja Chica). Aceptable: es el hogar
  natural de la política de step-up de la plataforma.

**Invariantes verificados**
- R-1: el pre-cálculo no crea asientos; el GL lo sigue posteando el service balanceado.
- R-3: sin cambios al manejo de períodos (el service ya postea en período OPEN).
- R-5: comparación con Decimal.js; `CAJA_CHICA_STEP_UP_THRESHOLD_VES` nunca `number`.
- R-6: el pre-cálculo es read-only; IP/UA en AuditLog siguen escribiéndose en el service.
- Z-1: el pre-cálculo no toca correlativos; el Serializable del service no cambia.
- ADR-004: ambos helpers de lectura filtran por `companyId`.
- ADR-006 D-1: `guardAdmin` (rol ADMIN) sigue siendo el primer control; el step-up se suma, no lo reemplaza.

---

## 5. Checklist de implementación (para la rama `feat/cajachica-stepup-umbral`)

```
[ ] step-up.ts: agregar CAJA_CHICA_STEP_UP_THRESHOLD_VES (D-A.1) + comentario inflación (D-A.2)
[ ] CajaCajaService: extraer getCajaGlBalance (refactor de líneas 276-286, client opcional tx|prisma)
[ ] CajaCajaService: closeCajaCaja usa getCajaGlBalance (sin cambiar comportamiento ni isolation)
[ ] CajaCajaService: agregar getCajaReopenMagnitude (lee entries del closeTransaction, 0 si null/VOIDED)
[ ] closeCajaCajaAction: orden D-C (parse → guardAdmin → getCajaGlBalance → gate step-up → service)
[ ] reopenCajaCajaAction: orden D-C (parse → guardAdmin → getCajaReopenMagnitude → gate step-up → service)
[ ] Tipo de retorno: ActionResult<void> | StepUpError en ambas actions
[ ] Cliente: useReverification(action) SIN array destructuring + isReverificationCancelledError
[ ] Tests: monto > umbral con has:()=>false → reverificationError; monto > umbral con has:()=>true → success
[ ] Tests: monto ≤ umbral → success sin importar step-up (no se llama a has para el gate)
[ ] Tests: reopen sin closeTransactionId / cierre VOIDED → magnitud 0 → nunca step-up
[ ] Tests: 'clerk_error' in result → throw antes de expect(result.success) (patrón Q2-3)
[ ] tsc --noEmit = 0 | vitest run = 0 fallos
```

## Riesgo residual aceptado (gate security-agent N-2)

**Ventana TOCTOU:** el monto se calcula dos veces con la misma fórmula (`sumPostedGlBalance`): una en la action para el gate de step-up (read, sin tx) y otra dentro del `$transaction` Serializable del service (fuente de verdad). Entre ambas, un movimiento concurrente podría elevar el saldo real por encima del umbral después de que el gate leyó un valor ≤ umbral, dejando pasar un cierre/reapertura grande sin 2FA.

**Aceptado como riesgo bajo:** el step-up es un control de FRICCIÓN/anti-abuso de sesión, NO un invariante contable. Los invariantes reales (partida doble, período OPEN, correlativo Serializable, no-cierre-con-movimientos-activos, aislamiento companyId) siguen blindados en el service. Explotarlo exige ya ser ADMIN autenticado y ganar una carrera estrecha; no otorga acceso cross-tenant ni corrompe el GL. No se mitiga (mover el cálculo dentro del tx no ayuda: el prompt 2FA es client-side, previo a la action). Documentado para que una auditoría futura no lo reabra como hallazgo.
