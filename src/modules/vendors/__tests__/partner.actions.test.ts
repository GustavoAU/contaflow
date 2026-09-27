// src/modules/vendors/__tests__/partner.actions.test.ts
// TDD SPEC (RED) — ADR-054: Server Actions CRUD para Partner (socio/accionista).
// NO existe todavía `src/modules/vendors/actions/partner.actions.ts` — se espera que este
// archivo falle con "Cannot find module" hasta que se implemente.
//
// Mismo patrón de mocks que vendors-extra.actions.test.ts (customer.actions.ts): auth guard,
// rate limit, rol insuficiente, happy path, propagación de error vía toActionError.
// Roles asumidos (copiados de customer.actions.ts, NO inventados): ACCOUNTING para lecturas,
// WRITERS + limiters.fiscal para create/update, ADMIN_ONLY + limiters.fiscal para delete.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  fiscalKey: (c: string, u: string) => `${c}:${u}`,
  limiters: { fiscal: {} },
}));
vi.mock("../services/PartnerService", () => ({
  PartnerService: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/ratelimit";
import { PartnerService } from "../services/PartnerService";
import {
  listPartnersAction,
  getPartnerAction,
  createPartnerAction,
  updatePartnerAction,
  deletePartnerAction,
} from "../actions/partner.actions";

const NOW = new Date("2026-01-01");
const mockPartner = {
  id: "pa1",
  companyId: "c1",
  name: "Ana Pérez",
  rif: null,
  notes: null,
  deletedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function setAuth(userId: string | null) {
  mockAuth.mockResolvedValue({ userId });
}
function setMember(role: string | null) {
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(
    role ? ({ role } as never) : (null as never),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  setAuth("user-1");
  setMember("ACCOUNTANT");
});

// ─── auth guards ───────────────────────────────────────────────────────────

describe("partner.actions — auth guards", () => {
  beforeEach(() => setAuth(null));

  it("listPartnersAction sin sesión → error", async () => {
    const r = await listPartnersAction("c1");
    expect(r.success).toBe(false);
  });

  it("getPartnerAction sin sesión → error", async () => {
    const r = await getPartnerAction("c1", "pa1");
    expect(r.success).toBe(false);
  });

  it("createPartnerAction sin sesión → error", async () => {
    const r = await createPartnerAction("c1", { name: "Ana Pérez" });
    expect(r.success).toBe(false);
  });

  it("updatePartnerAction sin sesión → error", async () => {
    const r = await updatePartnerAction("c1", "pa1", { name: "Nuevo" });
    expect(r.success).toBe(false);
  });

  it("deletePartnerAction sin sesión → error", async () => {
    const r = await deletePartnerAction("c1", "pa1");
    expect(r.success).toBe(false);
  });
});

// ─── role guards ───────────────────────────────────────────────────────────

describe("partner.actions — role guards", () => {
  it("VIEWER no puede listar (requiere ACCOUNTING)", async () => {
    setMember("VIEWER");
    const r = await listPartnersAction("c1");
    expect(r.success).toBe(false);
    expect(PartnerService.list).not.toHaveBeenCalled();
  });

  it("VIEWER no puede leer un socio (requiere ACCOUNTING)", async () => {
    setMember("VIEWER");
    const r = await getPartnerAction("c1", "pa1");
    expect(r.success).toBe(false);
  });

  it("VIEWER no puede crear (requiere WRITERS)", async () => {
    setMember("VIEWER");
    const r = await createPartnerAction("c1", { name: "Ana Pérez" });
    expect(r.success).toBe(false);
    expect(PartnerService.create).not.toHaveBeenCalled();
  });

  it("VIEWER no puede actualizar (requiere WRITERS)", async () => {
    setMember("VIEWER");
    const r = await updatePartnerAction("c1", "pa1", { name: "Nuevo" });
    expect(r.success).toBe(false);
    expect(PartnerService.update).not.toHaveBeenCalled();
  });

  it("ACCOUNTANT no puede eliminar (requiere ADMIN_ONLY)", async () => {
    const r = await deletePartnerAction("c1", "pa1");
    expect(r.success).toBe(false);
    expect(PartnerService.softDelete).not.toHaveBeenCalled();
  });

  it("ADMINISTRATIVE no puede eliminar (requiere ADMIN_ONLY)", async () => {
    setMember("ADMINISTRATIVE");
    const r = await deletePartnerAction("c1", "pa1");
    expect(r.success).toBe(false);
  });
});

// ─── rate limit ────────────────────────────────────────────────────────────

describe("partner.actions — rate limit", () => {
  it("createPartnerAction bloqueada por rate limit → error, sin llamar al servicio", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, error: "Demasiadas solicitudes" } as never);
    const r = await createPartnerAction("c1", { name: "Ana Pérez" });
    expect(r.success).toBe(false);
    expect(PartnerService.create).not.toHaveBeenCalled();
  });
});

// ─── happy path ────────────────────────────────────────────────────────────

describe("partner.actions — flujo exitoso", () => {
  it("listPartnersAction retorna lista", async () => {
    vi.mocked(PartnerService.list).mockResolvedValue([mockPartner] as never);
    const r = await listPartnersAction("c1");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toHaveLength(1);
  });

  it("getPartnerAction retorna socio", async () => {
    vi.mocked(PartnerService.get).mockResolvedValue(mockPartner as never);
    const r = await getPartnerAction("c1", "pa1");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Ana Pérez");
  });

  it("getPartnerAction retorna error si no encontrado", async () => {
    vi.mocked(PartnerService.get).mockResolvedValue(null as never);
    const r = await getPartnerAction("c1", "bad-id");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("no encontrado");
  });

  it("createPartnerAction crea exitosamente con ACCOUNTANT", async () => {
    vi.mocked(PartnerService.create).mockResolvedValue(mockPartner as never);
    const r = await createPartnerAction("c1", { name: "Ana Pérez" });
    expect(r.success).toBe(true);
    expect(PartnerService.create).toHaveBeenCalledWith("c1", expect.objectContaining({ name: "Ana Pérez" }));
  });

  it("createPartnerAction rechaza input inválido (name de 1 carácter) sin llamar al servicio", async () => {
    const r = await createPartnerAction("c1", { name: "A" });
    expect(r.success).toBe(false);
    expect(PartnerService.create).not.toHaveBeenCalled();
  });

  it("createPartnerAction rechaza RIF inválido sin llamar al servicio", async () => {
    const r = await createPartnerAction("c1", { name: "Ana Pérez", rif: "INVALIDO" });
    expect(r.success).toBe(false);
    expect(PartnerService.create).not.toHaveBeenCalled();
  });

  it("updatePartnerAction actualiza exitosamente", async () => {
    vi.mocked(PartnerService.update).mockResolvedValue({ ...mockPartner, name: "Nuevo" } as never);
    const r = await updatePartnerAction("c1", "pa1", { name: "Nuevo" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Nuevo");
  });

  it("updatePartnerAction retorna error si no encontrado o de otra empresa", async () => {
    vi.mocked(PartnerService.update).mockResolvedValue(null as never);
    const r = await updatePartnerAction("c1", "bad-id", { name: "X" });
    expect(r.success).toBe(false);
  });

  it("deletePartnerAction con OWNER soft-deletes", async () => {
    setMember("OWNER");
    vi.mocked(PartnerService.softDelete).mockResolvedValue({ deleted: true } as never);
    const r = await deletePartnerAction("c1", "pa1");
    expect(r.success).toBe(true);
  });

  it("deletePartnerAction retorna error si ya eliminado o de otra empresa", async () => {
    setMember("OWNER");
    vi.mocked(PartnerService.softDelete).mockResolvedValue({ deleted: false } as never);
    const r = await deletePartnerAction("c1", "pa1");
    expect(r.success).toBe(false);
  });
});

// ─── propagación de errores (toActionError) ────────────────────────────────

describe("partner.actions — propagación de errores vía toActionError", () => {
  it("listPartnersAction propaga error del servicio", async () => {
    vi.mocked(PartnerService.list).mockRejectedValue(new Error("db error") as never);
    const r = await listPartnersAction("c1");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("db error");
  });

  it("createPartnerAction propaga P2002 como mensaje de negocio ('Ya existe un registro con esos datos')", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "7.0.0",
    });
    vi.mocked(PartnerService.create).mockRejectedValue(p2002 as never);
    const r = await createPartnerAction("c1", { name: "Ana Pérez", rif: "J-12345678-9" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/ya existe/i);
  });
});
