// src/app/(dashboard)/company/[companyId]/transactions/new/page.test.ts
//
// SPEC-012 (Entrega A, paso 1, modo RED) — la página de «Nuevo asiento» entrega al formulario los
// títulos Y las cuentas de movimiento (SPEC §7): ya no pide `onlyPostable`, y «hay cuentas» se decide
// SOLO con las de movimiento (un plan que tuviera únicamente títulos no permite crear un asiento).
//
// Es una página de servidor (async): se invoca como función y se inspecciona el árbol de elementos
// que devuelve, sin renderizarlo. Los componentes hijos se sustituyen por stubs.

import { beforeEach, describe, expect, it, vi } from "vitest";

import NewTransactionPage from "./page";
import { getAccountsAction } from "@/modules/accounting/actions/account.actions";
import { getActivePeriodAction } from "@/modules/accounting/actions/period.actions";
import { JournalEntryForm } from "@/components/accounting/JournalEntryForm";
import { PrerequisiteGuide } from "@/components/guides/PrerequisiteGuide";
import { currentUser } from "@clerk/nextjs/server";

vi.mock("@clerk/nextjs/server", () => ({ currentUser: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/modules/accounting/actions/account.actions", () => ({ getAccountsAction: vi.fn() }));
vi.mock("@/modules/accounting/actions/period.actions", () => ({ getActivePeriodAction: vi.fn() }));
vi.mock("@/components/accounting/JournalEntryForm", () => ({
  JournalEntryForm: function JournalEntryForm() {
    return null;
  },
}));
vi.mock("@/components/guides/PrerequisiteGuide", () => ({
  PrerequisiteGuide: function PrerequisiteGuide() {
    return null;
  },
}));

const COMPANY_ID = "company-1";

type Row = { id: string; code: string; name: string; type: string; isPostable: boolean };
const row = (code: string, name: string, isPostable: boolean): Row => ({
  id: `${isPostable ? "m" : "t"}:${code}`,
  code,
  name,
  type: "ASSET",
  isPostable,
});

const TITLES = [
  row("1", "ACTIVO", false),
  row("1.1", "CORRIENTE", false),
  row("1.1.01", "DISPONIBLE", false),
  row("1.1.01.01", "CAJAS", false),
];
const MOVEMENT = [row("1.1.01.01.001", "Caja Principal", true)];

type ElementLike = { type?: unknown; props?: { children?: unknown } & Record<string, unknown> };

/** Todos los elementos de `type` dentro del árbol devuelto por la página. */
function findAll(node: unknown, type: unknown, out: ElementLike[] = []): ElementLike[] {
  if (Array.isArray(node)) {
    node.forEach((child) => findAll(child, type, out));
  } else if (node && typeof node === "object") {
    const el = node as ElementLike;
    if (el.type === type) out.push(el);
    if (el.props) findAll(el.props.children, type, out);
  }
  return out;
}

async function renderPage() {
  return NewTransactionPage({ params: Promise.resolve({ companyId: COMPANY_ID }) });
}

function mockData(accounts: Row[], period: unknown = { id: "period-1" }) {
  vi.mocked(getAccountsAction).mockResolvedValue({ success: true, data: accounts as never });
  vi.mocked(getActivePeriodAction).mockResolvedValue({ success: true, data: period as never });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentUser).mockResolvedValue({ id: "user-1" } as never);
});

describe("NewTransactionPage — títulos y cuentas para el selector buscable (SPEC-012 §7)", () => {
  it("pide las cuentas SIN onlyPostable: los títulos llegan al formulario", async () => {
    mockData([...TITLES, ...MOVEMENT]);
    await renderPage();
    expect(getAccountsAction).toHaveBeenCalledTimes(1);
    const [companyId, opts] = vi.mocked(getAccountsAction).mock.calls[0];
    expect(companyId).toBe(COMPANY_ID);
    expect(opts?.onlyPostable).toBeFalsy();
  });

  it("entrega al formulario los títulos y las cuentas de movimiento, con isPostable", async () => {
    mockData([...TITLES, ...MOVEMENT]);
    const tree = await renderPage();
    const forms = findAll(tree, JournalEntryForm);
    expect(forms).toHaveLength(1);
    const props = forms[0].props as { companyId: string; userId: string; accounts: Row[] };
    expect(props.companyId).toBe(COMPANY_ID);
    expect(props.userId).toBe("user-1");
    expect(props.accounts).toHaveLength(TITLES.length + MOVEMENT.length);
    for (const original of [...TITLES, ...MOVEMENT]) {
      expect(props.accounts).toContainEqual(
        expect.objectContaining({
          id: original.id,
          code: original.code,
          name: original.name,
          isPostable: original.isPostable,
        })
      );
    }
  });

  it("«hay cuentas» cuenta SOLO las de movimiento: un plan con puros títulos muestra la guía de cuentas, no el formulario", async () => {
    mockData(TITLES);
    const tree = await renderPage();
    expect(findAll(tree, JournalEntryForm)).toHaveLength(0);
    const guides = findAll(tree, PrerequisiteGuide);
    expect(guides).toHaveLength(1);
    expect(guides[0].props).toMatchObject({ type: "accounts", companyId: COMPANY_ID });
  });

  it("sin ninguna cuenta también muestra la guía de cuentas", async () => {
    mockData([]);
    const tree = await renderPage();
    expect(findAll(tree, JournalEntryForm)).toHaveLength(0);
    expect(findAll(tree, PrerequisiteGuide)[0].props).toMatchObject({ type: "accounts" });
  });

  it("una sola cuenta de movimiento basta para mostrar el formulario (con sus títulos)", async () => {
    mockData([TITLES[3], MOVEMENT[0]]);
    const tree = await renderPage();
    expect(findAll(tree, JournalEntryForm)).toHaveLength(1);
    expect(findAll(tree, PrerequisiteGuide)).toHaveLength(0);
  });

  it("si la lectura de cuentas falla, muestra la guía de cuentas (no un formulario vacío)", async () => {
    vi.mocked(getAccountsAction).mockResolvedValue({ success: false, error: "No autorizado" });
    vi.mocked(getActivePeriodAction).mockResolvedValue({
      success: true,
      data: { id: "period-1" } as never,
    });
    const tree = await renderPage();
    expect(findAll(tree, JournalEntryForm)).toHaveLength(0);
    expect(findAll(tree, PrerequisiteGuide)[0].props).toMatchObject({ type: "accounts" });
  });

  it("sin período abierto muestra la guía de período, aunque haya cuentas (comportamiento previo)", async () => {
    mockData([...TITLES, ...MOVEMENT], null);
    const tree = await renderPage();
    expect(findAll(tree, JournalEntryForm)).toHaveLength(0);
    expect(findAll(tree, PrerequisiteGuide)[0].props).toMatchObject({ type: "period" });
  });

  it("sin usuario redirige al inicio de sesión antes de leer nada", async () => {
    vi.mocked(currentUser).mockResolvedValue(null as never);
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(getAccountsAction).not.toHaveBeenCalled();
  });
});
