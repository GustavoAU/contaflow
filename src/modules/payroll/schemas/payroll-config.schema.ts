// src/modules/payroll/schemas/payroll-config.schema.ts
// Fase NOM-A: validación Zod para el wizard de configuración de nómina

import { z } from "zod";

export const PayrollConfigSchema = z.object({
  // Paso 1 — Empresa
  sizeRange: z.enum(["SMALL", "MEDIUM", "LARGE"], {
    error: "Selecciona el tamaño de la empresa",
  }),
  lottRegime: z.enum(["POST_2012", "MIXED"], {
    error: "Selecciona el régimen LOTTT aplicable",
  }),
  // Paso 2 — Organismos y Beneficios
  ivssEnabled: z.boolean(),
  incesEnabled: z.boolean(),
  banavihEnabled: z.boolean(),
  rpeEnabled: z.boolean(),
  // Clase de riesgo declarada ante el IVSS. Determina la cotización patronal
  // (LSS Art. 59): mínimo 9% / medio 10% / máximo 11%. No es una preferencia:
  // la fija la actividad económica de la empresa según el Reglamento.
  ivssRiskClass: z.enum(["MINIMO", "MEDIO", "MAXIMO"], {
    error: "Selecciona la clase de riesgo declarada ante el IVSS",
  }).default("MEDIO"),
  // Salario mínimo nacional vigente en Bs (para topes de cotización).
  // Cuando null/vacío: sin tope (empresa no lo ha configurado aún).
  salaryMinimumVes: z.string().optional().nullable(),
  cestaTicketType: z.enum(["CARD", "CASH", "NONE"], {
    error: "Selecciona el tipo de cesta ticket",
  }),
  // Paso 3 — Configuración de Pagos
  paymentCurrency: z.enum(["VES", "USD", "MIXED"], {
    error: "Selecciona la moneda de pago",
  }),
  // SEMANAL faltaba, y el asistente SÍ la ofrece: elegirla hacía que el guardado
  // entero se rechazara por "Datos inválidos", sin decir cuál era el campo.
  frequency: z.enum(["BIWEEKLY", "MONTHLY", "SEMANAL"], {
    error: "Selecciona la frecuencia de pago",
  }),
  fideicomiso: z.enum(["EXTERNAL_BANK", "INTERNAL"], {
    error: "Selecciona la modalidad de fideicomiso",
  }),
  // VAC-1: jornada laboral para cómputo de días hábiles en vacaciones (LOTTT)
  workSchedule: z.enum(["LUNES_VIERNES", "LUNES_SABADO", "LUNES_SABADO_MEDIO"]).default("LUNES_VIERNES"),
  // ── Paso 3 — Cuentas contables ─────────────────────────────────────────────
  //
  // ESTAS DIECISÉIS TIENEN QUE ESTAR TODAS. Zod descarta en silencio las claves
  // que no declara, así que un campo ausente aquí NO da error: el asistente lo
  // envía, `.parse()` lo tira, y el usuario ve "Guardado" mientras su cambio
  // desaparece. Faltaban once —incluidos los cuatro aportes patronales y el
  // FAOV obrero— y por eso eran IMPOSIBLES de configurar desde la aplicación,
  // aunque el servicio y la base de datos sí los soportan.
  //
  // Si se añade una cuenta nueva a `PayrollConfig`, hay que añadirla también
  // aquí. El test payroll-config.schema.test.ts compara ambas listas para que
  // la próxima omisión no vuelva a ser silenciosa.

  // Nómina (sueldos)
  expenseAccountId: z.string().optional().nullable(),
  payableAccountId: z.string().optional().nullable(),
  ivssPayableAccountId: z.string().optional().nullable(),
  incesPayableAccountId: z.string().optional().nullable(),
  faovPayableAccountId: z.string().optional().nullable(),
  rpePayableAccountId: z.string().optional().nullable(),

  // Aportes patronales
  ivssPatronalAccountId: z.string().optional().nullable(),
  incesPatronalAccountId: z.string().optional().nullable(),
  faovPatronalAccountId: z.string().optional().nullable(),
  rpePatronalAccountId: z.string().optional().nullable(),

  // Beneficios legales (NOM-D)
  benefitsExpenseAccountId: z.string().optional().nullable(),
  benefitsPayableAccountId: z.string().optional().nullable(),
  vacationPayableAccountId: z.string().optional().nullable(),
  profitSharingPayableAccountId: z.string().optional().nullable(),

  // Préstamos a empleados
  loanReceivableAccountId: z.string().optional().nullable(),
  disbursementBankAccountId: z.string().optional().nullable(),
});

export type PayrollConfigInput = z.infer<typeof PayrollConfigSchema>;
