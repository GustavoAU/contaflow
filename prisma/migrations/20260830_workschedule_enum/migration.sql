-- WorkSchedule: crear el tipo enum que schema.prisma declara y la BD no tenía.
--
-- Defecto: `PayrollConfig.workSchedule` está declarado como `WorkSchedule` (enum)
-- desde que se añadió la jornada laboral, pero en la base de datos la columna se
-- creó como TEXT y el tipo enum nunca llegó a existir. Prisma genera un cast a
-- `"public"."WorkSchedule"` en cada escritura, y Postgres responde:
--
--   type "public.WorkSchedule" does not exist
--
-- Consecuencia: GUARDAR LA CONFIGURACIÓN DE NÓMINA estaba roto por completo.
-- Nadie lo noto porque la config no se volvió a tocar desde mayo, y la lectura
-- funciona igual —leer un TEXT no necesita el tipo—. Sólo revienta al escribir.
--
-- No lo detecta ninguna verificación existente: `verify:drift` sólo compara
-- índices únicos, no tipos de columna. Es una clase de deriva que hoy nada mira.
--
-- Datos verificados antes de convertir: las 2 filas existentes tienen
-- 'LUNES_VIERNES', que es miembro válido del enum. La conversión no puede fallar
-- por datos, y si en otro entorno hubiera un valor ajeno el USING lo delataría
-- en vez de corromperlo en silencio.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkSchedule') THEN
    CREATE TYPE "WorkSchedule" AS ENUM ('LUNES_VIERNES', 'LUNES_SABADO', 'LUNES_SABADO_MEDIO');
  END IF;
END $$;

-- El DEFAULT se retira antes de cambiar el tipo: Postgres no puede castear un
-- default de texto a un tipo que aún no aplica a la columna.
ALTER TABLE "PayrollConfig" ALTER COLUMN "workSchedule" DROP DEFAULT;

ALTER TABLE "PayrollConfig"
  ALTER COLUMN "workSchedule" TYPE "WorkSchedule"
  USING "workSchedule"::text::"WorkSchedule";

ALTER TABLE "PayrollConfig"
  ALTER COLUMN "workSchedule" SET DEFAULT 'LUNES_VIERNES'::"WorkSchedule";
