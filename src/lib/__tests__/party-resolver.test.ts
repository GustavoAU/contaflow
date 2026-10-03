// src/lib/__tests__/party-resolver.test.ts
import { describe, it, expect, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { resolvePartyIdByLinkOrRif, batchResolvePartyIdsByRif } from "../party-resolver";

function makeDb(
  overrides: Partial<{
    customerFound: { id: string } | null;
    vendorFound: { id: string } | null;
    customerRows: { id: string; rif: string }[];
    vendorRows: { id: string; rif: string }[];
  }> = {}
) {
  return {
    customer: {
      findFirst: vi.fn().mockResolvedValue(overrides.customerFound ?? null),
      findMany: vi.fn().mockResolvedValue(overrides.customerRows ?? []),
    },
    vendor: {
      findFirst: vi.fn().mockResolvedValue(overrides.vendorFound ?? null),
      findMany: vi.fn().mockResolvedValue(overrides.vendorRows ?? []),
    },
  } as unknown as Prisma.TransactionClient;
}

describe("resolvePartyIdByLinkOrRif", () => {
  it("usa el vínculo explícito sin consultar por RIF", async () => {
    const db = makeDb();
    const id = await resolvePartyIdByLinkOrRif(db, "c1", "customer", "cust-linked", "J-11111111-1");
    expect(id).toBe("cust-linked");
    expect(
      vi.mocked(
        (db as unknown as { customer: { findFirst: ReturnType<typeof vi.fn> } }).customer.findFirst
      )
    ).not.toHaveBeenCalled();
  });

  it("sin vínculo, busca customer por RIF normalizado", async () => {
    const db = makeDb({ customerFound: { id: "cust-por-rif" } });
    const id = await resolvePartyIdByLinkOrRif(db, "c1", "customer", null, "j 12345678 9");
    expect(id).toBe("cust-por-rif");
    expect(
      vi.mocked(
        (db as unknown as { customer: { findFirst: ReturnType<typeof vi.fn> } }).customer.findFirst
      )
    ).toHaveBeenCalledWith({
      where: { companyId: "c1", rif: "J-12345678-9", deletedAt: null },
      select: { id: true },
    });
  });

  it("sin vínculo, busca vendor por RIF cuando kind='vendor'", async () => {
    const db = makeDb({ vendorFound: { id: "vend-por-rif" } });
    const id = await resolvePartyIdByLinkOrRif(db, "c1", "vendor", undefined, "J-22222222-2");
    expect(id).toBe("vend-por-rif");
  });

  it("sin vínculo y sin RIF → undefined, nunca consulta la BD", async () => {
    const db = makeDb();
    const id = await resolvePartyIdByLinkOrRif(db, "c1", "customer", null, null);
    expect(id).toBeUndefined();
    expect(
      vi.mocked(
        (db as unknown as { customer: { findFirst: ReturnType<typeof vi.fn> } }).customer.findFirst
      )
    ).not.toHaveBeenCalled();
  });

  it("sin vínculo y RIF sin match → undefined (nunca lanza)", async () => {
    const db = makeDb({ customerFound: null });
    const id = await resolvePartyIdByLinkOrRif(db, "c1", "customer", null, "J-33333333-3");
    expect(id).toBeUndefined();
  });
});

describe("batchResolvePartyIdsByRif", () => {
  it("resuelve varios RIF en una sola query", async () => {
    const db = makeDb({
      vendorRows: [
        { id: "v1", rif: "J-11111111-1" },
        { id: "v2", rif: "J-22222222-2" },
      ],
    });
    const map = await batchResolvePartyIdsByRif(db, "c1", "vendor", [
      "J-11111111-1",
      "J-22222222-2",
    ]);
    expect(map.get("J-11111111-1")).toBe("v1");
    expect(map.get("J-22222222-2")).toBe("v2");
    expect(
      vi.mocked(
        (db as unknown as { vendor: { findMany: ReturnType<typeof vi.fn> } }).vendor.findMany
      )
    ).toHaveBeenCalledTimes(1);
  });

  it("deduplica RIFs repetidos antes de consultar", async () => {
    const db = makeDb({ customerRows: [{ id: "c1", rif: "J-11111111-1" }] });
    await batchResolvePartyIdsByRif(db, "co1", "customer", ["J-11111111-1", "J-11111111-1"]);
    expect(
      vi.mocked(
        (db as unknown as { customer: { findMany: ReturnType<typeof vi.fn> } }).customer.findMany
      )
    ).toHaveBeenCalledWith({
      where: { companyId: "co1", rif: { in: ["J-11111111-1"] }, deletedAt: null },
      select: { id: true, rif: true },
    });
  });

  it("lista vacía → Map vacío, nunca consulta la BD", async () => {
    const db = makeDb();
    const map = await batchResolvePartyIdsByRif(db, "c1", "vendor", []);
    expect(map.size).toBe(0);
    expect(
      vi.mocked(
        (db as unknown as { vendor: { findMany: ReturnType<typeof vi.fn> } }).vendor.findMany
      )
    ).not.toHaveBeenCalled();
  });

  it("RIF sin match simplemente no aparece en el Map", async () => {
    const db = makeDb({ vendorRows: [] });
    const map = await batchResolvePartyIdsByRif(db, "c1", "vendor", ["J-99999999-9"]);
    expect(map.size).toBe(0);
  });
});
