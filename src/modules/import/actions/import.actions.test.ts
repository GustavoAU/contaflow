// src/modules/import/actions/import.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  fiscalKey: (c: string, u: string) => `${c}:${u}`,
  limiters: { fiscal: {}, ocr: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
  },
}));
vi.mock("../services/ImportService", () => ({
  ImportService: {
    importAccounts: vi.fn(),
    generateAccountsTemplate: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { ImportService } from "../services/ImportService";
import { importAccountsAction, downloadTemplateAction } from "./import.actions";
import type { ImportAccountRow } from "../schemas/import.schema";

const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const ADMIN_MEMBER = { role: "ADMIN" };

const SAMPLE_ROWS: ImportAccountRow[] = [
  { codigo: "1.1.01", nombre: "Caja", tipo: "ASSET" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: USER_ID });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
  vi.mocked(ImportService.importAccounts).mockResolvedValue({ created: 1, skipped: 0, errors: [] });
  vi.mocked(ImportService.generateAccountsTemplate).mockResolvedValue(Buffer.from("xlsx-data"));
});

// ─── importAccountsAction ─────────────────────────────────────────────────────

describe("importAccountsAction", () => {
  it("retorna error si no autenticado", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const r = await importAccountsAction(COMPANY_ID, USER_ID, SAMPLE_ROWS);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("retorna error si rate limit agotado", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, error: "Demasiadas solicitudes." });
    const r = await importAccountsAction(COMPANY_ID, USER_ID, SAMPLE_ROWS);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("Demasiadas");
  });

  it("retorna error si no es miembro de la empresa", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const r = await importAccountsAction(COMPANY_ID, USER_ID, SAMPLE_ROWS);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("Empresa no encontrada");
  });

  it("solo ADMIN puede importar cuentas", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    const r = await importAccountsAction(COMPANY_ID, USER_ID, SAMPLE_ROWS);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("autorizado");
  });

  it("retorna error si rows supera 1000", async () => {
    const bigRows = Array.from({ length: 1001 }, (_, i) => ({
      codigo: `1.1.${i}`,
      nombre: `Cuenta ${i}`,
      tipo: "ASSET" as const,
    }));
    const r = await importAccountsAction(COMPANY_ID, USER_ID, bigRows);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("1000");
  });

  it("happy path — retorna resultado de importación", async () => {
    vi.mocked(ImportService.importAccounts).mockResolvedValue({ created: 5, skipped: 2, errors: [] });
    const r = await importAccountsAction(COMPANY_ID, USER_ID, SAMPLE_ROWS);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.created).toBe(5);
      expect(r.data.skipped).toBe(2);
      expect(r.data.errors).toEqual([]);
    }
  });

  it("llama a ImportService.importAccounts con companyId y userId autenticado", async () => {
    await importAccountsAction(COMPANY_ID, "ignored-param", SAMPLE_ROWS);
    expect(ImportService.importAccounts).toHaveBeenCalledWith(COMPANY_ID, USER_ID, SAMPLE_ROWS);
  });

  it("retorna error estructurado si el service lanza", async () => {
    vi.mocked(ImportService.importAccounts).mockRejectedValue(new Error("DB error"));
    const r = await importAccountsAction(COMPANY_ID, USER_ID, SAMPLE_ROWS);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBeTruthy();
  });
});

// ─── downloadTemplateAction ───────────────────────────────────────────────────

describe("downloadTemplateAction", () => {
  it("retorna error si no autenticado", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const r = await downloadTemplateAction();
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("happy path — retorna base64 del template", async () => {
    vi.mocked(ImportService.generateAccountsTemplate).mockResolvedValue(Buffer.from("xlsx") as never);
    const r = await downloadTemplateAction();
    expect(r.success).toBe(true);
    if (r.success) {
      expect(typeof r.data).toBe("string");
      expect(r.data.length).toBeGreaterThan(0);
    }
  });

  it("retorna error estructurado si el service lanza", async () => {
    vi.mocked(ImportService.generateAccountsTemplate).mockRejectedValue(new Error("Template error"));
    const r = await downloadTemplateAction();
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBeTruthy();
  });
});
