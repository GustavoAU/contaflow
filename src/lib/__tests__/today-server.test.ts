// src/lib/__tests__/today-server.test.ts
// MP-4 (ADR-042) — "hoy" en la zona del país de la empresa, para código de servidor.
//
// Lo que más importa aquí NO es la fecha: es que `todayForCompany` lea SCOPED por
// membresía. En los cinco reports esta llamada ocurre ANTES del check de
// autorización (el redirect precede a la action), así que un
// `company.findUnique({ id })` habría dejado que cualquier usuario autenticado
// provocara la lectura de la fila de una empresa ajena (ADR-004).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { todayForCompany, todayForCountry } from "../today-server";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    company: { findUnique: vi.fn() },
  },
}));

const COMPANY_ID = "company-1";
const USER_ID = "user-1";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as never);
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
    company: { country: "VEN" },
  } as never);
});

describe("todayForCountry", () => {
  it("devuelve YYYY-MM-DD para un país soportado", () => {
    expect(todayForCountry("VEN")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("país no soportado degrada a VEN en vez de lanzar", () => {
    // getFiscalConfig SÍ lanza; este wrapper no puede, porque alimenta un render
    expect(() => todayForCountry("XXX")).not.toThrow();
    expect(todayForCountry("XXX")).toBe(todayForCountry("VEN"));
  });
});

describe("todayForCompany — aislamiento multi-tenant (ADR-004)", () => {
  it("lee el país SCOPED por membresía, nunca company.findUnique(id)", async () => {
    await todayForCompany(COMPANY_ID);

    expect(prisma.companyMember.findFirst).toHaveBeenCalledWith({
      where: { companyId: COMPANY_ID, userId: USER_ID },
      select: { company: { select: { country: true } } },
    });
    // La regresión que este test bloquea: leer la fila de Company directamente
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
  });

  it("no-miembro → null → VEN, sin tocar datos de la empresa ajena", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    const today = await todayForCompany("empresa-ajena");

    expect(today).toBe(todayForCountry("VEN"));
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
  });

  it("sin sesión → VEN sin consultar la BD", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const today = await todayForCompany(COMPANY_ID);

    expect(today).toBe(todayForCountry("VEN"));
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
  });

  it("fallo de BD → VEN, no tumba el render de la página", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockRejectedValue(new Error("cold start"));

    await expect(todayForCompany(COMPANY_ID)).resolves.toBe(todayForCountry("VEN"));
  });
});
