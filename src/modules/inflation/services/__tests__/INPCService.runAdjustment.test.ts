// src/modules/inflation/services/__tests__/INPCService.runAdjustment.test.ts
//
// INPCService.runAdjustment no tenía test directo (la suite de actions mockea
// el servicio entero). Se agrega uno enfocado: el guard de cuentas ajenas
// (hallazgo MEDIUM del security-agent, 2026-09-05) corre ANTES de cualquier
// otra consulta, así que un tx mínimo basta para probar el rechazo.

import { describe, it, expect, vi } from "vitest";
import { INPCService } from "../INPCService";

describe("INPCService.runAdjustment — guard de cuenta ajena", () => {
  it("RECHAZA si adjustmentAccountId o repomoAccountId no pertenecen a esta empresa", async () => {
    const tx = { account: { findMany: vi.fn().mockResolvedValue([]) } };

    await expect(
      INPCService.runAdjustment(
        {
          companyId: "company-1",
          periodYear: 2026,
          periodMonth: 8,
          adjustmentAccountId: "acc-ajena",
        } as never,
        "user-1",
        tx as never,
      ),
    ).rejects.toThrow(/no pertenece/);
  });
});
