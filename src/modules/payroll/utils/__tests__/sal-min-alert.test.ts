// src/modules/payroll/utils/__tests__/sal-min-alert.test.ts
//
// Bug encontrado en vivo (2026-09-05): la alerta original medía SOLO
// antigüedad, así que un valor correcto (Bs. 130, congelado desde 2022)
// disparaba "desactualizado" todos los días. Estos tests fijan el contrato
// correcto: el VALOR manda sobre la antigüedad.
import { describe, it, expect } from "vitest";
import { computeSalMinAlert } from "../sal-min-alert";
import { SALARY_MIN_VES_REFERENCE } from "../../legal-thresholds-reference";

const REF = SALARY_MIN_VES_REFERENCE.toString();
const NOW = new Date("2026-09-05T00:00:00.000Z").getTime();
const RECIENTE = new Date(NOW - 5 * 24 * 60 * 60 * 1000).toISOString(); // hace 5 días
const VIEJO_2022 = "2022-03-01T00:00:00.000Z"; // años de antigüedad

describe("computeSalMinAlert", () => {
  it("sin registro → aviso con título 'sin registrar'", () => {
    const r = computeSalMinAlert(null, null, NOW);
    expect(r.tieneAviso).toBe(true);
    expect(r.titulo).toBe("Salario mínimo sin registrar");
  });

  it("valor CORRECTO pero decretado hace años → aviso SUAVE de reconfirmar, no 'incorrectas' (el bug que se corrigió)", () => {
    // Antes: título "desactualizado — bases de cotización incorrectas" (error),
    // por la sola antigüedad de un valor que en realidad sigue vigente.
    const r = computeSalMinAlert(REF, VIEJO_2022, NOW);
    expect(r.tieneAviso).toBe(true);
    expect(r.titulo).toBe("Confirma que el salario mínimo sigue vigente");
    expect(r.titulo).not.toMatch(/no coincide|incorrectas/);
  });

  it("valor correcto y confirmado recientemente → sin aviso", () => {
    const r = computeSalMinAlert(REF, RECIENTE, NOW);
    expect(r.tieneAviso).toBe(false);
  });

  it("valor correcto pero sin reconfirmar en 30+ días → aviso suave, no 'no coincide'", () => {
    // Reconfirmado hace 40 días: el valor sigue coincidiendo con la referencia,
    // pero ya pasaron los 30 días de la ventana de reconfirmación.
    const hace40dias = new Date(NOW - 40 * 24 * 60 * 60 * 1000).toISOString();
    const r = computeSalMinAlert(REF, hace40dias, NOW);
    expect(r.tieneAviso).toBe(true);
    expect(r.titulo).toBe("Confirma que el salario mínimo sigue vigente");
  });

  it("valor que NO coincide con la referencia → error, manda sobre la antigüedad", () => {
    // Confirmado AYER (recentísimo) pero con un valor distinto al vigente.
    const r = computeSalMinAlert("999.00", RECIENTE, NOW);
    expect(r.tieneAviso).toBe(true);
    expect(r.titulo).toBe("El salario mínimo registrado no coincide con el vigente");
  });

  it("mensaje de 'no coincide' incluye el valor de referencia", () => {
    const r = computeSalMinAlert("999.00", RECIENTE, NOW);
    expect(r.mensaje).toContain(SALARY_MIN_VES_REFERENCE.toFixed(2));
  });
});
