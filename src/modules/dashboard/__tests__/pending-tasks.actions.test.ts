// src/modules/dashboard/__tests__/pending-tasks.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  limiters: { fiscal: {}, ocr: {}, read: {} },  fiscalKey: (c: string, u: string) => `${c}:${u}`,
}));
vi.mock("@/lib/prisma", () => ({
  default: { companyMember: { findFirst: vi.fn() } },
}));
vi.mock("../services/PendingTasksService", () => ({
  PendingTasksService: {
    getPendingTasks: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { PendingTasksService } from "../services/PendingTasksService";
import { getPendingTasksAction } from "../actions/pending-tasks.actions";

const COMPANY_ID = "company-test";
const USER_ID = "user-test";

const EMPTY_TASKS = { tasks: [], totalCount: 0 };
const TASKS_WITH_ERROR = {
  tasks: [
    {
      type: "INVOICES_SIN_CAUSAR" as const,
      severity: "error" as const,
      title: "Facturas sin asiento contable",
      description: "2 facturas no han sido causadas.",
      count: 2,
      href: "/invoices",
    },
  ],
  totalCount: 2,
};

function setupAuth(userId: string | null = USER_ID) {
  mockAuth.mockResolvedValue({ userId });
}
function setupMember(role = "ACCOUNTANT") {
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role } as never);
}
function setupNoMember() {
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);
}
function setupRateLimit(allowed = true) {
  mockCheckRateLimit.mockResolvedValue({ allowed });
}

describe("getPendingTasksAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
    setupMember();
    setupRateLimit();
    vi.mocked(PendingTasksService.getPendingTasks).mockResolvedValue(EMPTY_TASKS as never);
  });

  // ─── Auth guard ─────────────────────────────────────────────────────────────
  it("26B-01 auth: devuelve error si no hay userId", async () => {
    setupAuth(null);
    const result = await getPendingTasksAction(COMPANY_ID);
    expect(result.success).toBe(false);
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
  });

  // ─── IDOR guard ──────────────────────────────────────────────────────────────
  it("26B-01 IDOR: devuelve error si usuario no es miembro de la empresa", async () => {
    setupNoMember();
    const result = await getPendingTasksAction(COMPANY_ID);
    expect(result.success).toBe(false);
    expect(PendingTasksService.getPendingTasks).not.toHaveBeenCalled();
  });

  it("26B-01 IDOR: companyMember se consulta con el companyId correcto", async () => {
    await getPendingTasksAction("empresa-xyz");
    expect(prisma.companyMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: "empresa-xyz", userId: USER_ID },
      }),
    );
  });

  // ─── Role guard ──────────────────────────────────────────────────────────────
  it("26B-05 rol: VIEWER no puede ver tareas pendientes", async () => {
    setupMember("VIEWER");
    const result = await getPendingTasksAction(COMPANY_ID);
    expect(result.success).toBe(false);
  });

  it("26B-05 rol: ADMINISTRATIVE no puede ver tareas pendientes", async () => {
    setupMember("ADMINISTRATIVE");
    const result = await getPendingTasksAction(COMPANY_ID);
    expect(result.success).toBe(false);
  });

  // ─── Rate limit ──────────────────────────────────────────────────────────────
  it("devuelve error cuando el rate limit fiscal está agotado", async () => {
    setupRateLimit(false);
    const result = await getPendingTasksAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/solicitudes/i);
    expect(PendingTasksService.getPendingTasks).not.toHaveBeenCalled();
  });

  // ─── Success flows ───────────────────────────────────────────────────────────
  it("ACCOUNTANT puede obtener tareas pendientes vacías", async () => {
    const result = await getPendingTasksAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tasks).toHaveLength(0);
      expect(result.data.aiSummary).toBeNull();
    }
  });

  it("OWNER puede obtener tareas pendientes", async () => {
    setupMember("OWNER");
    vi.mocked(PendingTasksService.getPendingTasks).mockResolvedValue(TASKS_WITH_ERROR as never);
    const result = await getPendingTasksAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tasks).toHaveLength(1);
      expect(result.data.tasks[0].type).toBe("INVOICES_SIN_CAUSAR");
    }
  });

  it("ADMIN puede obtener tareas pendientes", async () => {
    setupMember("ADMIN");
    const result = await getPendingTasksAction(COMPANY_ID);
    expect(result.success).toBe(true);
  });

  it("no llama a Gemini cuando no hay tareas pendientes", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    await getPendingTasksAction(COMPANY_ID);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("26B-03 rate limit OCR: no llama a Gemini si limiters.ocr está agotado", async () => {
    vi.mocked(PendingTasksService.getPendingTasks).mockResolvedValue(TASKS_WITH_ERROR as never);
    // fiscal: allowed, ocr: blocked
    mockCheckRateLimit
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false });
    const fetchSpy = vi.spyOn(global, "fetch");
    const result = await getPendingTasksAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.aiSummary).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("graceful fallback: si Gemini falla devuelve tareas sin resumen IA", async () => {
    vi.mocked(PendingTasksService.getPendingTasks).mockResolvedValue(TASKS_WITH_ERROR as never);
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("Network error"));
    const result = await getPendingTasksAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tasks).toHaveLength(1);
      expect(result.data.aiSummary).toBeNull();
    }
  });

  it("llama a Gemini cuando hay tareas y GEMINI_API_KEY está configurada", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(PendingTasksService.getPendingTasks).mockResolvedValue(TASKS_WITH_ERROR as never);
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
    } as Response);
    const result = await getPendingTasksAction(COMPANY_ID);
    delete process.env.GEMINI_API_KEY;
    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
    if (result.success) expect(result.data.aiSummary).toBeNull(); // ok:false → null
  });

  it("devuelve error estructurado si PendingTasksService lanza excepción", async () => {
    vi.mocked(PendingTasksService.getPendingTasks).mockRejectedValueOnce(
      new Error("DB no disponible"),
    );
    const result = await getPendingTasksAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });
});
