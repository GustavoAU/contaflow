// src/modules/payroll/__tests__/payroll-config.schema.test.ts
//
// Zod DESCARTA en silencio las claves que no declara. Un campo ausente del
// schema no da error: el asistente lo envia, `.parse()` lo tira, y el usuario ve
// "Guardado" mientras su cambio desaparece.
//
// Eso paso de verdad: faltaban ONCE cuentas —los cuatro aportes patronales, el
// FAOV obrero, el gasto de sueldos…— y eran IMPOSIBLES de configurar desde la
// aplicacion, aunque el servicio y la base de datos si las soportan. Nadie lo
// vio porque no hay error que ver.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PayrollConfigSchema } from "../schemas/payroll-config.schema";

/** Campos `*AccountId` que el modelo PayrollConfig declara en schema.prisma. */
function cuentasDelModelo(): string[] {
  const schema = readFileSync("prisma/schema.prisma", "utf8").replace(/\r\n/g, "\n");
  const m = /^model PayrollConfig \{([\s\S]*?)^\}/m.exec(schema);
  if (!m) throw new Error("modelo PayrollConfig no encontrado");
  return [...m[1].matchAll(/^\s{2}(\w*AccountId)\s/gm)].map((x) => x[1]).sort();
}

describe("PayrollConfigSchema — cobertura de campos", () => {
  it("declara TODAS las cuentas del modelo: una omision aqui se traga el dato", () => {
    const enModelo = cuentasDelModelo();
    const enSchema = Object.keys(PayrollConfigSchema.shape)
      .filter((k) => k.endsWith("AccountId"))
      .sort();

    // Se compara la lista entera, no el conteo: asi el fallo dice QUE campo falta.
    expect(enSchema).toEqual(enModelo);
  });

  it("acepta las cuentas patronales, que es lo que se perdia", () => {
    const r = PayrollConfigSchema.safeParse({
      sizeRange: "SMALL", lottRegime: "POST_2012",
      ivssEnabled: true, incesEnabled: true, banavihEnabled: true, rpeEnabled: true,
      cestaTicketType: "CARD", paymentCurrency: "USD", frequency: "BIWEEKLY",
      fideicomiso: "INTERNAL",
      ivssPatronalAccountId: "acc-1",
      incesPatronalAccountId: "acc-2",
      faovPatronalAccountId: "acc-3",
      rpePatronalAccountId: "acc-4",
      faovPayableAccountId: "acc-5",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.ivssPatronalAccountId).toBe("acc-1");
      expect(r.data.incesPatronalAccountId).toBe("acc-2");
      expect(r.data.faovPatronalAccountId).toBe("acc-3");
      expect(r.data.rpePatronalAccountId).toBe("acc-4");
      expect(r.data.faovPayableAccountId).toBe("acc-5");
    }
  });

  it("acepta las tres frecuencias que el asistente ofrece", () => {
    // SEMANAL faltaba: elegirla rechazaba el guardado ENTERO con "Datos
    // invalidos", sin decir cual era el campo.
    const base = {
      sizeRange: "SMALL", lottRegime: "POST_2012",
      ivssEnabled: true, incesEnabled: true, banavihEnabled: true, rpeEnabled: true,
      cestaTicketType: "CARD", paymentCurrency: "VES", fideicomiso: "INTERNAL",
    };
    for (const frequency of ["BIWEEKLY", "MONTHLY", "SEMANAL"]) {
      expect(PayrollConfigSchema.safeParse({ ...base, frequency }).success).toBe(true);
    }
  });

  it("las frecuencias del schema son EXACTAMENTE las del enum de Prisma", () => {
    const prisma = readFileSync("prisma/schema.prisma", "utf8").replace(/\r\n/g, "\n");
    const m = /^enum PayrollFrequency \{([\s\S]*?)^\}/m.exec(prisma);
    const delEnum = [...m![1].matchAll(/^\s{2}(\w+)/gm)].map((x) => x[1]).sort();

    const base = {
      sizeRange: "SMALL", lottRegime: "POST_2012",
      ivssEnabled: true, incesEnabled: true, banavihEnabled: true, rpeEnabled: true,
      cestaTicketType: "CARD", paymentCurrency: "VES", fideicomiso: "INTERNAL",
    };
    const aceptadas = delEnum.filter(
      (f) => PayrollConfigSchema.safeParse({ ...base, frequency: f }).success,
    );
    expect(aceptadas).toEqual(delEnum);
  });
});
