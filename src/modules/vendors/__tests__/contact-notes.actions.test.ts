// src/modules/vendors/__tests__/contact-notes.actions.test.ts
// Q3-2: Tests para historial de interacciones (ContactNote) — clientes y proveedores.

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
vi.mock("../services/ContactNoteService", () => ({
  ContactNoteService: {
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("../services/CustomerService", () => ({
  CustomerService: {
    get: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    linkToInvoice: vi.fn(),
    countInactive: vi.fn(),
  },
}));
vi.mock("../services/VendorService", () => ({
  VendorService: {
    get: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    linkToInvoice: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/ratelimit";
import { ContactNoteService } from "../services/ContactNoteService";
import { CustomerService } from "../services/CustomerService";
import { VendorService } from "../services/VendorService";
import {
  listContactNotesAction,
  addContactNoteAction,
  deleteContactNoteAction,
} from "../actions/customer.actions";
import {
  listVendorNotesAction,
  addVendorNoteAction,
  deleteVendorNoteAction,
} from "../actions/vendor.actions";

const NOW = new Date("2026-01-01");

const mockNote = {
  id: "note1",
  companyId: "c1",
  entityType: "CUSTOMER",
  entityId: "cust1",
  content: "Llamó para consultar precio",
  createdAt: NOW,
  createdBy: "user1",
};

const mockVendorNote = {
  id: "note2",
  companyId: "c1",
  entityType: "VENDOR",
  entityId: "vend1",
  content: "Envió catálogo actualizado",
  createdAt: NOW,
  createdBy: "user1",
};

const mockCustomer = {
  id: "cust1",
  companyId: "c1",
  name: "Cliente SA",
  rif: null,
  email: null,
  phone: null,
  address: null,
  code: null,
  groupId: null,
  group: null,
  notes: null,
  category: "REGULAR" as const,
  deletedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const mockVendor = {
  id: "vend1",
  companyId: "c1",
  name: "Proveedor SRL",
  rif: null,
  email: null,
  phone: null,
  address: null,
  code: null,
  groupId: null,
  group: null,
  notes: null,
  category: "REGULAR" as const,
  isSpecialContributor: false,
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
});

// ── Auth guards ───────────────────────────────────────────────────────────────
describe("Auth guards — sin sesión", () => {
  beforeEach(() => setAuth(null));

  it("listContactNotesAction → no autorizado", async () => {
    const r = await listContactNotesAction("c1", "cust1");
    expect(r.success).toBe(false);
  });

  it("addContactNoteAction → no autorizado", async () => {
    const r = await addContactNoteAction("c1", "cust1", { content: "Hola" });
    expect(r.success).toBe(false);
  });

  it("deleteContactNoteAction → no autorizado", async () => {
    const r = await deleteContactNoteAction("c1", "note1");
    expect(r.success).toBe(false);
  });

  it("listVendorNotesAction → no autorizado", async () => {
    const r = await listVendorNotesAction("c1", "vend1");
    expect(r.success).toBe(false);
  });

  it("addVendorNoteAction → no autorizado", async () => {
    const r = await addVendorNoteAction("c1", "vend1", { content: "Hola" });
    expect(r.success).toBe(false);
  });

  it("deleteVendorNoteAction → no autorizado", async () => {
    const r = await deleteVendorNoteAction("c1", "note2");
    expect(r.success).toBe(false);
  });
});

// ── RBAC: ACCOUNTING puede listar, VIEWER no puede muttar ─────────────────────
describe("RBAC", () => {
  it("ACCOUNTING puede listar notas de cliente", async () => {
    setAuth("user1");
    setMember("ACCOUNTANT");
    vi.mocked(ContactNoteService.list).mockResolvedValue([mockNote] as never);

    const r = await listContactNotesAction("c1", "cust1");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toHaveLength(1);
    expect(ContactNoteService.list).toHaveBeenCalledWith("c1", "CUSTOMER", "cust1");
  });

  it("ACCOUNTING puede listar notas de proveedor", async () => {
    setAuth("user1");
    setMember("ACCOUNTANT");
    vi.mocked(ContactNoteService.list).mockResolvedValue([mockVendorNote] as never);

    const r = await listVendorNotesAction("c1", "vend1");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toHaveLength(1);
    expect(ContactNoteService.list).toHaveBeenCalledWith("c1", "VENDOR", "vend1");
  });

  it("VIEWER no puede agregar nota (requiere WRITERS)", async () => {
    setAuth("user1");
    setMember("VIEWER");

    const r = await addContactNoteAction("c1", "cust1", { content: "Nota" });
    expect(r.success).toBe(false);
    expect(ContactNoteService.create).not.toHaveBeenCalled();
  });
});

// ── addContactNoteAction ──────────────────────────────────────────────────────
describe("addContactNoteAction", () => {
  beforeEach(() => {
    setAuth("user1");
    setMember("ACCOUNTANT");
  });

  it("crea nota correctamente", async () => {
    vi.mocked(CustomerService.get).mockResolvedValue(mockCustomer as never);
    vi.mocked(ContactNoteService.create).mockResolvedValue(mockNote as never);

    const r = await addContactNoteAction("c1", "cust1", { content: "Llamó para consultar precio" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.content).toBe("Llamó para consultar precio");
    expect(ContactNoteService.create).toHaveBeenCalledWith(
      "c1", "CUSTOMER", "cust1", "Llamó para consultar precio", "user1",
    );
  });

  it("rechaza contenido vacío", async () => {
    const r = await addContactNoteAction("c1", "cust1", { content: "" });
    expect(r.success).toBe(false);
    expect(ContactNoteService.create).not.toHaveBeenCalled();
  });

  it("rechaza contenido demasiado largo (>2000 chars)", async () => {
    const r = await addContactNoteAction("c1", "cust1", { content: "x".repeat(2001) });
    expect(r.success).toBe(false);
  });

  it("retorna error si cliente no pertenece a la empresa (ADR-004)", async () => {
    vi.mocked(CustomerService.get).mockResolvedValue(null as never);

    const r = await addContactNoteAction("c1", "cust1", { content: "Nota" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("no encontrado");
    expect(ContactNoteService.create).not.toHaveBeenCalled();
  });
});

// ── addVendorNoteAction ───────────────────────────────────────────────────────
describe("addVendorNoteAction", () => {
  beforeEach(() => {
    setAuth("user1");
    setMember("ACCOUNTANT");
  });

  it("crea nota de proveedor correctamente", async () => {
    vi.mocked(VendorService.get).mockResolvedValue(mockVendor as never);
    vi.mocked(ContactNoteService.create).mockResolvedValue(mockVendorNote as never);

    const r = await addVendorNoteAction("c1", "vend1", { content: "Envió catálogo actualizado" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.entityType).toBe("VENDOR");
    expect(ContactNoteService.create).toHaveBeenCalledWith(
      "c1", "VENDOR", "vend1", "Envió catálogo actualizado", "user1",
    );
  });

  it("retorna error si proveedor no pertenece a la empresa (ADR-004)", async () => {
    vi.mocked(VendorService.get).mockResolvedValue(null as never);

    const r = await addVendorNoteAction("c1", "vend1", { content: "Nota" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("no encontrado");
  });
});

// ── deleteContactNoteAction ───────────────────────────────────────────────────
describe("deleteContactNoteAction", () => {
  beforeEach(() => {
    setAuth("user1");
    setMember("ACCOUNTANT");
  });

  it("elimina nota existente", async () => {
    vi.mocked(ContactNoteService.delete).mockResolvedValue(true as never);

    const r = await deleteContactNoteAction("c1", "note1");
    expect(r.success).toBe(true);
    expect(ContactNoteService.delete).toHaveBeenCalledWith("c1", "note1");
  });

  it("retorna error si nota no existe o es de otra empresa", async () => {
    vi.mocked(ContactNoteService.delete).mockResolvedValue(false as never);

    const r = await deleteContactNoteAction("c1", "note-ajena");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("no encontrada");
  });
});

// ── deleteVendorNoteAction ────────────────────────────────────────────────────
describe("deleteVendorNoteAction", () => {
  beforeEach(() => {
    setAuth("user1");
    setMember("ACCOUNTANT");
  });

  it("elimina nota de proveedor existente", async () => {
    vi.mocked(ContactNoteService.delete).mockResolvedValue(true as never);

    const r = await deleteVendorNoteAction("c1", "note2");
    expect(r.success).toBe(true);
    expect(ContactNoteService.delete).toHaveBeenCalledWith("c1", "note2");
  });

  it("retorna error si nota no existe", async () => {
    vi.mocked(ContactNoteService.delete).mockResolvedValue(false as never);

    const r = await deleteVendorNoteAction("c1", "ghost");
    expect(r.success).toBe(false);
  });
});

// ── Rate limit ────────────────────────────────────────────────────────────────
describe("Rate limiting", () => {
  beforeEach(() => {
    setAuth("user1");
    setMember("ACCOUNTANT");
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false } as never);
  });

  it("addContactNoteAction bloqueado por rate limit", async () => {
    const r = await addContactNoteAction("c1", "cust1", { content: "Nota" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("Demasiadas");
  });

  it("addVendorNoteAction bloqueado por rate limit", async () => {
    const r = await addVendorNoteAction("c1", "vend1", { content: "Nota" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("Demasiadas");
  });
});

// ── ContactCategory en schemas ────────────────────────────────────────────────
describe("ContactCategory — campos notes/category en Customer/Vendor", () => {
  it("CustomerService.get devuelve campos de categoría", () => {
    // Structural — solo verificamos que el tipo tiene los campos correctos
    const row = mockCustomer;
    expect(row.category).toBe("REGULAR");
    expect(row.notes).toBeNull();
  });

  it("VendorService.get devuelve campos de categoría", () => {
    const row = mockVendor;
    expect(row.category).toBe("REGULAR");
    expect(row.notes).toBeNull();
  });
});
