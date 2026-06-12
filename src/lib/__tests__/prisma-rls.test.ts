// src/lib/__tests__/prisma-rls.test.ts
import { describe, it, expect, vi } from "vitest";
import { withCompanyContext } from "../prisma-rls";
import type { PrismaTransactionClient } from "../prisma-rls";

function makeTx(overrides?: Partial<PrismaTransactionClient>): PrismaTransactionClient {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn(),
    ...overrides,
  } as unknown as PrismaTransactionClient;
}

describe("withCompanyContext", () => {
  it("emite SET LOCAL ROLE authenticated primero (neutraliza BYPASSRLS)", async () => {
    const tx = makeTx();
    const fn = vi.fn().mockResolvedValue("ok");

    await withCompanyContext("company-abc", tx, fn);

    // Llamada 1: SET LOCAL ROLE authenticated
    const call0 = vi.mocked(tx.$executeRaw).mock.calls[0];
    const sql0 = call0[0] as TemplateStringsArray;
    expect(sql0[0]).toContain("ROLE");
    expect(sql0[0]).toContain("authenticated");
  });

  it("invoca set_config con companyId correcto e is_local=true (equivale a SET LOCAL)", async () => {
    const tx = makeTx();
    const fn = vi.fn().mockResolvedValue("ok");

    await withCompanyContext("company-abc", tx, fn);

    // $executeRaw se llama dos veces: SET ROLE (call 0) + set_config (call 1)
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);

    // Llamada 2: SELECT set_config(...)
    const call1 = vi.mocked(tx.$executeRaw).mock.calls[1];
    const sql1 = call1[0] as TemplateStringsArray;
    expect(sql1[0]).toContain("set_config");
    expect(sql1[0]).toContain("app.current_company_id");
    expect(sql1[1]).toContain("true"); // is_local=true
    expect(call1[1]).toBe("company-abc"); // valor interpolado
  });

  it("llama a fn con el mismo tx (evita bug de closure con prisma global)", async () => {
    const tx = makeTx();
    const capturedTx: PrismaTransactionClient[] = [];
    const fn = vi.fn().mockImplementation(async (innerTx) => {
      capturedTx.push(innerTx);
      return "result";
    });

    const result = await withCompanyContext("company-xyz", tx, fn);

    expect(fn).toHaveBeenCalledWith(tx);
    expect(capturedTx[0]).toBe(tx); // mismo objeto, no copia
    expect(result).toBe("result");
  });

  it("retorna el valor que devuelve fn", async () => {
    const tx = makeTx();
    const fn = vi.fn().mockResolvedValue({ id: "inv-1", amount: 1000 });

    const result = await withCompanyContext("company-1", tx, fn);

    expect(result).toEqual({ id: "inv-1", amount: 1000 });
  });

  it("propaga excepciones lanzadas por fn", async () => {
    const tx = makeTx();
    const fn = vi.fn().mockRejectedValue(new Error("FK violation"));

    await expect(withCompanyContext("company-1", tx, fn)).rejects.toThrow("FK violation");
  });

  it("lanza si companyId está vacío (previene contexto RLS ambiguo)", async () => {
    const tx = makeTx();
    const fn = vi.fn();

    await expect(withCompanyContext("", tx, fn)).rejects.toThrow(/companyId/i);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
  });

  it("no llama a fn si $executeRaw falla (fallo antes de set_config propaga la excepción)", async () => {
    const tx = makeTx({
      $executeRaw: vi.fn().mockRejectedValue(new Error("DB error")),
    });
    const fn = vi.fn();

    await expect(withCompanyContext("company-1", tx, fn)).rejects.toThrow("DB error");
    expect(fn).not.toHaveBeenCalled();
  });
});
