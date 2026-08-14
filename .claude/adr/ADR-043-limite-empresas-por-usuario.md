# ADR-043 — Enforcement del límite de empresas por usuario

**Fecha:** 2026-08-13
**Estado:** Aceptado
**Origen:** MEDIUM-3, auditoría de seguridad MP-4
**Contexto previo:** ADR-001 (Serializable), ADR-034 D-7 (TOCTOU aceptado), ADR-041 (guard central), ADR-042 D-13

## Contexto

`createCompanyAction` contaba las empresas propias con `prisma.companyMember.count`
FUERA de la transacción que las crea (`CompanyService.createCompany` abría la suya).
Dos POST simultáneos leen 0 y ambos crean: dos empresas con un solo plan pagado. El
`@unique` del RIF no protege porque el RIF es opcional.

MEDIUM-1 (contrato de `createCompany`) y MEDIUM-3 son **el mismo bug**: invariantes
que solo existen en el borde. El país lo validaba el action, el límite lo contaba el
action, y el servicio confiaba. El próximo caller rompía los dos a la vez.

## Decisiones

### D-1 — Serializable, con el guard DENTRO del servicio y DENTRO de la tx

Read Committed no sirve, ni siquiera moviendo el `count` adentro: el invariante es un
predicado sobre filas que todavía no existen (`COUNT` sobre `CompanyMember`), y RC no
tiene predicate locking — el INSERT concurrente es invisible hasta que commitea, así
que ambas transacciones cuentan 0 y ambas insertan. Es **write skew** de manual, y SSI
es exactamente la herramienta.

La regla del proyecto no se viola, se aplica: su vía de escape ("dudas → Read
Committed + `@@unique`") **exige un constraint que exprese el invariante**. Aquí no
existe (D-2), así que la vía de escape no está disponible.

Coste real: nulo. Esta action corre ~una vez por usuario en toda su vida; la única
contención realista es el doble-submit, que es justo lo que queremos abortar.

`COMPANY_LIMIT_PER_USER` y el guard se mudan al servicio. Dejarlos en el action
reproduce exactamente la vulnerabilidad de MEDIUM-1: el próximo caller los salta sin
enterarse. El action se queda solo con el mapeo del error a mensaje de negocio.

Envoltorio: `withSerializableRetry` (timeout 15s / maxWait 5s + reintento P2034). El
perdedor de la carrera reintenta, lee `count = 1` y recibe `PlanLimitError` — el
mensaje de negocio correcto, no un 500.

### D-1-bis — El límite se guarda en las DOS puertas (enmienda de la auditoría pre-merge)

La auditoría de seguridad sobre `3bf34cd` encontró que D-1 **no sostenía el
invariante que enunciaba**. El guard cuenta `company: { status: { not: "ARCHIVED" } }`,
así que el límite se evadía sin ninguna carrera:

```
crear A → archivar A → crear B (count = 0) → reactivar A   →  2 activas, 1 plan
```

Archivar A siempre pasa: una empresa recién creada no tiene `AccountingPeriod`
abierto, que es lo único que bloquea `archiveCompany`. Y el ciclo es repetible → N.

Lo que D-1 garantizaba de verdad era "≤1 activa **en el instante de crear**".
Reactivar es la otra puerta al mismo estado, y ahora también la guarda, con la
misma constante y dentro de su propia tx `Serializable`.

Detalle que importa: se cuenta contra el **OWNER de la empresa que se reactiva**,
no contra el caller — un ADMIN no-propietario también puede reactivar, y contar
sus empresas dejaría el agujero abierto.

> Lección para futuras enmiendas: cuando un invariante se expresa como "count de
> filas en cierto estado", hay que enumerar **todas** las transiciones que entran a
> ese estado, no solo la que motivó el hallazgo.

### D-2 — NO hay `@@unique` ni índice parcial. Nunca lo agregues

En orden de contundencia:

1. **La regla exacta no es expresable.** El invariante excluye empresas ARCHIVED, y
   `status` vive en `Company`. El predicado de un índice parcial de Postgres solo
   puede referenciar columnas de la tabla indexada. Un `UNIQUE(userId) WHERE
   role='OWNER'` sobre `CompanyMember` implementaría una regla **más estricta** que la
   del negocio: rompería el flujo legítimo archivar-A-y-crear-B, que hoy funciona.
   Hacerlo expresable exigiría desnormalizar `Company.status` dentro de
   `CompanyMember` — dos escritores, deriva garantizada, peor que la carrera.
2. **Es política de facturación, no invariante de datos.** El límite varía por plan:
   codificar el 1 en el schema = una migración por cada cambio de plan, y hace
   imposible el límite por plan (un índice no puede leer `Subscription.plan`).
3. **Congelaría el modelo de propiedad.** Hoy se sostendría (OWNER solo se asigna al
   crear — `ASSIGNABLE_ROLES` lo excluye), pero bloquearía por adelantado
   transferencia de propiedad y co-propiedad, y con un P2002 opaco.

**El TOCTOU aceptado en ADR-034 D-7 NO es precedente aplicable**: allí lo respalda
`@@unique([despachoCompanyId, rif])`. Aquí no hay respaldo, así que el TOCTOU es
pérdida de ingreso directa.

> Si alguien vuelve a proponer el índice parcial, la respuesta es "el predicado no
> puede ver `Company.status`" — no "el caso despacho". Un despacho gestiona RIFs vía
> `ManagedClient`; ningún flujo de despacho crea Companies.

### D-3 — `withDbRetry` afuera, `withSerializableRetry` adentro, con caducidad escrita

```ts
withDbRetry(() => withSerializableRetry((tx) => CompanyService.createCompany(tx, {…})))
```

`withDbRetry` reintenta a ciegas una mutación **no idempotente**. Si la transacción
commiteó y se perdió la respuesta, el reintento vuelve a correr, el guard lee
`count = 1` y el usuario recibe `PLAN_LIMIT` — mensaje que con límite 1 es
**factualmente cierto** (ya tiene su empresa; un refresh la muestra). No hay riesgo de
doble creación: el guard dentro de la tx lo impide.

**Condición de caducidad, escrita sobre la constante**: el día que
`COMPANY_LIMIT_PER_USER > 1`, `withDbRetry` sale de este call site o la creación
necesita `idempotencyKey`. Sin esa nota, un cambio de plan reintroduce el bug por la
puerta de atrás.

`seedExpenseCategories` dentro de la tx es un único `createMany` de 9 filas; la tx
queda en ~5 statements, holgada dentro de los 15s.

### D-4 — Actions sin empresa: `requireUserAction` + limiter propio

`limiters.fiscal` queda **PROHIBIDO** en el alta: falla **cerrado** por diseño, y
Upstash free tier ya archivó la BD una vez (incidente 2026-07-26). Un hipo de Redis
bloquearía la primerísima acción de un usuario que acaba de pagar. Además crear una
empresa no es una mutación fiscal.

Limiter `companyCreate`: 5/min, **fail-open**, clave `user:${userId}` con el userId de
Clerk (autoritativo, no spoofeable). **No IP** — el CGNAT móvil venezolano colisiona
usuarios legítimos y la action ya exige sesión. El invariante real no depende del
limiter: lo garantiza el guard Serializable.

El ritual vive en `requireUserAction` (`src/lib/action-guard.ts`), el hueco documentado
de ADR-041. Sin un hogar, el siguiente caso sin `companyId` (onboarding, checkout
pre-empresa) vuelve a copiar el ritual a mano — este proyecto ya pagó esa factura once
veces con la IP spoofeable. **No acepta `roles` a propósito**: no hay membresía que
evaluar, y que el tipo lo impida hace imposible confundirlo con `requireCompanyAction`.

## Consecuencias

- El límite de plan pasa a ser inviolable por concurrencia y por callers nuevos.
- Coste: una tx Serializable en una operación que corre ~una vez por usuario.
- El gate de billing (`$extends`) consulta `Subscription` en **otra conexión**
  mientras la tx Serializable retiene la suya (`ExpenseCategory` no está en
  `EXEMPT_MODELS`). Es **preexistente** y de volumen ínfimo. Se documenta y **NO** se
  amplía `EXEMPT_MODELS`: debilitar el gate para ahorrar un round-trip en una
  operación que corre una vez por usuario es un mal negocio.
