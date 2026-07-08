// @vitest-environment jsdom
// Smoke tests del refactor P2 (audit 2026-07-05): CustomerList + CustomerForm (RHF + zodResolver).
// Suite espejo de VendorList.component.test.tsx adaptada al dominio cliente:
// SIN isSpecialContributor, actions de customer.actions, columna "Último contacto"
// y ClientPortalTokenButton gated por canDelete. Normalización del schema pineada:
// campos vacíos → null (zOptionalText/zEmptyAsNull — limpia columna, evita "" en @unique).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CustomerList } from "../components/CustomerList";
import type { CustomerRow } from "../services/CustomerService";
import type { ContactGroupRow } from "../services/ContactGroupService";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../actions/customer.actions", () => ({
  createCustomerAction: vi.fn(),
  updateCustomerAction: vi.fn(),
  deleteCustomerAction: vi.fn(),
  addContactNoteAction: vi.fn(),
  listContactNotesAction: vi.fn(),
  deleteContactNoteAction: vi.fn(),
}));

vi.mock("../actions/contact-group.actions", () => ({
  createCustomerGroupAction: vi.fn(),
  deleteCustomerGroupAction: vi.fn(),
}));

// ClientPortalTokenButton importa client-portal-token.actions (server action) —
// se mockea el componente completo con un marcador de texto para poder afirmar
// el gating por canDelete sin cargar el módulo de actions.
vi.mock("../components/ClientPortalTokenButton", () => ({
  ClientPortalTokenButton: (props: { customerName: string }) =>
    `portal-token:${props.customerName}`,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { createCustomerAction, updateCustomerAction } from "../actions/customer.actions";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date("2026-07-01T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function makeCustomer(overrides: Partial<CustomerRow> & { id: string; name: string }): CustomerRow {
  return {
    companyId: "company-1",
    rif: null,
    email: null,
    phone: null,
    address: null,
    code: null,
    groupId: null,
    group: null,
    notes: null,
    category: "REGULAR",
    lastInvoiceDate: null,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const CUSTOMER_ALFA = makeCustomer({
  id: "customer-1",
  name: "Alfa Comercial",
  rif: "J-11111111-1",
  code: "C-001",
  email: "alfa@ejemplo.com",
  lastInvoiceDate: new Date(), // hoy → "Hoy" en columna Último contacto
});

const CUSTOMER_BETA = makeCustomer({
  id: "customer-2",
  name: "Beta Corp",
  rif: "V-22222222-2",
  lastInvoiceDate: new Date(Date.now() - 100 * DAY_MS), // >90 días → "Inactivo"
});

const GROUP_MAYORISTAS: ContactGroupRow = {
  id: "cjld2cjxh0000qzrmn831i7rn", // cuid válido — groupIdField exige z.cuid()
  companyId: "company-1",
  name: "Mayoristas",
  createdAt: NOW,
  updatedAt: NOW,
  _count: { members: 1 },
};

const BASE_PROPS = {
  companyId: "company-1",
  initialCustomers: [CUSTOMER_ALFA, CUSTOMER_BETA],
  initialGroups: [GROUP_MAYORISTAS],
  canWrite: true,
  canDelete: true,
};

function openCreateForm() {
  fireEvent.click(screen.getByRole("button", { name: "+ Nuevo cliente" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CustomerList — smoke del refactor RHF (P2)", () => {
  it("renderiza la lista con los 2 customers iniciales y la columna 'Último contacto'", () => {
    render(<CustomerList {...BASE_PROPS} />);

    expect(screen.getByText("Alfa Comercial")).toBeTruthy();
    expect(screen.getByText("Beta Corp")).toBeTruthy();
    expect(screen.getByText("J-11111111-1")).toBeTruthy();
    expect(screen.getByText("C-001")).toBeTruthy();

    // Columna exclusiva de clientes (no existe en VendorList)
    expect(screen.getByText("Último contacto")).toBeTruthy();
    expect(screen.getByText("Hoy")).toBeTruthy(); // Alfa facturó hoy
    expect(screen.getByText("Inactivo")).toBeTruthy(); // Beta >90 días sin factura
  });

  it("abre el form de crear al hacer click en '+ Nuevo cliente' y muestra los campos (sin checkbox C.E.)", () => {
    render(<CustomerList {...BASE_PROPS} />);

    // El form no está montado inicialmente
    expect(screen.queryByPlaceholderText("Nombre *")).toBeNull();

    openCreateForm();

    expect(screen.getByText("Nuevo cliente")).toBeTruthy();
    expect(screen.getByPlaceholderText("Nombre *")).toBeTruthy();
    expect(screen.getByPlaceholderText("RIF (J-12345678-9)")).toBeTruthy();
    expect(screen.getByPlaceholderText("Email")).toBeTruthy();
    expect(screen.getByPlaceholderText("Teléfono")).toBeTruthy();
    expect(screen.getByPlaceholderText("Código (ej: C-001)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeTruthy();

    // Diferencia vs VendorForm: los clientes NO tienen isSpecialContributor
    expect(
      screen.queryByText("Contribuyente Especial (aplican retenciones IVA/ISLR)")
    ).toBeNull();
  });

  it("guard doble-submit: botón Guardar deshabilitado con nombre vacío, habilitado al escribir", () => {
    render(<CustomerList {...BASE_PROPS} />);
    openCreateForm();

    const submitBtn = screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("Nombre *"), {
      target: { value: "Cliente X" },
    });
    expect(submitBtn.disabled).toBe(false);

    // Solo espacios cuenta como vacío (guard !name.trim())
    fireEvent.change(screen.getByPlaceholderText("Nombre *"), {
      target: { value: "   " },
    });
    expect(submitBtn.disabled).toBe(true);
  });

  it("RIF inválido → muestra el mensaje del schema bajo el campo y NO llama createCustomerAction", async () => {
    render(<CustomerList {...BASE_PROPS} />);
    openCreateForm();

    fireEvent.change(screen.getByPlaceholderText("Nombre *"), {
      target: { value: "Cliente X" },
    });
    fireEvent.change(screen.getByPlaceholderText("RIF (J-12345678-9)"), {
      target: { value: "12345678" }, // sin prefijo J/V/E/G/C/P → inválido
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    // Mensaje client-side idéntico al del server (CustomerFormSchema = pick del server schema)
    const errorMsg = await screen.findByText("RIF inválido (ej: J-12345678-9)");
    expect(errorMsg.id).toBe("customer-create-rif-error");

    const rifInput = screen.getByPlaceholderText("RIF (J-12345678-9)");
    expect(rifInput.getAttribute("aria-invalid")).toBe("true");
    expect(rifInput.getAttribute("aria-describedby")).toBe("customer-create-rif-error");

    expect(createCustomerAction).not.toHaveBeenCalled();
  });

  it("RIF válido → submit llama createCustomerAction con el payload que produce el schema", async () => {
    vi.mocked(createCustomerAction).mockResolvedValue({
      success: true,
      data: makeCustomer({ id: "customer-3", name: "Cliente Nuevo", rif: "J-12345678-9" }),
    } as never);

    render(<CustomerList {...BASE_PROPS} />);
    openCreateForm();

    fireEvent.change(screen.getByPlaceholderText("Nombre *"), {
      target: { value: "Cliente Nuevo" },
    });
    fireEvent.change(screen.getByPlaceholderText("RIF (J-12345678-9)"), {
      target: { value: "J-12345678-9" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(createCustomerAction).toHaveBeenCalledTimes(1));
    // Payload exacto según el schema REAL (comportamiento actual, pineado):
    // Normalización uniforme del schema (fix del quirk 2026-07-07): TODO campo opcional
    // vacío → null. En BD limpia la columna; en updates hace borrables rif/email
    // (antes undefined → Prisma omitía) y evita P2002 por "" en @@unique(companyId, rif/code).
    // - SIN isSpecialContributor: CreateCustomerSchema no tiene ese campo
    expect(createCustomerAction).toHaveBeenCalledWith("company-1", {
      name: "Cliente Nuevo",
      rif: "J-12345678-9",
      email: null,
      phone: null,
      code: null,
      groupId: null,
      notes: null,
      category: "REGULAR",
    });
  });

  it("createCustomerAction success → el customer nuevo aparece en la lista y el form se cierra", async () => {
    vi.mocked(createCustomerAction).mockResolvedValue({
      success: true,
      data: makeCustomer({ id: "customer-3", name: "Zeta Distribuciones", rif: "G-33333333-3" }),
    } as never);

    render(<CustomerList {...BASE_PROPS} />);
    openCreateForm();

    fireEvent.change(screen.getByPlaceholderText("Nombre *"), {
      target: { value: "Zeta Distribuciones" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    // El customer devuelto por la action se agrega a la lista (ordenado por nombre)
    expect(await screen.findByText("Zeta Distribuciones")).toBeTruthy();
    // showCreate=false → el form desaparece
    await waitFor(() => expect(screen.queryByPlaceholderText("Nombre *")).toBeNull());
  });

  it("createCustomerAction failure → muestra el error de la action y el form sigue abierto", async () => {
    vi.mocked(createCustomerAction).mockResolvedValue({
      success: false,
      error: "Ya existe un cliente con ese RIF",
    } as never);

    render(<CustomerList {...BASE_PROPS} />);
    openCreateForm();

    fireEvent.change(screen.getByPlaceholderText("Nombre *"), {
      target: { value: "Cliente Duplicado" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Ya existe un cliente con ese RIF")).toBeTruthy();
    expect(screen.getByPlaceholderText("Nombre *")).toBeTruthy();
  });

  it("click en editar → el form inline muestra los defaultValues del customer", () => {
    render(<CustomerList {...BASE_PROPS} />);

    // Fila de Alfa Comercial (primera en el orden inicial)
    const editButtons = screen.getAllByTitle("Editar cliente");
    fireEvent.click(editButtons[0]);

    expect(screen.getByDisplayValue("Alfa Comercial")).toBeTruthy();
    expect(screen.getByDisplayValue("J-11111111-1")).toBeTruthy();
    expect(screen.getByDisplayValue("C-001")).toBeTruthy();
    expect(screen.getByDisplayValue("alfa@ejemplo.com")).toBeTruthy();
    // El resto de las filas siguen en modo display
    expect(screen.getByText("Beta Corp")).toBeTruthy();
  });

  it("guardar edición → llama updateCustomerAction con el payload del schema y actualiza la fila", async () => {
    vi.mocked(updateCustomerAction).mockResolvedValue({
      success: true,
      data: makeCustomer({ id: "customer-1", name: "Alfa Comercial C.A.", rif: "J-11111111-1", code: "C-001", email: "alfa@ejemplo.com" }),
    } as never);

    render(<CustomerList {...BASE_PROPS} />);
    fireEvent.click(screen.getAllByTitle("Editar cliente")[0]);

    fireEvent.change(screen.getByDisplayValue("Alfa Comercial"), {
      target: { value: "Alfa Comercial C.A." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(updateCustomerAction).toHaveBeenCalledTimes(1));
    // phone/notes vacíos → "" (mismo quirk del schema documentado en el test de create)
    expect(updateCustomerAction).toHaveBeenCalledWith("company-1", "customer-1", {
      name: "Alfa Comercial C.A.",
      rif: "J-11111111-1",
      email: "alfa@ejemplo.com",
      phone: null,
      code: "C-001",
      groupId: null,
      notes: null,
      category: "REGULAR",
    });

    expect(await screen.findByText("Alfa Comercial C.A.")).toBeTruthy();
  });

  it("búsqueda filtra las filas visibles por nombre y por RIF", () => {
    render(<CustomerList {...BASE_PROPS} />);

    const searchInput = screen.getByPlaceholderText("Buscar por nombre, RIF o código…");
    fireEvent.change(searchInput, { target: { value: "beta" } });

    expect(screen.getByText("Beta Corp")).toBeTruthy();
    expect(screen.queryByText("Alfa Comercial")).toBeNull();

    // Filtro por RIF también funciona
    fireEvent.change(searchInput, { target: { value: "J-11111111" } });
    expect(screen.getByText("Alfa Comercial")).toBeTruthy();
    expect(screen.queryByText("Beta Corp")).toBeNull();

    // Sin coincidencias → mensaje de vacío
    fireEvent.change(searchInput, { target: { value: "zzz-no-existe" } });
    expect(screen.getByText(/No hay clientes que coincidan con/)).toBeTruthy();
  });

  it("ClientPortalTokenButton gated por canDelete: visible con canDelete=true, oculto con false", () => {
    const { unmount } = render(<CustomerList {...BASE_PROPS} />);

    // canDelete=true → un botón de portal por fila
    expect(screen.getByText("portal-token:Alfa Comercial")).toBeTruthy();
    expect(screen.getByText("portal-token:Beta Corp")).toBeTruthy();
    expect(screen.getAllByText("Desactivar")).toHaveLength(2);
    unmount();

    // canWrite=true pero canDelete=false → editar sigue, portal y desactivar desaparecen
    render(<CustomerList {...BASE_PROPS} canDelete={false} />);
    expect(screen.getAllByTitle("Editar cliente")).toHaveLength(2);
    expect(screen.queryByText(/portal-token:/)).toBeNull();
    expect(screen.queryByText("Desactivar")).toBeNull();
  });

  it("canWrite=false → no muestra botón de crear ni acciones de mutación", () => {
    render(<CustomerList {...BASE_PROPS} canWrite={false} canDelete={false} />);

    expect(screen.queryByRole("button", { name: "+ Nuevo cliente" })).toBeNull();
    expect(screen.queryByTitle("Editar cliente")).toBeNull();
    expect(screen.queryByText("Desactivar")).toBeNull();
    expect(screen.queryByText(/portal-token:/)).toBeNull();
    // Botón de grupos también es de escritura
    expect(screen.queryByText(/^Grupos \(/)).toBeNull();
    // Lista sigue visible en modo lectura
    expect(screen.getByText("Alfa Comercial")).toBeTruthy();
    expect(screen.getByText("Beta Corp")).toBeTruthy();
  });
});
