// src/modules/ai-assistant/__tests__/ai-assistant.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockBuildContext = vi.hoisted(() => vi.fn());
const mockBuildSystemPrompt = vi.hoisted(() => vi.fn());
const mockDetect = vi.hoisted(() => vi.fn());
const mockFormatForPrompt = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  limiters: { fiscal: {}, ocr: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: { companyMember: { findFirst: vi.fn() } },
}));
vi.mock("../services/AIContextBuilderService", () => ({
  AIContextBuilderService: {
    buildContext: mockBuildContext,
    buildSystemPrompt: mockBuildSystemPrompt,
  },
}));
vi.mock("../services/FiscalAnomalyDetectorService", () => ({
  FiscalAnomalyDetectorService: {
    detect: mockDetect,
    formatForPrompt: mockFormatForPrompt,
  },
}));

import prisma from "@/lib/prisma";
import { sendMessageAction } from "../actions/ai-assistant.actions";

const COMPANY_ID = "company-test";
const USER_ID = "user-test";

const EMPTY_CTX = {
  companyName: "Test",
  pendingTasks: [],
  // resto de campos no importan para los tests de la action
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

describe("sendMessageAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
    setupMember();
    setupRateLimit();
    mockBuildContext.mockResolvedValue(EMPTY_CTX);
    mockBuildSystemPrompt.mockReturnValue("system prompt");
    mockDetect.mockResolvedValue({
      companyId: COMPANY_ID,
      detectedAt: new Date(),
      anomalies: [],
      totalCritical: 0,
      totalHigh: 0,
      totalMedium: 0,
      clean: true,
    });
    mockFormatForPrompt.mockReturnValue("AUDITORÍA CONTABLE: No se detectaron anomalías.");
  });

  // ─── Auth guard ───────────────────────────────────────────────────────────────
  it("26-01 auth: devuelve error si no hay userId", async () => {
    setupAuth(null);
    const result = await sendMessageAction(COMPANY_ID, "Hola");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autenticado");
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
  });

  // ─── IDOR guard ───────────────────────────────────────────────────────────────
  it("26-01 IDOR: devuelve error si usuario no es miembro", async () => {
    setupNoMember();
    const result = await sendMessageAction(COMPANY_ID, "Hola");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Sin acceso");
  });

  // ─── Role guard ───────────────────────────────────────────────────────────────
  it("26-05 rol: VIEWER no puede usar el asistente", async () => {
    setupMember("VIEWER");
    const result = await sendMessageAction(COMPANY_ID, "Hola");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Rol insuficiente");
  });

  it("26-05 rol: ADMINISTRATIVE no puede usar el asistente", async () => {
    setupMember("ADMINISTRATIVE");
    const result = await sendMessageAction(COMPANY_ID, "Hola");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Rol insuficiente");
  });

  // ─── Rate limit ───────────────────────────────────────────────────────────────
  it("26-03 rate limit: devuelve error si ocr está agotado", async () => {
    setupRateLimit(false);
    const result = await sendMessageAction(COMPANY_ID, "Hola");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/límite/i);
  });

  // ─── Sin API key ──────────────────────────────────────────────────────────────
  it("sin GEMINI_API_KEY: devuelve aviso en lugar de null", async () => {
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const result = await sendMessageAction(COMPANY_ID, "¿cuánto IVA?");
    expect(result.success).toBe(true);
    if (result.success) expect(result.reply).toBeTruthy();
    process.env.GEMINI_API_KEY = original;
  });

  it("sin GEMINI_API_KEY + modo auditoría: devuelve reporte del detector de anomalías", async () => {
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    mockFormatForPrompt.mockReturnValue("AUDITORÍA CONTABLE: 1 CRÍTICO | ASIENTO_DESCUADRADO");
    const result = await sendMessageAction(COMPANY_ID, "auditar el período actual");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.isAuditMode).toBe(true);
      expect(result.reply).toContain("AUDITORÍA CONTABLE");
      expect(mockDetect).toHaveBeenCalledWith(COMPANY_ID);
    }
    process.env.GEMINI_API_KEY = original;
  });

  // ─── Graceful fallback ────────────────────────────────────────────────────────
  it("graceful fallback: si Gemini falla devuelve mensaje de error amigable", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("Network error"));
    const result = await sendMessageAction(COMPANY_ID, "¿cuánto IVA?");
    expect(result.success).toBe(true);
    if (result.success) expect(result.reply).toBeTruthy();
  });

  // ─── Detección modo auditoría ─────────────────────────────────────────────────
  it("detecta modo auditoría por keyword 'auditar'", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("fail"));
    const result = await sendMessageAction(COMPANY_ID, "quiero auditar el período");
    expect(result.success).toBe(true);
    if (result.success) expect(result.isAuditMode).toBe(true);
  });

  // ─── ACCOUNTANT puede usar el asistente ───────────────────────────────────────
  it("ACCOUNTANT puede enviar mensajes", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Respuesta del asistente" }] } }],
      }),
    } as never);
    const result = await sendMessageAction(COMPANY_ID, "¿cuánto IVA?");
    expect(result.success).toBe(true);
    if (result.success) expect(result.reply).toBe("Respuesta del asistente");
  });
});
