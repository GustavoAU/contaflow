// src/modules/payroll/schemas/overtime.schema.ts
// LOTTT Art. 183 — registro de horas extraordinarias.

import { z } from "zod";
import { zBusinessDateString } from "@/lib/zod-helpers";

// Art. 178: "no podrán exceder de diez horas semanales". Una jornada extra de un
// solo día por encima de diez horas no es representable, así que el campo se
// acota ahí: pasarse del tope semanal se avisa al calcular (no se bloquea), pero
// un número imposible se rechaza en la entrada.
const MAX_HOURS_PER_ENTRY = 10;

export const CreateOvertimeEntrySchema = z.object({
  employeeId: z.string().min(1, { error: "Selecciona el trabajador" }),
  // La cota de "no futuro" NO va aquí: comparar contra `new Date()` mide
  // medianoche UTC del día declarado contra el instante actual, y de 20:00 a
  // 24:00 en Venezuela eso deja pasar MAÑANA. El schema no conoce el huso del
  // país, así que la comprobación vive en OvertimeService con todayInTimeZone().
  workedOn: zBusinessDateString,
  hours: z
    .number({ error: "Indica cuántas horas se laboraron" })
    // `.positive()` admitía 0,004, que la columna DECIMAL(6,2) guarda como 0,00:
    // una fila del registro legal con cero horas.
    .min(0.01, { error: "Las horas deben ser mayores que cero" })
    .max(MAX_HOURS_PER_ENTRY, {
      error: `Máximo ${MAX_HOURS_PER_ENTRY} horas por registro (LOTTT Art. 178)`,
    }),
  kind: z.enum(["DIURNA", "NOCTURNA"], {
    error: "Indica si la jornada extraordinaria fue diurna o nocturna",
  }),
  // Art. 183: el registro debe anotar "los trabajos efectuados en esas horas".
  // No es decorativo: sin registro conforme a la Ley se presumen ciertos los
  // alegatos del trabajador, así que un campo vacío no cumple.
  workPerformed: z
    .string()
    .trim()
    .min(5, { error: "Describe el trabajo efectuado (LOTTT Art. 183)" })
    .max(500),
  // Art. 182: permiso previo de la Inspectoría del Trabajo.
  authorized: z.boolean().default(false),
  authorizationRef: z.string().trim().max(120).optional().nullable(),

  })
  .refine(
    // Declarar que hubo permiso baja el pago un 33% frente a no tenerlo
    // (Art. 182). Si se afirma, que quede el dato verificable: el N° del permiso
    // o el de la notificación del caso imprevisto y urgente.
    (d) => !d.authorized || !!d.authorizationRef?.trim(),
    {
      error:
        "Indica el N° del permiso de la Inspectoría (o el de la notificación, " +
        "si fue un caso imprevisto y urgente)",
      path: ["authorizationRef"],
    },
  );

export type CreateOvertimeEntryInput = z.infer<typeof CreateOvertimeEntrySchema>;
