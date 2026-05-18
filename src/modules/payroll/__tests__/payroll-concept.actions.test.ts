// src/modules/payroll/__tests__/payroll-concept.actions.test.ts
// Tests: NOM-B concept actions — ADMIN_ONLY write / ACCOUNTING read

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user-test" }),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("../services/PayrollConceptService", () => ({
  PayrollConceptService: {
    list: vi.fn().mockResolvedValue([]),
    seedDefaults: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

import { auth } from "@clerk/nextjs/server";
import { PayrollConceptService } from "../services/PayrollConceptService";
import {
  listConceptsAction,
  createConceptAction,
  updateConceptAction,
  deleteConceptAction,
} from "../actions/payroll-concept.actions";

const COMPANY_ID = "company-test";
const CONCEPT_ID = "concept-1";

const BASE_CONCEPT = {
  id: CONCEPT_ID,
  companyId: COMPANY_ID,
  code: "BONO_ESP",
  name: "Bono Especial",
  type: "EARNING" as const,
  isSystem: false,
  isActive: true,
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: "user-test" } as never);
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ADMIN" } as never);
  vi.mocked(PayrollConceptService.seedDefaults).mockResolvedValue(undefined);
});

// ─── listConceptsAction ────────────────────────────────────────────────────

describe("listConceptsAction", () => {
  it("ADMIN — lists concepts and seeds defaults", async () => {
    vi.mocked(PayrollConceptService.list).mockResolvedValue([BASE_CONCEPT]);
    const result = await listConceptsAction(COMPANY_ID);
    expect(result.success).toBe(true);
    expect(PayrollConceptService.seedDefaults).toHaveBeenCalledWith(COMPANY_ID);
    if (result.success) expect(result.data).toHaveLength(1);
  });

  it("ACCOUNTANT — can list concepts (ACCOUNTING role)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(PayrollConceptService.list).mockResolvedValue([]);
    const result = await listConceptsAction(COMPANY_ID);
    expect(result.success).toBe(true);
  });

  it("no userId → No autorizado (NOM-B-01)", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const result = await listConceptsAction(COMPANY_ID);
    expect(result.success).toBe(false);
  });

  it("no membership → No autorizado (NOM-B-01 IDOR)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await listConceptsAction(COMPANY_ID);
    expect(result.success).toBe(false);
  });

  it("VIEWER → Acceso denegado (ACCOUNTING required)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const result = await listConceptsAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Acceso denegado");
  });

  it("ADMINISTRATIVE → Acceso denegado (not in ACCOUNTING)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "ADMINISTRATIVE",
    } as never);
    const result = await listConceptsAction(COMPANY_ID);
    expect(result.success).toBe(false);
  });
});

// ─── createConceptAction ───────────────────────────────────────────────────

describe("createConceptAction", () => {
  it("ADMIN — creates concept", async () => {
    vi.mocked(PayrollConceptService.create).mockResolvedValue(BASE_CONCEPT);
    const result = await createConceptAction(COMPANY_ID, {
      code: "BONO_ESP",
      name: "Bono Especial",
      type: "EARNING",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.code).toBe("BONO_ESP");
  });

  it("ACCOUNTANT → sin permiso ADMIN_ONLY (NOM-B-04)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    const result = await createConceptAction(COMPANY_ID, {
      code: "BONO_ESP",
      name: "Bono Especial",
      type: "EARNING",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Administrador");
  });

  it("invalid code (lowercase) → Zod error", async () => {
    const result = await createConceptAction(COMPANY_ID, {
      code: "bono_esp",
      name: "Bono",
      type: "EARNING",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("mayúsculas");
  });

  it("code too short → Zod error", async () => {
    const result = await createConceptAction(COMPANY_ID, {
      code: "A",
      name: "X",
      type: "EARNING",
    });
    expect(result.success).toBe(false);
  });

  it("P2002 → código duplicado", async () => {
    vi.mocked(PayrollConceptService.create).mockRejectedValue(new Error("P2002: duplicate"));
    const result = await createConceptAction(COMPANY_ID, {
      code: "BONO_ESP",
      name: "Bono",
      type: "EARNING",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("código");
  });

  it("no userId → No autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const result = await createConceptAction(COMPANY_ID, {
      code: "BONO_ESP",
      name: "Bono",
      type: "EARNING",
    });
    expect(result.success).toBe(false);
  });
});

// ─── updateConceptAction ───────────────────────────────────────────────────

describe("updateConceptAction", () => {
  it("ADMIN — updates concept (toggle inactive)", async () => {
    vi.mocked(PayrollConceptService.update).mockResolvedValue({ ...BASE_CONCEPT, isActive: false });
    const result = await updateConceptAction(COMPANY_ID, CONCEPT_ID, {
      name: "Bono Especial",
      isActive: false,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isActive).toBe(false);
  });

  it("ACCOUNTANT → sin permiso", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    const result = await updateConceptAction(COMPANY_ID, CONCEPT_ID, {
      name: "X",
      isActive: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Administrador");
  });

  it("no userId → No autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const result = await updateConceptAction(COMPANY_ID, CONCEPT_ID, {
      name: "X",
      isActive: true,
    });
    expect(result.success).toBe(false);
  });
});

// ─── deleteConceptAction ───────────────────────────────────────────────────

describe("deleteConceptAction", () => {
  it("ADMIN — deletes non-system concept", async () => {
    vi.mocked(PayrollConceptService.delete).mockResolvedValue(undefined);
    const result = await deleteConceptAction(COMPANY_ID, CONCEPT_ID);
    expect(result.success).toBe(true);
  });

  it("ACCOUNTANT → sin permiso (NOM-B-04)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    const result = await deleteConceptAction(COMPANY_ID, CONCEPT_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Administrador");
  });

  it("service throws system guard → error propagated", async () => {
    vi.mocked(PayrollConceptService.delete).mockRejectedValue(
      new Error("Los conceptos del sistema no se pueden eliminar")
    );
    const result = await deleteConceptAction(COMPANY_ID, CONCEPT_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("sistema");
  });

  it("no membership → No autorizado (NOM-B-01)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await deleteConceptAction(COMPANY_ID, CONCEPT_ID);
    expect(result.success).toBe(false);
  });
});
