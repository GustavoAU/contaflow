// src/modules/vendors/__tests__/PartnerService.test.ts
// TDD SPEC (RED) — ADR-054: "Ter." — Partner es el tercero mínimo para socio/accionista.
// Estos tests especifican PartnerService ANTES de que exista el archivo de producción.
// Mismo patrón de mocks y mismo criterio de IDOR (ADR-004) que CustomerService.test.ts.
//
// NO existe todavía `src/modules/vendors/services/PartnerService.ts` — se espera que este
// archivo falle con "Cannot find module" hasta que fiscal-agent/ledger-agent lo implementen.

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { PartnerService } from "../services/PartnerService";

vi.mock("@/lib/prisma", () => ({
  default: {
    partner: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const NOW = new Date("2026-01-01");
const base = {
  id: "pa1",
  companyId: "c1",
  name: "Juan Pérez",
  rif: null,
  notes: null,
  deletedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

beforeEach(() => vi.clearAllMocks());

describe("PartnerService.list", () => {
  it("filtra por companyId y deletedAt null", async () => {
    vi.mocked(prisma.partner.findMany).mockResolvedValue([base] as never);
    await PartnerService.list("c1");
    expect(prisma.partner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: "c1", deletedAt: null } })
    );
  });

  it("ordena por nombre ascendente", async () => {
    vi.mocked(prisma.partner.findMany).mockResolvedValue([base] as never);
    await PartnerService.list("c1");
    expect(prisma.partner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { name: "asc" } })
    );
  });

  it("devuelve solo los socios de la empresa solicitada", async () => {
    vi.mocked(prisma.partner.findMany).mockResolvedValue([base] as never);
    const result = await PartnerService.list("c1");
    expect(result).toEqual([base]);
  });
});

describe("PartnerService.get — IDOR (ADR-004)", () => {
  it("existe y pertenece a la empresa → lo devuelve", async () => {
    vi.mocked(prisma.partner.findUnique).mockResolvedValue(base as never);
    const result = await PartnerService.get("c1", "pa1");
    expect(result).toEqual(base);
  });

  it("existe pero pertenece a OTRA empresa → null (post-fetch ownership check)", async () => {
    vi.mocked(prisma.partner.findUnique).mockResolvedValue(base as never);
    const result = await PartnerService.get("otro-tenant", "pa1");
    expect(result).toBeNull();
  });

  it("no existe → null", async () => {
    vi.mocked(prisma.partner.findUnique).mockResolvedValue(null as never);
    const result = await PartnerService.get("c1", "no-existe");
    expect(result).toBeNull();
  });
});

describe("PartnerService.create", () => {
  it("crea con los campos dados", async () => {
    vi.mocked(prisma.partner.create).mockResolvedValue(base as never);
    const result = await PartnerService.create("c1", { name: "Juan Pérez" });
    expect(prisma.partner.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ companyId: "c1", name: "Juan Pérez" }),
      })
    );
    expect(result).toEqual(base);
  });

  it("si no se pasa rif, no revienta (acepta undefined)", async () => {
    vi.mocked(prisma.partner.create).mockResolvedValue(base as never);
    await expect(PartnerService.create("c1", { name: "Juan Pérez" })).resolves.not.toThrow();
    expect(prisma.partner.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rif: null }),
      })
    );
  });

  it("crea con rif normalizado cuando se pasa", async () => {
    vi.mocked(prisma.partner.create).mockResolvedValue({ ...base, rif: "J-12345678-9" } as never);
    await PartnerService.create("c1", { name: "Juan Pérez", rif: "J-12345678-9" });
    expect(prisma.partner.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rif: "J-12345678-9" }),
      })
    );
  });
});

describe("PartnerService.update", () => {
  it("existe, pertenece a la empresa y no está borrado → actualiza", async () => {
    vi.mocked(prisma.partner.findUnique).mockResolvedValue(base as never);
    vi.mocked(prisma.partner.update).mockResolvedValue({ ...base, name: "Nuevo Nombre" } as never);
    const result = await PartnerService.update("c1", "pa1", { name: "Nuevo Nombre" });
    expect(prisma.partner.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "pa1" } })
    );
    expect(result).toEqual({ ...base, name: "Nuevo Nombre" });
  });

  it("pertenece a OTRA empresa → no actualiza, devuelve null", async () => {
    vi.mocked(prisma.partner.findUnique).mockResolvedValue(base as never);
    const result = await PartnerService.update("otro-tenant", "pa1", { name: "Hackeado" });
    expect(result).toBeNull();
    expect(prisma.partner.update).not.toHaveBeenCalled();
  });

  it("ya está borrado (deletedAt no nulo) → devuelve null (mismo criterio que CustomerService.update)", async () => {
    vi.mocked(prisma.partner.findUnique).mockResolvedValue({ ...base, deletedAt: NOW } as never);
    const result = await PartnerService.update("c1", "pa1", { name: "Resucitado" });
    expect(result).toBeNull();
    expect(prisma.partner.update).not.toHaveBeenCalled();
  });

  it("no existe → devuelve null", async () => {
    vi.mocked(prisma.partner.findUnique).mockResolvedValue(null as never);
    const result = await PartnerService.update("c1", "no-existe", { name: "X" });
    expect(result).toBeNull();
    expect(prisma.partner.update).not.toHaveBeenCalled();
  });
});

describe("PartnerService.softDelete", () => {
  it("marca deletedAt cuando pertenece a la empresa", async () => {
    vi.mocked(prisma.partner.findUnique).mockResolvedValue(base as never);
    vi.mocked(prisma.partner.update).mockResolvedValue({ ...base, deletedAt: NOW } as never);
    const result = await PartnerService.softDelete("c1", "pa1");
    expect(result.deleted).toBe(true);
    expect(prisma.partner.update).toHaveBeenCalledWith({
      where: { id: "pa1" },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("pertenece a OTRA empresa → no borra, devuelve { deleted: false }", async () => {
    vi.mocked(prisma.partner.findUnique).mockResolvedValue(base as never);
    const result = await PartnerService.softDelete("otro-tenant", "pa1");
    expect(result).toEqual({ deleted: false });
    expect(prisma.partner.update).not.toHaveBeenCalled();
  });

  it("ya está borrado → no vuelve a borrar, devuelve { deleted: false }", async () => {
    vi.mocked(prisma.partner.findUnique).mockResolvedValue({ ...base, deletedAt: NOW } as never);
    const result = await PartnerService.softDelete("c1", "pa1");
    expect(result).toEqual({ deleted: false });
    expect(prisma.partner.update).not.toHaveBeenCalled();
  });

  it("no existe → devuelve { deleted: false }", async () => {
    vi.mocked(prisma.partner.findUnique).mockResolvedValue(null as never);
    const result = await PartnerService.softDelete("c1", "no-existe");
    expect(result).toEqual({ deleted: false });
  });
});
