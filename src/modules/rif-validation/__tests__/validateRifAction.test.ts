// src/modules/rif-validation/__tests__/validateRifAction.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_test" }),
}));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {}, ocr: {}, rif: {} },
  redis: null,
}));

vi.mock("@/lib/prisma", () => {
  const prisma = {
    companyMember: { findFirst: vi.fn() },
  };
  return { default: prisma };
});

// Mock fetch para SENIAT scraper
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Importar después de mocks
import { validateRifAction } from "../actions/validateRifAction";
import { auth } from "@clerk/nextjs/server";
import { checkRateLimit } from "@/lib/ratelimit";
import prisma from "@/lib/prisma";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seniatHtmlWithName(name: string): Response {
  const html = `<html><body>
    <table><tr>
      <td>DENOMINACIÓN SOCIAL</td>
      <td>${name}</td>
    </tr></table>
  </body></html>`;
  return new Response(html, { status: 200 });
}

function seniatEmpty(): Response {
  return new Response("<html><body>No encontrado</body></html>", { status: 200 });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("validateRifAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user_test" } as never);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    // Por defecto SENIAT no disponible (timeout simulado con error de red)
    mockFetch.mockRejectedValue(new Error("Network error"));
  });

  // ─── Auth / seguridad ────────────────────────────────────────────────────────

  it("sin sesión → error No autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const result = await validateRifAction("cmp_test", "J-12345678-9");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("rate limit excedido → error", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      error: "Demasiadas solicitudes. Intenta más tarde.",
    } as never);
    const result = await validateRifAction("cmp_test", "J-12345678-9");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("solicitudes");
  });

  it("empresa no encontrada / acceso denegado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);
    const result = await validateRifAction("cmp_test", "J-12345678-9");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("denegado");
  });

  it("VIEWER puede verificar RIF (operación de lectura)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const result = await validateRifAction("cmp_test", "J-12345678-9");
    expect(result.success).toBe(true);
  });

  // ─── Validación de formato ───────────────────────────────────────────────────

  it("RIF formato inválido → formatValid: false, sin llamar SENIAT", async () => {
    const result = await validateRifAction("cmp_test", "INVALIDO");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.formatValid).toBe(false);
      expect(result.data.seniatVerified).toBe(false);
      expect(result.data.legalName).toBeNull();
    }
    // No se debería haber llamado a fetch
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("RIF sin dígito verificador sigue siendo válido", async () => {
    const result = await validateRifAction("cmp_test", "J-12345678");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.formatValid).toBe(true);
  });

  it("RIF lowercase es normalizado y validado", async () => {
    const result = await validateRifAction("cmp_test", "j-12345678-9");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.formatValid).toBe(true);
  });

  it("RIF con prefijo V (persona natural) es válido", async () => {
    const result = await validateRifAction("cmp_test", "V-12345678-0");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.formatValid).toBe(true);
  });

  // ─── SENIAT scraping ─────────────────────────────────────────────────────────

  it("SENIAT responde con razón social → seniatVerified: true + legalName", async () => {
    mockFetch.mockResolvedValue(seniatHtmlWithName("EMPRESA EJEMPLO C.A."));
    const result = await validateRifAction("cmp_test", "J-12345678-9");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.formatValid).toBe(true);
      expect(result.data.seniatVerified).toBe(true);
      expect(result.data.legalName).toBe("EMPRESA EJEMPLO C.A.");
    }
  });

  it("SENIAT responde sin nombre reconocible → seniatVerified: false, formatValid: true", async () => {
    mockFetch.mockResolvedValue(seniatEmpty());
    const result = await validateRifAction("cmp_test", "J-12345678-9");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.formatValid).toBe(true);
      expect(result.data.seniatVerified).toBe(false);
      expect(result.data.legalName).toBeNull();
    }
  });

  it("SENIAT timeout (AbortError) → fallback graceful, no bloquea", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    mockFetch.mockRejectedValue(abortError);
    const result = await validateRifAction("cmp_test", "J-12345678-9");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.formatValid).toBe(true);
      expect(result.data.seniatVerified).toBe(false);
    }
  });

  it("SENIAT error de red → fallback graceful, no lanza excepción", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await validateRifAction("cmp_test", "J-12345678-9");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.formatValid).toBe(true);
      expect(result.data.seniatVerified).toBe(false);
    }
  });

  it("SENIAT HTTP 500 → fallback graceful", async () => {
    mockFetch.mockResolvedValue(new Response("Server Error", { status: 500 }));
    const result = await validateRifAction("cmp_test", "J-12345678-9");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.formatValid).toBe(true);
      expect(result.data.seniatVerified).toBe(false);
    }
  });
});
