// src/modules/vendors/__tests__/vendor.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

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
vi.mock("../services/VendorService", () => ({
  VendorService: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    linkToInvoice: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/ratelimit";
import { VendorService } from "../services/VendorService";
import {
  listVendorsAction,
  getVendorAction,
  createVendorAction,
  updateVendorAction,
  deleteVendorAction,
  linkVendorToInvoiceAction,
} from "../actions/vendor.actions";

const NOW = new Date("2026-01-01");
const vendor = { id: "v1", companyId: "c1", name: "Acme", rif: null, email: null, phone: null, address: null, deletedAt: null, createdAt: NOW, updatedAt: NOW };

function setAuth(userId: string | null) {
  mockAuth.mockResolvedValue({ userId });
}
function setMember(role: string | null) {
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(
    role ? { role } as never : null as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
});

// ── Auth guard ─────────────────────────────────────────────────────────────
describe("Auth guard — sin sesión", () => {
  beforeEach(() => setAuth(null));

  it("listVendorsAction retorna no autorizado", async () => {
    const r = await listVendorsAction("c1");
    expect(r.success).toBe(false);
  });
  it("createVendorAction retorna no autorizado", async () => {
    const r = await createVendorAction("c1", { name: "X" });
    expect(r.success).toBe(false);
  });
  it("deleteVendorAction retorna no autorizado", async () => {
    const r = await deleteVendorAction("c1", "v1");
    expect(r.success).toBe(false);
  });
  it("linkVendorToInvoiceAction retorna no autorizado", async () => {
    const r = await linkVendorToInvoiceAction("c1", "inv1", "v1");
    expect(r.success).toBe(false);
  });
});

// ── Role guard ─────────────────────────────────────────────────────────────
describe("Role guard — VIEWER no puede mutar", () => {
  beforeEach(() => { setAuth("u1"); setMember("VIEWER"); });

  it("createVendorAction rechaza VIEWER", async () => {
    const r = await createVendorAction("c1", { name: "X" });
    expect(r.success).toBe(false);
  });
  it("listVendorsAction rechaza VIEWER (requiere ACCOUNTING)", async () => {
    const r = await listVendorsAction("c1");
    expect(r.success).toBe(false);
  });
});

// ── Rate limit guard (HIGH-2) ──────────────────────────────────────────────
describe("Rate limit guard (HIGH-2)", () => {
  beforeEach(() => {
    setAuth("u1");
    setMember("ACCOUNTANT");
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false } as never);
  });

  it("createVendorAction rechaza si rate limit excedido", async () => {
    const r = await createVendorAction("c1", { name: "X" });
    expect(r.success).toBe(false);
    expect(r.success === false && r.error).toMatch(/solicitudes/i);
    expect(VendorService.create).not.toHaveBeenCalled();
  });

  it("linkVendorToInvoiceAction rechaza si rate limit excedido", async () => {
    setMember("ADMINISTRATIVE");
    const r = await linkVendorToInvoiceAction("c1", "inv1", "v1");
    expect(r.success).toBe(false);
    expect(VendorService.linkToInvoice).not.toHaveBeenCalled();
  });
});

// ── Schema validation (HIGH-3 RIF + MEDIUM-1 trim) ─────────────────────────
describe("Schema validation", () => {
  beforeEach(() => { setAuth("u1"); setMember("ADMINISTRATIVE"); });

  it("rechaza RIF con formato inválido (HIGH-3)", async () => {
    const r = await createVendorAction("c1", { name: "Acme", rif: "INVALID" });
    expect(r.success).toBe(false);
    expect(VendorService.create).not.toHaveBeenCalled();
  });

  it("acepta RIF válido J-12345678-9", async () => {
    vi.mocked(VendorService.create).mockResolvedValue(vendor as never);
    const r = await createVendorAction("c1", { name: "Acme", rif: "J-12345678-9" });
    expect(r.success).toBe(true);
  });

  it("acepta sin RIF (campo opcional)", async () => {
    vi.mocked(VendorService.create).mockResolvedValue(vendor as never);
    const r = await createVendorAction("c1", { name: "Acme" });
    expect(r.success).toBe(true);
  });

  it("rechaza nombre vacío", async () => {
    const r = await createVendorAction("c1", { name: "" });
    expect(r.success).toBe(false);
  });
});

// ── Flujo exitoso ──────────────────────────────────────────────────────────
describe("Flujo exitoso", () => {
  beforeEach(() => { setAuth("u1"); setMember("ADMINISTRATIVE"); });

  it("listVendorsAction retorna lista", async () => {
    setMember("ACCOUNTANT");
    vi.mocked(VendorService.list).mockResolvedValue([vendor] as never);
    const r = await listVendorsAction("c1");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toHaveLength(1);
  });

  it("getVendorAction retorna vendor", async () => {
    setMember("ACCOUNTANT");
    vi.mocked(VendorService.get).mockResolvedValue(vendor as never);
    const r = await getVendorAction("c1", "v1");
    expect(r.success).toBe(true);
  });

  it("getVendorAction retorna error si no encontrado", async () => {
    setMember("ACCOUNTANT");
    vi.mocked(VendorService.get).mockResolvedValue(null as never);
    const r = await getVendorAction("c1", "v_bad");
    expect(r.success).toBe(false);
  });

  it("createVendorAction crea exitosamente", async () => {
    vi.mocked(VendorService.create).mockResolvedValue(vendor as never);
    const r = await createVendorAction("c1", { name: "Acme" });
    expect(r.success).toBe(true);
  });

  it("updateVendorAction actualiza exitosamente", async () => {
    vi.mocked(VendorService.update).mockResolvedValue({ ...vendor, name: "Nuevo" } as never);
    const r = await updateVendorAction("c1", "v1", { name: "Nuevo" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Nuevo");
  });

  it("deleteVendorAction requiere ADMIN_ONLY — ACCOUNTANT rechazado", async () => {
    setMember("ACCOUNTANT");
    const r = await deleteVendorAction("c1", "v1");
    expect(r.success).toBe(false);
  });

  it("deleteVendorAction con OWNER soft-deletes y retorna linkedCount", async () => {
    setMember("OWNER");
    vi.mocked(VendorService.softDelete).mockResolvedValue({ deleted: true, linkedCount: 2 } as never);
    const r = await deleteVendorAction("c1", "v1");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.linkedCount).toBe(2);
  });

  it("linkVendorToInvoiceAction retorna error si servicio rechaza (IDOR guard activo)", async () => {
    vi.mocked(VendorService.linkToInvoice).mockResolvedValue(false as never);
    const r = await linkVendorToInvoiceAction("c1", "inv_otro_tenant", "v1");
    expect(r.success).toBe(false);
  });

  it("linkVendorToInvoiceAction vincula exitosamente", async () => {
    vi.mocked(VendorService.linkToInvoice).mockResolvedValue(true as never);
    const r = await linkVendorToInvoiceAction("c1", "inv1", "v1");
    expect(r.success).toBe(true);
  });
});
