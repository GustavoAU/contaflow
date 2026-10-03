# ADR-057 — El historial de migraciones debe poder repetirse desde cero

- **Estado:** Aceptado (2026-10-03)
- **Contexto:** SPEC-002 (job de integración contra Neon en CI)

## Contexto
Las migraciones de producción se aplican con el flujo manual de `CLAUDE.md` (`db execute` +
`migrate resolve --applied`), porque `migrate dev` está roto. Con ese flujo nadie necesitaba
que `prisma/migrations/` se pudiera **repetir desde una base vacía**. El job de integración
del CI lo exige: cada corrida clona un branch vacío de Neon (`contaflow-ci`) y aplica las
migraciones con `prisma migrate deploy`.

La primera corrida real (2026-10-03) reveló que de 164 migraciones, **2 no se podían repetir**
(medido reproduciendo todo el historial en una rama desechable, sin parar en el primer fallo):

| Migración | Fallo | Causa |
|---|---|---|
| `20260507_item72_legal_thresholds` | `42710 type "LegalThresholdType" already exists` | Duplicado exacto de `20260428_legal_threshold` (mismo enum, tabla, índices y FK; solo cambiaba el espaciado) |
| `20260511_contra_asset` | `55P04 unsafe use of new value "CONTRA_ASSET"` | `ALTER TYPE ... ADD VALUE` y un `UPDATE` que usa el valor nuevo en el mismo archivo; Prisma ejecuta cada archivo como una transacción y Postgres no permite usar un valor de enum añadido en la misma |

## Decisión
1. `20260507_item72_legal_thresholds` queda como no-op (`SELECT 1;`) con un comentario que explica por qué. Su efecto ya lo produce `20260428_legal_threshold`.
2. El `UPDATE` de `20260511_contra_asset` se mueve a una migración nueva, `20260511_contra_asset_backfill`, que corre en su propia transacción (ordena justo después por nombre). Es idempotente: en producción no encuentra filas con `type = 'ASSET'`.
3. **Regla nueva:** el job `integration` del CI aplica TODAS las migraciones desde cero en cada PR. Una migración que no se pueda repetir rompe el CI en el PR que la introduce. Un `ADD VALUE` de enum y cualquier uso de ese valor van siempre en migraciones separadas.

## Consecuencias
- **Checksums:** se modifican 2 migraciones ya aplicadas en producción, así que su checksum en `_prisma_migrations` deja de coincidir con el archivo. El flujo manual no lo verifica (`resolve --applied` recalcula al insertar y `migrate dev` ya está roto). No cambia el esquema resultante de producción.
- **Migración nueva pendiente en producción:** `20260511_contra_asset_backfill`. Su `UPDATE` es idempotente; basta aplicarla con el flujo manual (`db execute` + `resolve --applied`). **No se aplicó a ninguna base de producción como parte de este cambio.**
- **Verificación:** las 165 migraciones se aplicaron desde una base vacía sin errores (0 fallidas); el esquema resultante tiene 94 tablas, igual que los 94 modelos de `schema.prisma`, y el rol `authenticated` se crea por la propia migración `20260406110000`.

## Alternativas descartadas
- Manejar las 2 excepciones solo en el CI con `migrate resolve`: deja el historial sin poder repetirse y el CI arrastra casos especiales.
