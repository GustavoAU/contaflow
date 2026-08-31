// src/modules/payroll/__tests__/payroll-gl-accounts.test.ts

import { describe, it, expect } from "vitest";
import { detectAccountConflict } from "../utils/payroll-gl-accounts";

describe("detectAccountConflict", () => {
  it("PERMITE que obrero y patronal del MISMO organismo compartan cuenta", () => {
    // Se enteran en la misma planilla: una sola "IVSS por Pagar" es practica
    // corriente. Exigirlas separadas obligaba a inventar cuentas que el plan no
    // tiene, y empujaba a reutilizar la de OTRO organismo por no quedar otra.
    expect(detectAccountConflict({
      ivssPayableAccountId: "acc-ivss",
      ivssPatronalAccountId: "acc-ivss",
    })).toBeNull();
  });

  it("PERMITE compartir en los cuatro organismos a la vez", () => {
    expect(detectAccountConflict({
      ivssPayableAccountId: "a", ivssPatronalAccountId: "a",
      incesPayableAccountId: "b", incesPatronalAccountId: "b",
      faovPayableAccountId: "c", faovPatronalAccountId: "c",
      rpePayableAccountId: "d", rpePatronalAccountId: "d",
    })).toBeNull();
  });

  it("RECHAZA mezclar ACREEDORES distintos: IVSS y Banavih cobran por separado", () => {
    // El caso real que disparo esto: sin cuenta FAOV en el plan, se reutilizo la
    // del IVSS y quedaba imposible cuadrar lo que se le debe a cada instituto.
    const err = detectAccountConflict({
      ivssPayableAccountId: "acc-ivss",
      faovPayableAccountId: "acc-ivss",
    });
    expect(err).toContain("IVSS Obrero");
    expect(err).toContain("FAOV Obrero");
  });

  it("RECHAZA que el patronal de un organismo caiga en la cuenta de otro", () => {
    expect(detectAccountConflict({
      ivssPatronalAccountId: "acc-x",
      incesPatronalAccountId: "acc-x",
    })).not.toBeNull();
  });

  it("RECHAZA mezclar el gasto con el pasivo", () => {
    expect(detectAccountConflict({
      expenseAccountId: "acc-1",
      payableAccountId: "acc-1",
    })).not.toBeNull();
  });

  it("RECHAZA vacaciones y utilidades en la misma cuenta", () => {
    // Son dos pasivos laborales distintos; compartirlos impide saber cuanto se
    // debe de cada uno.
    expect(detectAccountConflict({
      vacationPayableAccountId: "acc-1",
      profitSharingPayableAccountId: "acc-1",
    })).not.toBeNull();
  });

  it("ignora los campos sin asignar: vacio no choca con vacio", () => {
    expect(detectAccountConflict({})).toBeNull();
    expect(detectAccountConflict({
      ivssPayableAccountId: "", faovPayableAccountId: "",
      incesPayableAccountId: undefined,
    })).toBeNull();
  });

  it("una asignacion completa y correcta no produce conflicto", () => {
    expect(detectAccountConflict({
      expenseAccountId: "5105", payableAccountId: "2210",
      ivssPayableAccountId: "2215", ivssPatronalAccountId: "2215",
      incesPayableAccountId: "2220", incesPatronalAccountId: "2220",
      faovPayableAccountId: "2245", faovPatronalAccountId: "2245",
      rpePayableAccountId: "2250", rpePatronalAccountId: "2250",
      benefitsExpenseAccountId: "5107", benefitsPayableAccountId: "2230",
      vacationPayableAccountId: "2225", profitSharingPayableAccountId: "2240",
      loanReceivableAccountId: "1315", disbursementBankAccountId: "1110",
    })).toBeNull();
  });
});
