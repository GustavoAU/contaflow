// src/lib/__tests__/company-page-guard.test.ts
//
// MEDIUM-2 (auditoría MP-4) — aislamiento multi-tenant en page components.
//
// El invariante que se prueba no es "redirige al no-miembro" sino algo más
// fuerte: que la fila de la empresa **nunca se lee** para un no-miembro. Esa es
// la diferencia entre autorizar y solo ocultar: el patrón anterior
// (`company.findUnique({ where: { id: companyId } })` + check aparte) traía la
// fila ajena a memoria y dependía de un redirect en OTRO archivo para no
// entregarla.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { requireCompanyPage } from "../company-page-guard";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    // El redirect real lanza para abortar el render; se replica para que el
    // código posterior al guard no siga ejecutándose en el test.
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    company: { findUnique: vi.fn(), findFirst: vi.fn() },
  },
}));

const COMPANY_ID = "company-1";
const USER_ID = "user-1";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as never);
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
    role: "ACCOUNTANT",
    company: { name: "Acme C.A." },
  } as never);
});

describe("requireCompanyPage", () => {
  it("devuelve los campos pedidos leyéndolos A TRAVÉS de la membresía", async () => {
    const { company, role, userId } = await requireCompanyPage(COMPANY_ID, { name: true });

    expect(company).toEqual({ name: "Acme C.A." });
    expect(role).toBe("ACCOUNTANT");
    expect(userId).toBe(USER_ID);

    // companyId Y userId en el MISMO where — es lo que hace imposible traer la
    // fila de otro tenant, en vez de traerla y luego ocultarla.
    expect(prisma.companyMember.findFirst).toHaveBeenCalledWith({
      where: { companyId: COMPANY_ID, userId: USER_ID },
      select: { role: true, company: { select: { name: true } } },
    });
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
    expect(prisma.company.findFirst).not.toHaveBeenCalled();
  });

  it("no-miembro → redirect, y CERO lecturas de la fila ajena", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    await expect(requireCompanyPage("empresa-ajena", { name: true })).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(redirect).toHaveBeenCalledWith("/dashboard");
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
    expect(prisma.company.findFirst).not.toHaveBeenCalled();
  });

  it("mismo destino para 'no existe' que para 'no eres miembro' (sin oráculo)", async () => {
    // Si la empresa no existe, la membresía tampoco → misma rama, mismo redirect.
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);
    await expect(requireCompanyPage("no-existe", { name: true })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("sin sesión → /sign-in sin tocar la BD", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    await expect(requireCompanyPage(COMPANY_ID, { name: true })).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/sign-in");
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
  });

  it("propaga el select tal cual, incluidos atributos fiscales sensibles", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "OWNER",
      company: { isSpecialContributor: true, scopeProfile: "EMPRESA" },
    } as never);

    const { company } = await requireCompanyPage(COMPANY_ID, {
      isSpecialContributor: true,
      scopeProfile: true,
    });

    expect(company).toEqual({ isSpecialContributor: true, scopeProfile: "EMPRESA" });
    expect(prisma.companyMember.findFirst).toHaveBeenCalledWith({
      where: { companyId: COMPANY_ID, userId: USER_ID },
      select: {
        role: true,
        company: { select: { isSpecialContributor: true, scopeProfile: true } },
      },
    });
  });
});
