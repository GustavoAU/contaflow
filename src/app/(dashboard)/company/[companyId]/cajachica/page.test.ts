// src/app/(dashboard)/company/[companyId]/cajachica/page.test.ts
//
// SPEC-012 · ENTREGA B1 · CA-19 (modo RED) — la página de caja chica alimenta a los CUATRO
// formularios de cuenta (crear caja, depósito, gasto y cierre de caja). Llama a
// `getAccountsAction(companyId)` SIN la opción `onlyPostable` y su mapeo CONSERVA `isPostable`; lo que
// viaja al cliente son SOLO `{id, code, name, type, isPostable}` (nunca el registro completo de Prisma).
//
// `getAccountsAction` se sustituye por una versión que respeta `onlyPostable` como la real: si la página
// sigue pidiéndolo, los títulos no llegan y el test lo ve.

import { beforeEach, describe, expect, it, vi } from "vitest";

import CajaCajaPage from "./page";
import { CajaCajaPageClient } from "./CajaCajaPageClient";
import { getAccountsAction } from "@/modules/accounting/actions/account.actions";
import { listEmployeesAction } from "@/modules/payroll/actions/employee.actions";
import { auth } from "@clerk/nextjs/server";
import { findAll } from "@/__tests__/helpers/react-tree";
import {
  COMPANY_ID,
  expectKeysWithin,
  expectedIds,
  seedAccounts,
} from "@/__tests__/helpers/account-page-data";

const { findFirstMember } = vi.hoisted(() => ({ findFirstMember: vi.fn() }));

vi.mock("@/lib/prisma", () => {
  const prisma = { companyMember: { findFirst: findFirstMember } };
  return { prisma, default: prisma };
});
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/modules/accounting/actions/account.actions", () => ({ getAccountsAction: vi.fn() }));
vi.mock("@/modules/payroll/actions/employee.actions", () => ({ listEmployeesAction: vi.fn() }));
vi.mock("./CajaCajaPageClient", () => ({
  CajaCajaPageClient: function CajaCajaPageClient() {
    return null;
  },
}));

const rows = seedAccounts();

/** Como la real: empresa verificada, sin eliminadas, y `isPostable: true` SOLO si se pide. */
function realisticGetAccounts(companyId: string, opts: { onlyPostable?: boolean } = {}) {
  return Promise.resolve({
    success: true as const,
    data: rows.filter(
      (r) =>
        r.companyId === companyId && r.deletedAt === null && (!opts.onlyPostable || r.isPostable)
    ),
  });
}

async function renderPage() {
  return CajaCajaPage({ params: Promise.resolve({ companyId: COMPANY_ID }) });
}

async function deliveredAccounts() {
  const tree = await renderPage();
  const clients = findAll(tree, CajaCajaPageClient);
  expect(clients).toHaveLength(1);
  return (clients[0].props as { accounts: Record<string, unknown>[] }).accounts;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
  findFirstMember.mockResolvedValue({ role: "ADMIN" });
  vi.mocked(getAccountsAction).mockImplementation(realisticGetAccounts as never);
  vi.mocked(listEmployeesAction).mockResolvedValue({ success: true, data: [] } as never);
});

describe("CajaCajaPage — títulos y cuentas para los cuatro formularios de cuenta (SPEC-012 B1, CA-19)", () => {
  it("pide las cuentas SIN onlyPostable: los títulos llegan al cliente", async () => {
    await renderPage();
    expect(getAccountsAction).toHaveBeenCalledTimes(1);
    const [companyId, opts] = vi.mocked(getAccountsAction).mock.calls[0];
    expect(companyId).toBe(COMPANY_ID);
    expect(opts?.onlyPostable).toBeFalsy();
  });

  it("CajaCajaPageClient recibe los títulos Y las cuentas de movimiento de la empresa", async () => {
    const delivered = await deliveredAccounts();
    expect(delivered.map((a) => a.id).sort()).toEqual(expectedIds(rows).sort());
    expect(delivered.some((a) => a.isPostable === false)).toBe(true);
    expect(delivered.some((a) => a.isPostable === true)).toBe(true);
  });

  it("cada cuenta que viaja al cliente lleva SOLO {id, code, name, type, isPostable}", async () => {
    const full = rows
      .filter((r) => r.companyId === COMPANY_ID && r.deletedAt === null)
      .map((r) => ({ ...r, companyId: COMPANY_ID, description: "no debe viajar" }));
    vi.mocked(getAccountsAction).mockResolvedValue({ success: true, data: full } as never);
    const delivered = await deliveredAccounts();
    expectKeysWithin(delivered, ["id", "code", "name", "type", "isPostable"]);
    for (const account of delivered) {
      expect(Object.keys(account).sort()).toEqual(["code", "id", "isPostable", "name", "type"]);
    }
  });

  it("isPostable viaja con su valor real: títulos con false y cuentas de movimiento con true", async () => {
    const delivered = await deliveredAccounts();
    for (const original of rows.filter((r) => r.companyId === COMPANY_ID && r.deletedAt === null)) {
      expect(delivered).toContainEqual(
        expect.objectContaining({
          id: original.id,
          code: original.code,
          name: original.name,
          type: original.type,
          isPostable: original.isPostable,
        })
      );
    }
  });

  it("si la lectura de cuentas falla, entrega una lista vacía (comportamiento previo)", async () => {
    vi.mocked(getAccountsAction).mockResolvedValue({ success: false, error: "No autorizado" });
    expect(await deliveredAccounts()).toEqual([]);
  });

  it("sigue entregando empleados, companyId e isAdmin", async () => {
    vi.mocked(listEmployeesAction).mockResolvedValue({
      success: true,
      data: [{ id: "emp-1", fullName: "María Pérez", status: "ACTIVE" }],
    } as never);
    const tree = await renderPage();
    const props = findAll(tree, CajaCajaPageClient)[0].props as Record<string, unknown>;
    expect(props.companyId).toBe(COMPANY_ID);
    expect(props.employees).toEqual([{ id: "emp-1", name: "María Pérez", status: "ACTIVE" }]);
    expect(props.isAdmin).toBe(true);
  });

  it("sin sesión redirige antes de leer las cuentas", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(getAccountsAction).not.toHaveBeenCalled();
  });

  it("un rol sin permiso de escritura (VIEWER) es redirigido antes de leer las cuentas", async () => {
    findFirstMember.mockResolvedValue({ role: "VIEWER" });
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(getAccountsAction).not.toHaveBeenCalled();
  });
});
