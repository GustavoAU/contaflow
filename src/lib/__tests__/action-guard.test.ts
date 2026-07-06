// src/lib/__tests__/action-guard.test.ts
// Tests del guard canónico de Server Actions (ADR-041) — requireCompanyAction.
// Environment: node (global). canAccess NO se mockea: es lógica pura (auth-helpers).

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn(),
  // ADR-041: el guard usa fiscalKey(companyId, userId) como identifier
  fiscalKey: (companyId: string, userId: string) => `${companyId}:${userId}`,
  limiters: { fiscal: {} },
}));

// headers() configurable por test — netContext real (@/lib/net-context NO se mockea,
// para cubrir la regla ADR-041 D-2: x-forwarded-for → .at(-1), nunca [0])
const mockHeaders = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers: mockHeaders }));

import { auth } from "@clerk/nextjs/server";
import type { Ratelimit } from "@upstash/ratelimit";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";

const COMPANY_ID = "company-1";
const USER_ID = "user-1";

/** headers() de Next devuelve un objeto con .get(name) */
function headersWith(map: Record<string, string>) {
  mockHeaders.mockResolvedValue({
    get: (name: string) => map[name.toLowerCase()] ?? null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as never);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
    role: "ACCOUNTANT",
  } as never);
  headersWith({});
});

describe("requireCompanyAction — autenticación (paso 1)", () => {
  it("auth sin userId → fail 'No autorizado' y NO consulta rate limit ni BD", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const ctx = await requireCompanyAction(COMPANY_ID, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal as Ratelimit,
    });

    expect(ctx.ok).toBe(false);
    if (ctx.ok) throw new Error("unreachable");
    expect(ctx.error).toEqual({ success: false, error: "No autorizado" });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
  });
});

describe("requireCompanyAction — rate limit (paso 2)", () => {
  it("rate limited → fail con el error del limiter, key = fiscalKey(companyId, userId), NO consulta BD", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      error: "Demasiadas solicitudes, intenta más tarde",
    } as never);

    const ctx = await requireCompanyAction(COMPANY_ID, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal as Ratelimit,
    });

    expect(ctx.ok).toBe(false);
    if (ctx.ok) throw new Error("unreachable");
    expect(ctx.error).toEqual({
      success: false,
      error: "Demasiadas solicitudes, intenta más tarde",
    });
    // Cuota por (empresa × usuario) — cierra la deuda técnica de ratelimit.ts
    expect(checkRateLimit).toHaveBeenCalledWith("company-1:user-1", limiters.fiscal);
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
  });

  it("limiter omitido → NO llama checkRateLimit (lecturas baratas)", async () => {
    const ctx = await requireCompanyAction(COMPANY_ID, { roles: ROLES.ACCOUNTING });

    expect(ctx.ok).toBe(true);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});

describe("requireCompanyAction — membresía (paso 3)", () => {
  it("miembro inexistente → fail 'Empresa no encontrada o acceso denegado'", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    const ctx = await requireCompanyAction(COMPANY_ID, { roles: ROLES.ACCOUNTING });

    expect(ctx.ok).toBe(false);
    if (ctx.ok) throw new Error("unreachable");
    expect(ctx.error).toEqual({
      success: false,
      error: "Empresa no encontrada o acceso denegado",
    });
    // companyId autoritativo desde BD (ADR-004)
    expect(prisma.companyMember.findFirst).toHaveBeenCalledWith({
      where: { companyId: COMPANY_ID, userId: USER_ID },
      select: { role: true },
    });
  });
});

describe("requireCompanyAction — rol (paso 4, canAccess REAL)", () => {
  it("roles=ACCOUNTING con rol ADMINISTRATIVE → fail 'No autorizado' (D-1 ADR-006)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "ADMINISTRATIVE",
    } as never);

    const ctx = await requireCompanyAction(COMPANY_ID, { roles: ROLES.ACCOUNTING });

    expect(ctx.ok).toBe(false);
    if (ctx.ok) throw new Error("unreachable");
    expect(ctx.error).toEqual({ success: false, error: "No autorizado" });
  });

  it("roles=ACCOUNTING con rol ACCOUNTANT → ok:true con userId y role exactos", async () => {
    const ctx = await requireCompanyAction(COMPANY_ID, { roles: ROLES.ACCOUNTING });

    expect(ctx).toEqual({
      ok: true,
      userId: USER_ID,
      role: "ACCOUNTANT",
      ipAddress: null,
      userAgent: null,
    });
  });

  it('roles: "MEMBER_ANY" con rol SENIAT → ok:true (solo membresía — preserva lecturas legacy)', async () => {
    // security-agent MEDIUM: roles es OBLIGATORIO — el sentinel explícito reemplaza
    // la omisión silenciosa; una mutación sin roles ya no compila.
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "SENIAT",
    } as never);

    const ctx = await requireCompanyAction(COMPANY_ID, { roles: "MEMBER_ANY" });

    expect(ctx.ok).toBe(true);
    if (!ctx.ok) throw new Error("unreachable");
    expect(ctx.role).toBe("SENIAT");
  });
});

describe("requireCompanyAction — contexto de red (paso 5, R-6)", () => {
  it("captureNet:true → ipAddress de x-real-ip y userAgent de headers", async () => {
    headersWith({ "x-real-ip": "1.2.3.4", "user-agent": "vitest-agent/1.0" });

    const ctx = await requireCompanyAction(COMPANY_ID, {
      roles: ROLES.ACCOUNTING,
      captureNet: true,
    });

    expect(ctx.ok).toBe(true);
    if (!ctx.ok) throw new Error("unreachable");
    expect(ctx.ipAddress).toBe("1.2.3.4");
    expect(ctx.userAgent).toBe("vitest-agent/1.0");
  });

  it("captureNet omitido → ipAddress/userAgent null y NO llama headers()", async () => {
    const ctx = await requireCompanyAction(COMPANY_ID, { roles: ROLES.ACCOUNTING });

    expect(ctx.ok).toBe(true);
    if (!ctx.ok) throw new Error("unreachable");
    expect(ctx.ipAddress).toBeNull();
    expect(ctx.userAgent).toBeNull();
    expect(mockHeaders).not.toHaveBeenCalled();
  });

  it("x-forwarded-for 'cliente, proxy' sin x-real-ip → toma la ÚLTIMA IP (.at(-1), ADR-041 D-2)", async () => {
    // La primera IP la escribe el cliente (spoofeable); la última la añade nuestro proxy
    headersWith({ "x-forwarded-for": "cliente, proxy" });

    const ctx = await requireCompanyAction(COMPANY_ID, {
      roles: ROLES.ACCOUNTING,
      captureNet: true,
    });

    expect(ctx.ok).toBe(true);
    if (!ctx.ok) throw new Error("unreachable");
    expect(ctx.ipAddress).toBe("proxy");
  });
});
