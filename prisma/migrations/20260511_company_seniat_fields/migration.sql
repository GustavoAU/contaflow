-- Campos SENIAT obligatorios para reportes PA-121 (Forma 30, Libro Mayor, cabeceras fiscales)
-- telefono, email, ciiu, actividad — requeridos en Sección A de la Forma 30 SENIAT

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "telefono"  TEXT,
  ADD COLUMN IF NOT EXISTS "email"     TEXT,
  ADD COLUMN IF NOT EXISTS "ciiu"      TEXT,
  ADD COLUMN IF NOT EXISTS "actividad" TEXT;
