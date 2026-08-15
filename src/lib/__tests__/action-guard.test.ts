// src/lib/__tests__/action-guard.test.ts
// Tests de los guards canónicos de Server Actions (ADR-041):
//   requireCompanyAction — actions CON empresa (auth → rl → membresía → rol → país → net)
//   requireUserAction    — actions SIN empresa, p.ej. el alta (ADR-043 D-4)
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

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn(),
  // ADR-041: el guard usa fiscalKey(companyId, userId) como identifier
  fiscalKey: (companyId: string, userId: string) => `${companyId}:${userId}`,
  // ADR-043 D-4: el alta de empresa usa limiter propio (fail-open), no `fiscal`.
  // Marcados: dos `{}` son deep-equal, y entonces "se llamó con ESTE limiter" no
  // afirmaría nada — cualquier confusión entre baldes pasaría desapercibida.
  limiters: { fiscal: { __limiter: "fiscal" }, companyCreate: { __limiter: "companyCreate" } },
}));

// headers() configurable por test — netContext real (@/lib/net-context NO se mockea,
// para cubrir la regla ADR-041 D-2: x-forwarded-for → .at(-1), nunca [0])
const mockHeaders = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers: mockHeaders }));

import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import type { Ratelimit } from "@upstash/ratelimit";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction, requireUserAction } from "@/lib/action-guard";

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
    // companyId autoritativo desde BD (ADR-004); country del mismo query (ADR-042 D-2)
    expect(prisma.companyMember.findFirst).toHaveBeenCalledWith({
      where: { companyId: COMPANY_ID, userId: USER_ID },
      select: { role: true, company: { select: { country: true } } },
    });
  });
});

describe("requireCompanyAction — país (paso 5, ADR-042 D-2)", () => {
  it("devuelve el country de la empresa cuando el query lo trae", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "ACCOUNTANT",
      company: { country: "VEN" },
    } as never);

    const ctx = await requireCompanyAction(COMPANY_ID, { roles: ROLES.ACCOUNTING });

    expect(ctx.ok).toBe(true);
    if (!ctx.ok) throw new Error("unreachable");
    expect(ctx.country).toBe("VEN");
  });

  it("mock legacy sin company anidada → fallback VEN (el único fallback silencioso)", async () => {
    // Los ~160 tests de actions existentes mockean findFirst con solo { role }.
    // Sin este fallback, TODOS romperían a la vez. Documentado en ADR-042.
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "ACCOUNTANT",
    } as never);

    const ctx = await requireCompanyAction(COMPANY_ID, { roles: ROLES.ACCOUNTING });

    expect(ctx.ok).toBe(true);
    if (!ctx.ok) throw new Error("unreachable");
    expect(ctx.country).toBe("VEN");
  });

  it("country no soportado en BD → fallback VEN en vez de tumbar la action", async () => {
    // getFiscalConfig SÍ lanza ante país no soportado; el guard no puede — dejaría
    // a la empresa entera sin ninguna action operativa.
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "ACCOUNTANT",
      company: { country: "XXX" },
    } as never);

    const ctx = await requireCompanyAction(COMPANY_ID, { roles: ROLES.ACCOUNTING });

    expect(ctx.ok).toBe(true);
    if (!ctx.ok) throw new Error("unreachable");
    expect(ctx.country).toBe("VEN");
  });

  it("LOW-1: un country corrupto NO se degrada en silencio — avisa a Sentry", async () => {
    // Degradar está bien; callar no. Un valor no soportado en BD es un incidente
    // de integridad: ninguna capa de la app debería haber podido escribirlo.
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "ACCOUNTANT",
      company: { country: "XXX" },
    } as never);

    await requireCompanyAction(COMPANY_ID, { roles: ROLES.ACCOUNTING });

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("no soportado"),
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({ companyId: COMPANY_ID, country: "XXX" }),
      }),
    );
  });

  it("LOW-1: el caso legítimo (mock legacy sin company) NO genera ruido en Sentry", async () => {
    // Si avisara también aquí, los ~160 tests legacy inundarían Sentry y la
    // señal dejaría de significar nada.
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "ACCOUNTANT",
    } as never);

    await requireCompanyAction(COMPANY_ID, { roles: ROLES.ACCOUNTING });

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
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
      country: "VEN",
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

// ══════════════════════════════════════════════════════════════════════════════
// requireUserAction — guard de actions SIN empresa (ADR-043 D-4)
// ══════════════════════════════════════════════════════════════════════════════

describe("requireUserAction — autenticación", () => {
  it("sin sesión → 'No autorizado' SIN tocar el limiter ni la BD", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const ctx = await requireUserAction({ limiter: limiters.companyCreate as Ratelimit });

    expect(ctx.ok).toBe(false);
    if (ctx.ok) throw new Error("unreachable");
    expect(ctx.error).toEqual({ success: false, error: "No autorizado" });
    // Quemar cuota de rate limit por peticiones anónimas sería un vector de DoS
    // contra el usuario legítimo dueño de esa clave.
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(mockHeaders).not.toHaveBeenCalled();
  });
});

describe("requireUserAction — rate limit", () => {
  it("la clave es user:<userId> de Clerk, NUNCA la IP (CGNAT móvil colisiona usuarios)", async () => {
    const ctx = await requireUserAction({ limiter: limiters.companyCreate as Ratelimit });

    expect(ctx.ok).toBe(true);
    expect(checkRateLimit).toHaveBeenCalledOnce();
    expect(checkRateLimit).toHaveBeenCalledWith(`user:${USER_ID}`, limiters.companyCreate);
    // No es fiscalKey(companyId, userId): aquí todavía no hay empresa
    expect(checkRateLimit).not.toHaveBeenCalledWith(
      expect.stringContaining(COMPANY_ID),
      expect.anything(),
    );
  });

  it("excedido → devuelve el error del limiter y NO sigue (no captura contexto de red)", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      error: "Demasiadas solicitudes. Intenta de nuevo en 42 segundos.",
    } as never);

    const ctx = await requireUserAction({
      limiter: limiters.companyCreate as Ratelimit,
      captureNet: true,
    });

    expect(ctx.ok).toBe(false);
    if (ctx.ok) throw new Error("unreachable");
    expect(ctx.error).toEqual({
      success: false,
      error: "Demasiadas solicitudes. Intenta de nuevo en 42 segundos.",
    });
    expect(mockHeaders).not.toHaveBeenCalled();
  });

  it("limiter omitido → no llama checkRateLimit", async () => {
    const ctx = await requireUserAction();

    expect(ctx.ok).toBe(true);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("checkRateLimit fail-open (Redis caído → allowed:true) → el guard deja pasar", async () => {
    // `companyCreate` falla ABIERTO a propósito (ADR-043 D-4): un hipo de Redis no
    // puede bloquear el alta de alguien que acaba de pagar. El invariante real —el
    // límite de plan— lo garantiza el guard Serializable de CompanyService.
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);

    const ctx = await requireUserAction({ limiter: limiters.companyCreate as Ratelimit });

    expect(ctx.ok).toBe(true);
  });
});

describe("requireUserAction — contexto de red (R-6) y contrato de salida", () => {
  it("captureNet:true → ipAddress + userAgent reales", async () => {
    headersWith({ "x-real-ip": "1.2.3.4", "user-agent": "vitest-agent/1.0" });

    const ctx = await requireUserAction({ captureNet: true });

    expect(ctx).toEqual({
      ok: true,
      userId: USER_ID,
      ipAddress: "1.2.3.4",
      userAgent: "vitest-agent/1.0",
    });
  });

  it("captureNet:true con x-forwarded-for → última IP (.at(-1), ADR-041 D-2)", async () => {
    headersWith({ "x-forwarded-for": "spoofeada, proxy-real" });

    const ctx = await requireUserAction({ captureNet: true });

    expect(ctx.ok).toBe(true);
    if (!ctx.ok) throw new Error("unreachable");
    expect(ctx.ipAddress).toBe("proxy-real");
  });

  it("captureNet omitido → nulls y NO llama headers()", async () => {
    const ctx = await requireUserAction();

    expect(ctx).toEqual({
      ok: true,
      userId: USER_ID,
      ipAddress: null,
      userAgent: null,
    });
    expect(mockHeaders).not.toHaveBeenCalled();
  });

  it("no consulta membresía: no hay empresa que evaluar (ni round-trip extra)", async () => {
    await requireUserAction({ limiter: limiters.companyCreate as Ratelimit, captureNet: true });

    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
  });
});


describe("rate limit sin mensaje propio → texto por defecto (ambos guards)", () => {
  // `checkRateLimit` siempre devuelve `error`, pero el tipo lo permite opcional:
  // el `??` es la red por si un limiter futuro no lo trae. Sin cubrirlo, ese
  // camino entregaría `undefined` como mensaje al usuario.
  beforeEach(() => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false } as never);
  });

  it("requireUserAction", async () => {
    const ctx = await requireUserAction({ limiter: limiters.companyCreate as Ratelimit });

    expect(ctx.ok).toBe(false);
    if (ctx.ok) throw new Error("unreachable");
    expect(ctx.error).toEqual({
      success: false,
      error: "Demasiadas solicitudes, intenta más tarde",
    });
  });

  it("requireCompanyAction", async () => {
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
  });
});
