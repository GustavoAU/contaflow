-- MEDIUM-1 (auditoría ADR-040): índice único parcial para el guard "1 solicitud de
-- cambio de plan activa por suscripción". Prisma no modela partial unique indexes, así que
-- va como migración manual (patrón ya usado en el proyecto para unicidad condicional).
--
-- Con esto, dos requestPlanChange concurrentes sobre la misma suscripción NO pueden crear
-- dos filas activas a la vez: el segundo INSERT viola el índice → P2002 → el service lo
-- traduce a "Ya tienes un cambio de plan pendiente." El pre-check en la app es solo UX.

CREATE UNIQUE INDEX IF NOT EXISTS "plan_change_one_active"
  ON "plan_change_requests" ("subscriptionId")
  WHERE "status" IN ('PENDING_PAYMENT', 'CONFIRMED', 'APPLYING');
