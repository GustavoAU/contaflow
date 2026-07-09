// src/modules/vendors/__tests__/vendors-extra.actions.test.ts
// Tests for customer.actions.ts, contact-group.actions.ts, and error propagation in vendor.actions.ts

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
vi.mock("../services/CustomerService", () => ({
  CustomerService: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    linkToInvoice: vi.fn(),
  },
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
vi.mock("../services/ContactNoteService", () => ({
  ContactNoteService: {
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("../services/ContactGroupService", () => ({
  VendorGroupService: {
    create: vi.fn(),
    delete: vi.fn(),
  },
  CustomerGroupService: {
    create: vi.fn(),
    delete: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/ratelimit";
import { CustomerService } from "../services/CustomerService";
import { VendorService } from "../services/VendorService";
import { VendorGroupService, CustomerGroupService } from "../services/ContactGroupService";
import {
  listCustomersAction,
  getCustomerAction,
  createCustomerAction,
  updateCustomerAction,
  deleteCustomerAction,
  linkCustomerToInvoiceAction,
} from "../actions/customer.actions";
import {
  createVendorGroupAction,
  deleteVendorGroupAction,
  createCustomerGroupAction,
  deleteCustomerGroupAction,
} from "../actions/contact-group.actions";
import { listVendorsAction, createVendorAction } from "../actions/vendor.actions";

const NOW = new Date("2026-01-01");
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
const mockGroup = { id: "grp1", companyId: "c1", name: "Mayoristas", createdAt: NOW };

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

// ─── customer.actions.ts — auth guards ───────────────────────────────────────

describe("customer.actions — auth guards", () => {
  beforeEach(() => setAuth(null));

  it("listCustomersAction sin sesión → error", async () => {
    const r = await listCustomersAction("c1");
    expect(r.success).toBe(false);
  });

  it("createCustomerAction sin sesión → error", async () => {
    const r = await createCustomerAction("c1", { name: "X" });
    expect(r.success).toBe(false);
  });

  it("deleteCustomerAction sin sesión → error", async () => {
    const r = await deleteCustomerAction("c1", "cust1");
    expect(r.success).toBe(false);
  });

  it("linkCustomerToInvoiceAction sin sesión → error", async () => {
    const r = await linkCustomerToInvoiceAction("c1", "inv1", "cust1");
    expect(r.success).toBe(false);
  });
});

// ─── customer.actions.ts — role guards ───────────────────────────────────────

describe("customer.actions — role guards", () => {
  it("VIEWER no puede listar (requiere ACCOUNTING)", async () => {
    setMember("VIEWER");
    const r = await listCustomersAction("c1");
    expect(r.success).toBe(false);
  });

  it("VIEWER no puede crear (requiere WRITERS)", async () => {
    setMember("VIEWER");
    const r = await createCustomerAction("c1", { name: "X" });
    expect(r.success).toBe(false);
    expect(CustomerService.create).not.toHaveBeenCalled();
  });

  it("ACCOUNTANT no puede eliminar (requiere ADMIN_ONLY)", async () => {
    const r = await deleteCustomerAction("c1", "cust1");
    expect(r.success).toBe(false);
  });
});

// ─── customer.actions.ts — success paths ─────────────────────────────────────

describe("customer.actions — flujo exitoso", () => {
  it("listCustomersAction retorna lista", async () => {
    vi.mocked(CustomerService.list).mockResolvedValue([mockCustomer] as never);
    const r = await listCustomersAction("c1");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toHaveLength(1);
  });

  it("getCustomerAction retorna cliente", async () => {
    vi.mocked(CustomerService.get).mockResolvedValue(mockCustomer as never);
    const r = await getCustomerAction("c1", "cust1");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Cliente SA");
  });

  it("getCustomerAction retorna error si no encontrado", async () => {
    vi.mocked(CustomerService.get).mockResolvedValue(null as never);
    const r = await getCustomerAction("c1", "bad-id");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("no encontrado");
  });

  it("createCustomerAction crea exitosamente con ACCOUNTANT", async () => {
    vi.mocked(CustomerService.create).mockResolvedValue(mockCustomer as never);
    const r = await createCustomerAction("c1", { name: "Cliente SA" });
    expect(r.success).toBe(true);
  });

  it("createCustomerAction rechaza RIF inválido", async () => {
    const r = await createCustomerAction("c1", { name: "X", rif: "BADRIF" });
    expect(r.success).toBe(false);
    expect(CustomerService.create).not.toHaveBeenCalled();
  });

  it("updateCustomerAction actualiza exitosamente", async () => {
    vi.mocked(CustomerService.update).mockResolvedValue({ ...mockCustomer, name: "Nuevo" } as never);
    const r = await updateCustomerAction("c1", "cust1", { name: "Nuevo" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Nuevo");
  });

  it("updateCustomerAction retorna error si no encontrado", async () => {
    vi.mocked(CustomerService.update).mockResolvedValue(null as never);
    const r = await updateCustomerAction("c1", "bad-id", { name: "X" });
    expect(r.success).toBe(false);
  });

  it("deleteCustomerAction con OWNER soft-deletes", async () => {
    setMember("OWNER");
    vi.mocked(CustomerService.softDelete).mockResolvedValue({ deleted: true, linkedCount: 3 } as never);
    const r = await deleteCustomerAction("c1", "cust1");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.linkedCount).toBe(3);
  });

  it("deleteCustomerAction retorna error si ya eliminado", async () => {
    setMember("OWNER");
    vi.mocked(CustomerService.softDelete).mockResolvedValue({ deleted: false, linkedCount: 0 } as never);
    const r = await deleteCustomerAction("c1", "cust1");
    expect(r.success).toBe(false);
  });

  it("linkCustomerToInvoiceAction vincula exitosamente", async () => {
    vi.mocked(CustomerService.linkToInvoice).mockResolvedValue(true as never);
    const r = await linkCustomerToInvoiceAction("c1", "inv1", "cust1");
    expect(r.success).toBe(true);
  });

  it("linkCustomerToInvoiceAction rechaza IDOR (factura de otro tenant)", async () => {
    vi.mocked(CustomerService.linkToInvoice).mockResolvedValue(false as never);
    const r = await linkCustomerToInvoiceAction("c1", "inv-otro", "cust1");
    expect(r.success).toBe(false);
  });
});

// ─── customer.actions.ts — error propagation ─────────────────────────────────

describe("customer.actions — error propagation via toActionError", () => {
  it("listCustomersAction propaga error con mapPrismaError", async () => {
    vi.mocked(CustomerService.list).mockRejectedValue(new Error("db error") as never);
    const r = await listCustomersAction("c1");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("db error");
  });

  it("createCustomerAction propaga error de servicio", async () => {
    vi.mocked(CustomerService.create).mockRejectedValue(new Error("constraint failed") as never);
    const r = await createCustomerAction("c1", { name: "Dup" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("constraint failed");
  });
});

// ─── vendor.actions.ts — error propagation ───────────────────────────────────

describe("vendor.actions — error propagation via toActionError", () => {
  it("listVendorsAction propaga error con mapPrismaError", async () => {
    vi.mocked(VendorService.list).mockRejectedValue(new Error("db error") as never);
    const r = await listVendorsAction("c1");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("db error");
  });

  it("createVendorAction propaga error de servicio", async () => {
    setMember("ADMINISTRATIVE");
    vi.mocked(VendorService.create).mockRejectedValue(new Error("constraint failed") as never);
    const r = await createVendorAction("c1", { name: "Dup" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("constraint failed");
  });
});

// ─── contact-group.actions.ts ─────────────────────────────────────────────────

describe("createVendorGroupAction", () => {
  it("sin sesión → error", async () => {
    setAuth(null);
    const r = await createVendorGroupAction("c1", "Mayoristas");
    expect(r.success).toBe(false);
  });

  it("VIEWER no puede crear grupo (requiere WRITERS)", async () => {
    setMember("VIEWER");
    const r = await createVendorGroupAction("c1", "Mayoristas");
    expect(r.success).toBe(false);
    expect(VendorGroupService.create).not.toHaveBeenCalled();
  });

  it("nombre vacío → error de validación", async () => {
    const r = await createVendorGroupAction("c1", "");
    expect(r.success).toBe(false);
    expect(VendorGroupService.create).not.toHaveBeenCalled();
  });

  it("ACCOUNTANT crea grupo exitosamente", async () => {
    vi.mocked(VendorGroupService.create).mockResolvedValue(mockGroup as never);
    const r = await createVendorGroupAction("c1", "Mayoristas");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Mayoristas");
  });

  it("duplicado → 'Ya existe un grupo con ese nombre.'", async () => {
    vi.mocked(VendorGroupService.create).mockRejectedValue(new Error("P2002") as never);
    const r = await createVendorGroupAction("c1", "Mayoristas");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("Ya existe un grupo con ese nombre.");
  });
});

describe("deleteVendorGroupAction", () => {
  it("sin sesión → error", async () => {
    setAuth(null);
    const r = await deleteVendorGroupAction("c1", "grp1");
    expect(r.success).toBe(false);
  });

  it("ACCOUNTANT no puede eliminar (requiere ADMIN_ONLY)", async () => {
    const r = await deleteVendorGroupAction("c1", "grp1");
    expect(r.success).toBe(false);
  });

  it("OWNER elimina grupo exitosamente", async () => {
    setMember("OWNER");
    vi.mocked(VendorGroupService.delete).mockResolvedValue(true as never);
    const r = await deleteVendorGroupAction("c1", "grp1");
    expect(r.success).toBe(true);
  });

  it("grupo no encontrado → error", async () => {
    setMember("OWNER");
    vi.mocked(VendorGroupService.delete).mockResolvedValue(false as never);
    const r = await deleteVendorGroupAction("c1", "bad");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("no encontrado");
  });
});

describe("createCustomerGroupAction", () => {
  it("sin sesión → error", async () => {
    setAuth(null);
    const r = await createCustomerGroupAction("c1", "VIP");
    expect(r.success).toBe(false);
  });

  it("ACCOUNTANT crea grupo exitosamente", async () => {
    vi.mocked(CustomerGroupService.create).mockResolvedValue({ ...mockGroup, name: "VIP" } as never);
    const r = await createCustomerGroupAction("c1", "VIP");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("VIP");
  });

  it("duplicado → 'Ya existe un grupo con ese nombre.'", async () => {
    vi.mocked(CustomerGroupService.create).mockRejectedValue(new Error("P2002") as never);
    const r = await createCustomerGroupAction("c1", "VIP");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("Ya existe un grupo con ese nombre.");
  });
});

describe("deleteCustomerGroupAction", () => {
  it("OWNER elimina grupo exitosamente", async () => {
    setMember("OWNER");
    vi.mocked(CustomerGroupService.delete).mockResolvedValue(true as never);
    const r = await deleteCustomerGroupAction("c1", "grp1");
    expect(r.success).toBe(true);
  });

  it("grupo no encontrado → error", async () => {
    setMember("OWNER");
    vi.mocked(CustomerGroupService.delete).mockResolvedValue(false as never);
    const r = await deleteCustomerGroupAction("c1", "bad");
    expect(r.success).toBe(false);
  });
});
