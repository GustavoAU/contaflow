// src/modules/payroll/__tests__/salary-vigencia.test.ts
//
// La regla que la pantalla y el cálculo tienen que compartir. El caso que
// motiva el archivo es el último describe: un aumento con vigencia DENTRO del
// período, que es donde las dos reglas dejaban de coincidir.

import { describe, it, expect } from "vitest";
import { salaryCurrencyAt, type SalaryVigencia } from "../utils/salary-vigencia";

// Ordenadas de la más reciente a la más antigua, como las devuelve la página.
const jose: SalaryVigencia[] = [
  { from: "2026-08-20", currency: "USD" },
  { from: "2026-01-01", currency: "VES" },
];

describe("salaryCurrencyAt", () => {
  it("toma la vigencia más reciente que ya empezó", () => {
    expect(salaryCurrencyAt(jose, "2026-09-01")).toBe("USD");
  });

  it("ignora las vigencias futuras", () => {
    expect(salaryCurrencyAt(jose, "2026-08-19")).toBe("VES");
  });

  it("incluye el propio día de entrada en vigencia", () => {
    expect(salaryCurrencyAt(jose, "2026-08-20")).toBe("USD");
  });

  it("devuelve null si en esa fecha no había sueldo registrado", () => {
    expect(salaryCurrencyAt(jose, "2025-12-31")).toBeNull();
  });

  it("devuelve null sin vigencias", () => {
    expect(salaryCurrencyAt([], "2026-08-16")).toBeNull();
  });

  it("no confunde el orden al comparar meses de un dígito", () => {
    // La comparación es de texto: "2026-09-01" > "2026-10-01" sería el error
    // clásico si las fechas no vinieran con cero a la izquierda.
    const v: SalaryVigencia[] = [
      { from: "2026-10-01", currency: "USD" },
      { from: "2026-09-01", currency: "VES" },
    ];
    expect(salaryCurrencyAt(v, "2026-09-15")).toBe("VES");
    expect(salaryCurrencyAt(v, "2026-10-15")).toBe("USD");
  });
});

describe("salaryCurrencyAt — aumento dentro del período", () => {
  // El bug real: nómina del 16 al 31 de agosto de 2026, José pasa de VES a USD
  // el día 20. El formulario lo listaba en USD (última vigencia) y el servicio
  // lo calculaba en VES (vigencia al inicio), así que la nómina se rechazaba
  // por "monedas mixtas" con TODOS los demás en USD y sin señalar a nadie.
  const PERIODO_INICIO = "2026-08-16";

  it("rige la moneda vigente al INICIO del período, no la última registrada", () => {
    expect(salaryCurrencyAt(jose, PERIODO_INICIO)).toBe("VES");
  });

  it("una empresa en USD con un aumento a mitad de período se ve mixta, y eso es lo correcto", () => {
    const plantilla = [
      { id: "1", salaries: [{ from: "2026-01-01", currency: "USD" as const }] },
      { id: "2", salaries: jose },
    ];
    const monedas = new Set(
      plantilla.map((e) => salaryCurrencyAt(e.salaries, PERIODO_INICIO)),
    );
    expect([...monedas].sort()).toEqual(["USD", "VES"]);
  });
});
