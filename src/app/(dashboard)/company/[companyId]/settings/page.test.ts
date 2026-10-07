// src/app/(dashboard)/company/[companyId]/settings/page.test.ts
//
// SPEC-012 · ENTREGA B2 · CA-19 (modo RED) — la pestaña «Contabilidad» de Configuración alimenta a DOS
// formularios de cuenta (`FiscalConfigForm`: Patrimonio; `GLAccountsForm`: todos los tipos):
//   · llama a `getAccountsAction(companyId)` SIN la opción `onlyPostable` (los títulos llegan);
//   · sus DOS mapeos (`equityAccounts` y `allAccounts`) CONSERVAN `isPostable`: sin él el combobox trataría
//     todo como título. Al cliente viaja SOLO `{id, code, name, [type,] isPostable}` (nunca el registro
//     completo de Prisma);
//   · RN-19: los avisos «No hay cuentas de tipo Patrimonio…» / «No hay cuentas en el plan de cuentas…»
//     cuentan SOLO cuentas de movimiento (un plan con puros títulos no permite configurar nada).
//
// `onlyPostable` NO se retira de `getAccountsAction` en B2: `income-distribution/page.tsx` lo sigue usando
// (decisión 5); aquí solo se exige que ESTA página deje de pedirlo.
//
// Es una página de servidor (async): se invoca como función y se inspecciona el árbol de elementos que
// devuelve, sin renderizarlo. Los componentes hijos se sustituyen por stubs con `vi.mock`.

import { beforeEach, describe, expect, it, vi } from "vitest";

import SettingsPage from "./page";
import { FiscalConfigForm } from "@/modules/fiscal-close/components/FiscalConfigForm";
import { GLAccountsForm } from "@/modules/settings/components/GLAccountsForm";
import { getAccountsAction } from "@/modules/accounting/actions/account.actions";
import { getFiscalConfigAction } from "@/modules/fiscal-close/actions/fiscal-close.actions";
import { getGLConfigAction } from "@/modules/settings/actions/gl-config.actions";
import { getUserCompaniesAction } from "@/modules/auth/actions/user.actions";
import { currentUser } from "@clerk/nextjs/server";
import { collectText, findAll } from "@/__tests__/helpers/react-tree";
import {
  COMPANY_ID,
  expectKeysWithin,
  expectedIds,
  seedAccounts,
} from "@/__tests__/helpers/account-page-data";

const stubs = vi.hoisted(() => ({
  getLocaleAction: vi.fn(),
  getCertificateStatusAction: vi.fn(),
  getMembersAction: vi.fn(),
  getGrantsAction: vi.fn(),
  getStockControlLevelAction: vi.fn(),
  getCajaChicaStepUpThresholdAction: vi.fn(),
  getAccountantConfigAction: vi.fn(),
  getDespachoStatusAction: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ currentUser: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/modules/settings/actions/locale.actions", () => ({
  getLocaleAction: stubs.getLocaleAction,
}));
vi.mock("@/modules/auth/actions/user.actions", () => ({ getUserCompaniesAction: vi.fn() }));
vi.mock("@/modules/fiscal-close/actions/fiscal-close.actions", () => ({
  getFiscalConfigAction: vi.fn(),
}));
vi.mock("@/modules/accounting/actions/account.actions", () => ({ getAccountsAction: vi.fn() }));
vi.mock("@/modules/settings/actions/gl-config.actions", () => ({ getGLConfigAction: vi.fn() }));
vi.mock("@/modules/certificates/actions/certificate.actions", () => ({
  getCertificateStatusAction: stubs.getCertificateStatusAction,
}));
vi.mock("@/modules/company/actions/member.actions", () => ({
  getMembersAction: stubs.getMembersAction,
}));
vi.mock("@/modules/company/actions/permission.actions", () => ({
  getGrantsAction: stubs.getGrantsAction,
}));
vi.mock("@/modules/settings/actions/stock-config.actions", () => ({
  getStockControlLevelAction: stubs.getStockControlLevelAction,
}));
vi.mock("@/modules/settings/actions/cajachica-config.actions", () => ({
  getCajaChicaStepUpThresholdAction: stubs.getCajaChicaStepUpThresholdAction,
}));
vi.mock("@/modules/settings/actions/accountant-config.actions", () => ({
  getAccountantConfigAction: stubs.getAccountantConfigAction,
}));
vi.mock("@/modules/despacho/actions/despacho.actions", () => ({
  getDespachoStatusAction: stubs.getDespachoStatusAction,
}));
vi.mock("@/modules/settings/LanguageSelector", () => ({ LanguageSelector: () => null }));
vi.mock("@/components/company/ArchiveCompany", () => ({ ArchiveCompany: () => null }));
vi.mock("@/modules/fiscal-close/components/FiscalConfigForm", () => ({
  FiscalConfigForm: function FiscalConfigForm() {
    return null;
  },
}));
vi.mock("@/modules/receivables/components/PaymentTermsForm", () => ({
  PaymentTermsForm: () => null,
}));
vi.mock("@/modules/certificates/components/CertificatePanel", () => ({
  CertificatePanel: () => null,
}));
vi.mock("@/modules/company/components/MembersPanel", () => ({ MembersPanel: () => null }));
vi.mock("@/modules/company/components/SeniatAccessPanel", () => ({
  SeniatAccessPanel: () => null,
}));
vi.mock("@/modules/company/components/PermissionsMatrix", () => ({
  PermissionsMatrix: () => null,
}));
vi.mock("@/modules/company/components/CompanySeniatDataForm", () => ({
  CompanySeniatDataForm: () => null,
}));
vi.mock("@/modules/settings/components/GLAccountsForm", () => ({
  GLAccountsForm: function GLAccountsForm() {
    return null;
  },
}));
vi.mock("@/modules/settings/components/AccountantSignatureForm", () => ({
  AccountantSignatureForm: () => null,
}));
vi.mock("@/modules/settings/components/StockControlLevelForm", () => ({
  StockControlLevelForm: () => null,
}));
vi.mock("@/modules/settings/components/CajaChicaStepUpForm", () => ({
  CajaChicaStepUpForm: () => null,
}));
vi.mock("@/modules/settings/components/ActiveSessionsPanel", () => ({
  ActiveSessionsPanel: () => null,
}));
vi.mock("@/components/ui/SearchParamTabs", () => ({ SearchParamTabs: () => null }));
vi.mock("@/modules/despacho/components/DespachoTierCard", () => ({ DespachoTierCard: () => null }));

const rows = seedAccounts();
const COMPANY = {
  id: COMPANY_ID,
  name: "Empresa Uno C.A.",
  rif: "J-12345678-9",
  isSpecialContributor: true,
  scopeProfile: "EMPRESA",
  paymentTermDays: 30,
  role: "ADMIN",
};

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

/** `tab` omitido = la pestaña «contabilidad»; `undefined` explícito = sin `?tab=` (pestaña por defecto). */
async function renderPage(...args: [tab?: string | undefined]) {
  const tab = args.length === 0 ? "contabilidad" : args[0];
  return SettingsPage({
    params: Promise.resolve({ companyId: COMPANY_ID }),
    searchParams: Promise.resolve({ tab }),
  });
}

async function equityDelivered() {
  const forms = findAll(await renderPage(), FiscalConfigForm);
  expect(forms).toHaveLength(1);
  return (forms[0].props as { equityAccounts: Record<string, unknown>[] }).equityAccounts;
}

async function allDelivered() {
  const forms = findAll(await renderPage(), GLAccountsForm);
  expect(forms).toHaveLength(1);
  return (forms[0].props as { allAccounts: Record<string, unknown>[] }).allAccounts;
}

const textOf = (tree: unknown) => collectText(tree).join(" ").replace(/\s+/g, " ");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentUser).mockResolvedValue({ id: "user-1" } as never);
  vi.mocked(getUserCompaniesAction).mockResolvedValue([COMPANY] as never);
  stubs.getLocaleAction.mockResolvedValue("es");
  vi.mocked(getAccountsAction).mockImplementation(realisticGetAccounts as never);
  vi.mocked(getFiscalConfigAction).mockResolvedValue({
    success: true,
    data: { resultAccountId: "m-result", retainedEarningsAccountId: "m-retained" },
  } as never);
  vi.mocked(getGLConfigAction).mockResolvedValue({
    success: true,
    data: {
      arAccountId: "ar",
      apAccountId: "ap",
      salesAccountId: "sales",
      purchaseExpenseAccountId: "pe",
      inventoryAccountId: "inv",
      ivaDFAccountId: "df",
      ivaCFAccountId: "cf",
      ivaRetentionPayableAccountId: "rp",
      ivaRetentionReceivableAccountId: "rr",
      fxGainAccountId: "fg",
      fxLossAccountId: "fl",
      igtfPayableAccountId: "igtf",
      unbookedCount: 4,
    },
  } as never);
  stubs.getStockControlLevelAction.mockResolvedValue({ success: true, data: { level: "WARN" } });
  stubs.getCajaChicaStepUpThresholdAction.mockResolvedValue({
    success: true,
    data: { threshold: "1000", defaultThreshold: "1000" },
  });
});

describe("SettingsPage (Contabilidad) — títulos y cuentas para los formularios de cuenta (SPEC-012 B2, CA-19)", () => {
  it("pide las cuentas UNA vez y SIN onlyPostable: los títulos llegan al cliente", async () => {
    await renderPage();
    expect(getAccountsAction).toHaveBeenCalledTimes(1);
    const [companyId, opts] = vi.mocked(getAccountsAction).mock.calls[0];
    expect(companyId).toBe(COMPANY_ID);
    expect(opts?.onlyPostable).toBeFalsy();
  });

  it("FiscalConfigForm recibe los títulos Y las cuentas de movimiento de PATRIMONIO (no otros tipos, ni eliminadas ni de otra empresa)", async () => {
    const delivered = await equityDelivered();
    expect(delivered.map((a) => a.id).sort()).toEqual(
      expectedIds(rows, { types: ["EQUITY"] }).sort()
    );
    expect(delivered.some((a) => a.isPostable === false)).toBe(true);
    expect(delivered.some((a) => a.isPostable === true)).toBe(true);
  });

  it("equityAccounts lleva {id, code, name, isPostable} y nada más (type es opcional)", async () => {
    expectKeysWithin(await equityDelivered(), ["id", "code", "name", "isPostable"], ["type"]);
  });

  it("equityAccounts: isPostable viaja con su valor real (títulos false, movimiento true)", async () => {
    const delivered = await equityDelivered();
    for (const original of rows.filter(
      (r) => r.companyId === COMPANY_ID && r.deletedAt === null && r.type === "EQUITY"
    )) {
      expect(delivered).toContainEqual(
        expect.objectContaining({
          id: original.id,
          code: original.code,
          name: original.name,
          isPostable: original.isPostable,
        })
      );
    }
  });

  it("GLAccountsForm recibe los títulos Y las cuentas de movimiento de TODOS los tipos de la empresa", async () => {
    const delivered = await allDelivered();
    expect(delivered.map((a) => a.id).sort()).toEqual(expectedIds(rows).sort());
    expect(delivered.some((a) => a.isPostable === false)).toBe(true);
    expect(delivered.some((a) => a.isPostable === true)).toBe(true);
  });

  it("allAccounts lleva SOLO {id, code, name, type, isPostable}", async () => {
    const delivered = await allDelivered();
    expectKeysWithin(delivered, ["id", "code", "name", "type", "isPostable"]);
    for (const account of delivered) {
      expect(Object.keys(account).sort()).toEqual(["code", "id", "isPostable", "name", "type"]);
    }
  });

  it("allAccounts: isPostable viaja con su valor real y el tipo se conserva", async () => {
    const delivered = await allDelivered();
    for (const original of rows.filter((r) => r.companyId === COMPANY_ID && r.deletedAt === null)) {
      expect(delivered).toContainEqual(
        expect.objectContaining({
          id: original.id,
          type: original.type,
          isPostable: original.isPostable,
        })
      );
    }
  });

  it("no viaja el registro completo de Prisma (descripción, fechas, empresa)", async () => {
    const full = rows
      .filter((r) => r.companyId === COMPANY_ID && r.deletedAt === null)
      .map((r) => ({ ...r, description: "no debe viajar", companyId: COMPANY_ID }));
    vi.mocked(getAccountsAction).mockResolvedValue({ success: true, data: full } as never);
    for (const account of [...(await equityDelivered()), ...(await allDelivered())]) {
      expect(Object.keys(account)).not.toContain("description");
      expect(Object.keys(account)).not.toContain("companyId");
      expect(Object.keys(account)).not.toContain("deletedAt");
    }
  });
});

describe("SettingsPage (Contabilidad) — RN-19: los avisos cuentan SOLO cuentas de movimiento", () => {
  const onlyTitles = (types: string[]) =>
    rows.filter(
      (r) =>
        r.companyId === COMPANY_ID &&
        r.deletedAt === null &&
        (!types.includes(r.type) || !r.isPostable)
    );

  it("un plan con títulos de Patrimonio pero SIN cuentas de movimiento de Patrimonio: aviso y sin FiscalConfigForm", async () => {
    vi.mocked(getAccountsAction).mockResolvedValue({
      success: true,
      data: onlyTitles(["EQUITY"]),
    } as never);
    const tree = await renderPage();
    expect(findAll(tree, FiscalConfigForm)).toHaveLength(0);
    expect(textOf(tree)).toContain("No hay cuentas de tipo Patrimonio");
    // El resto del plan sí tiene cuentas de movimiento: el formulario del Libro Mayor se muestra.
    expect(findAll(tree, GLAccountsForm)).toHaveLength(1);
  });

  it("con cuentas de movimiento de Patrimonio NO hay aviso y FiscalConfigForm se muestra", async () => {
    const tree = await renderPage();
    expect(findAll(tree, FiscalConfigForm)).toHaveLength(1);
    expect(textOf(tree)).not.toContain("No hay cuentas de tipo Patrimonio");
  });

  it("un plan de SOLO títulos: aviso «No hay cuentas en el plan de cuentas» y sin GLAccountsForm", async () => {
    vi.mocked(getAccountsAction).mockResolvedValue({
      success: true,
      data: rows.filter((r) => r.companyId === COMPANY_ID && r.deletedAt === null && !r.isPostable),
    } as never);
    const tree = await renderPage();
    expect(findAll(tree, GLAccountsForm)).toHaveLength(0);
    expect(findAll(tree, FiscalConfigForm)).toHaveLength(0);
    expect(textOf(tree)).toContain("No hay cuentas en el plan de cuentas");
    expect(textOf(tree)).toContain("No hay cuentas de tipo Patrimonio");
  });

  it("una sola cuenta de movimiento entre muchos títulos basta para mostrar el formulario del Libro Mayor", async () => {
    const titles = rows.filter(
      (r) => r.companyId === COMPANY_ID && r.deletedAt === null && !r.isPostable
    );
    const oneMovement = rows.find(
      (r) => r.companyId === COMPANY_ID && r.deletedAt === null && r.isPostable
    )!;
    vi.mocked(getAccountsAction).mockResolvedValue({
      success: true,
      data: [...titles, oneMovement],
    } as never);
    const tree = await renderPage();
    expect(findAll(tree, GLAccountsForm)).toHaveLength(1);
    expect(textOf(tree)).not.toContain("No hay cuentas en el plan de cuentas");
  });

  it("si la lectura de cuentas falla, no hay formularios de cuenta y aparecen los avisos (comportamiento previo)", async () => {
    vi.mocked(getAccountsAction).mockResolvedValue({ success: false, error: "No autorizado" });
    const tree = await renderPage();
    expect(findAll(tree, FiscalConfigForm)).toHaveLength(0);
    expect(findAll(tree, GLAccountsForm)).toHaveLength(0);
    expect(textOf(tree)).toContain("No hay cuentas de tipo Patrimonio");
    expect(textOf(tree)).toContain("No hay cuentas en el plan de cuentas");
  });
});

describe("SettingsPage — lo que NO cambia (guardas verdes)", () => {
  it("entrega a los formularios la configuración vigente", async () => {
    const tree = await renderPage();
    const fiscal = findAll(tree, FiscalConfigForm)[0].props as Record<string, unknown>;
    expect(fiscal.companyId).toBe(COMPANY_ID);
    expect(fiscal.currentResultAccountId).toBe("m-result");
    expect(fiscal.currentRetainedEarningsAccountId).toBe("m-retained");
    const gl = findAll(tree, GLAccountsForm)[0].props as {
      companyId: string;
      isSpecialContributor: boolean;
      initialUnbookedCount: number;
      initialConfig: Record<string, unknown>;
    };
    expect(gl.companyId).toBe(COMPANY_ID);
    expect(gl.isSpecialContributor).toBe(true);
    expect(gl.initialUnbookedCount).toBe(4);
    expect(gl.initialConfig).toEqual({
      arAccountId: "ar",
      apAccountId: "ap",
      salesAccountId: "sales",
      purchaseExpenseAccountId: "pe",
      inventoryAccountId: "inv",
      ivaDFAccountId: "df",
      ivaCFAccountId: "cf",
      ivaRetentionPayableAccountId: "rp",
      ivaRetentionReceivableAccountId: "rr",
      fxGainAccountId: "fg",
      fxLossAccountId: "fl",
      igtfPayableAccountId: "igtf",
    });
  });

  it("sin configuración previa entrega nulls (no undefined) a los formularios", async () => {
    vi.mocked(getFiscalConfigAction).mockResolvedValue({ success: false, error: "x" } as never);
    vi.mocked(getGLConfigAction).mockResolvedValue({ success: false, error: "x" } as never);
    const tree = await renderPage();
    const fiscal = findAll(tree, FiscalConfigForm)[0].props as Record<string, unknown>;
    expect(fiscal.currentResultAccountId).toBeNull();
    expect(fiscal.currentRetainedEarningsAccountId).toBeNull();
    const gl = findAll(tree, GLAccountsForm)[0].props as {
      initialUnbookedCount: number;
      initialConfig: Record<string, unknown>;
    };
    expect(gl.initialUnbookedCount).toBe(0);
    expect(Object.values(gl.initialConfig).every((v) => v === null)).toBe(true);
  });

  it.each(["empresa", "firmas", "equipo", undefined])(
    "la pestaña %s NO lee las cuentas del plan",
    async (tab) => {
      await renderPage(tab);
      expect(getAccountsAction).not.toHaveBeenCalled();
    }
  );

  it("sin sesión redirige al inicio de sesión antes de leer nada", async () => {
    vi.mocked(currentUser).mockResolvedValue(null as never);
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(getAccountsAction).not.toHaveBeenCalled();
  });

  it("una empresa de la que el usuario no es miembro redirige al dashboard antes de leer las cuentas", async () => {
    vi.mocked(getUserCompaniesAction).mockResolvedValue([] as never);
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(getAccountsAction).not.toHaveBeenCalled();
  });
});
