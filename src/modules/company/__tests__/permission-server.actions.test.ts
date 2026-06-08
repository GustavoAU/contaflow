// src/modules/company/__tests__/permission-server.actions.test.ts
// Tests for the Server Actions in permission.actions.ts (getGrants, grant, revoke).
// The pure-logic tests for hasBaseAccess/canAccessModule live in permission.actions.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    rolePermission: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/ratelimit";
import {
  getGrantsAction,
  grantPermissionAction,
  revokePermissionAction,
} from "../actions/permission.actions";

const COMPANY_ID = "co-1";
const USER_ID = "user-1";

function setAuth(userId: string | null) {
  mockAuth.mockResolvedValue({ userId });
}
function setMember(role: string | null) {
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(
    role ? ({ role } as never) : (null as never),
  );
}
function setTx() {
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  setTx();
});

// ── getGrantsAction ───────────────────────────────────────────────────────────

describe("getGrantsAction", () => {
  it("retorna grants para OWNER", async () => {
    setAuth(USER_ID);
    setMember("OWNER");
    vi.mocked(prisma.rolePermission.findMany).mockResolvedValue([
      { role: "ACCOUNTANT", module: "payroll" } as never,
    ]);

    const r = await getGrantsAction(COMPANY_ID);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toHaveLength(1);
  });

  it("rechaza si no autenticado", async () => {
    setAuth(null);
    const r = await getGrantsAction(COMPANY_ID);
    expect(r.success).toBe(false);
  });

  it("rechaza ACCOUNTANT (requiere ADMIN_ONLY)", async () => {
    setAuth(USER_ID);
    setMember("ACCOUNTANT");
    const r = await getGrantsAction(COMPANY_ID);
    expect(r.success).toBe(false);
  });

  it("rechaza si no es miembro (IDOR)", async () => {
    setAuth(USER_ID);
    setMember(null);
    const r = await getGrantsAction(COMPANY_ID);
    expect(r.success).toBe(false);
  });
});

// ── grantPermissionAction ─────────────────────────────────────────────────────

describe("grantPermissionAction", () => {
  beforeEach(() => {
    setAuth(USER_ID);
    setMember("ADMIN");
    vi.mocked(prisma.rolePermission.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("concede permiso correctamente", async () => {
    const r = await grantPermissionAction({
      companyId: COMPANY_ID,
      role: "ACCOUNTANT",
      module: "payroll",
    });
    expect(r.success).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("rechaza si no autenticado", async () => {
    setAuth(null);
    const r = await grantPermissionAction({
      companyId: COMPANY_ID,
      role: "ACCOUNTANT",
      module: "payroll",
    });
    expect(r.success).toBe(false);
  });

  it("rechaza rol OWNER como target (schema guard)", async () => {
    const r = await grantPermissionAction({
      companyId: COMPANY_ID,
      role: "OWNER" as never,
      module: "payroll",
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("inválidos");
  });

  it("rechaza si rate limit excedido", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, error: "Demasiadas solicitudes. Intenta más tarde." });
    const r = await grantPermissionAction({
      companyId: COMPANY_ID,
      role: "ACCOUNTANT",
      module: "payroll",
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("Demasiadas");
  });
});

// ── revokePermissionAction ────────────────────────────────────────────────────

describe("revokePermissionAction", () => {
  beforeEach(() => {
    setAuth(USER_ID);
    setMember("ADMIN");
    vi.mocked(prisma.rolePermission.deleteMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("revoca permiso correctamente", async () => {
    const r = await revokePermissionAction({
      companyId: COMPANY_ID,
      role: "ACCOUNTANT",
      module: "payroll",
    });
    expect(r.success).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("rechaza ACCOUNTANT (requiere ADMIN_ONLY)", async () => {
    setMember("ACCOUNTANT");
    const r = await revokePermissionAction({
      companyId: COMPANY_ID,
      role: "VIEWER",
      module: "banking",
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("ADMIN");
  });
});
