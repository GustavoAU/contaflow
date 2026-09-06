// src/modules/payroll/salary-minimum-reference.ts
//
// Separado de legal-thresholds-reference.ts (bug encontrado en vivo,
// 2026-09-06): ese archivo importa constantes de PayrollCalculatorService,
// que arrastra transitivamente el singleton de Prisma (@/lib/prisma →
// prisma-tenant-assert.ts → node:async_hooks). Mientras sólo lo consumían
// Server Components/servicios eso no importaba, pero utils/sal-min-alert.ts
// lo necesita también desde componentes "use client" (PayrollRunForm,
// LegalThresholdsPanel) — y webpack no puede empaquetar `node:async_hooks`
// para el navegador: "UnhandledSchemeError", build roto, página en 500.
//
// Este archivo no importa NADA del servidor a propósito: sólo Decimal. Es la
// única fuente segura para el navegador. `legal-thresholds-reference.ts`
// re-exporta este valor para no romper a sus importadores existentes
// (PendingTasksService y otros, todos server-side).
import Decimal from "decimal.js";

/**
 * Bs./mes. Decreto 4.653 (G.O. 42.339 Extraordinario, 01-03-2022). Congelado
 * desde entonces: los aumentos posteriores (Cestaticket, Bono contra la Guerra
 * Económica — Decreto 4.805, G.O. 6.746 Extraordinario) son bonos SIN
 * incidencia salarial y no mueven este valor, aunque el "ingreso mínimo
 * integral" resultante sea mucho mayor. Confundir el bono con el salario
 * mínimo hace que los topes de IVSS/FAOV/INCES/RPE se calculen sobre una base
 * que la ley no reconoce.
 *
 * Última verificación de vigencia: 2026-09 (fuentes fechadas ese mismo mes
 * coinciden en que sigue congelado).
 */
export const SALARY_MIN_VES_REFERENCE = new Decimal("130.00");
