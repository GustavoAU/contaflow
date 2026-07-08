// @vitest-environment jsdom
// Smoke tests del refactor P2 (audit 2026-07-05): VendorList + VendorForm (RHF + zodResolver).
// Red de seguridad del comportamiento actual: render, guard de submit, validación
// client-side con mensajes del schema del server, payload "" → undefined, edición inline
// con defaultValues y filtro de búsqueda.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VendorList } from "../components/VendorList";
import type { VendorRow } from "../services/VendorService";
import type { ContactGroupRow } from "../services/ContactGroupService";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../actions/vendor.actions", () => ({
  createVendorAction: vi.fn(),
  updateVendorAction: vi.fn(),
  deleteVendorAction: vi.fn(),
  addVendorNoteAction: vi.fn(),
  listVendorNotesAction: vi.fn(),
  deleteVendorNoteAction: vi.fn(),
}));

vi.mock("../actions/contact-group.actions", () => ({
  createVendorGroupAction: vi.fn(),
  deleteVendorGroupAction: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { createVendorAction, updateVendorAction } from "../actions/vendor.actions";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date("2026-07-01T12:00:00Z");

function makeVendor(overrides: Partial<VendorRow> & { id: string; name: string }): VendorRow {
  return {
    companyId: "company-1",
    rif: null,
    email: null,
    phone: null,
    address: null,
    isSpecialContributor: false,
    code: null,
    groupId: null,
    group: null,
    notes: null,
    category: "REGULAR",
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const VENDOR_ALFA = makeVendor({
  id: "vendor-1",
  name: "Alfa Suministros",
  rif: "J-11111111-1",
  code: "P-001",
  email: "alfa@ejemplo.com",
});

const VENDOR_BETA = makeVendor({
  id: "vendor-2",
  name: "Beta Corp",
  rif: "V-22222222-2",
});

const GROUP_FERRETERIA: ContactGroupRow = {
  id: "cjld2cjxh0000qzrmn831i7rn", // cuid válido — groupIdField exige z.cuid()
  companyId: "company-1",
  name: "Ferretería",
  createdAt: NOW,
  updatedAt: NOW,
  _count: { members: 1 },
};

const BASE_PROPS = {
  companyId: "company-1",
  initialVendors: [VENDOR_ALFA, VENDOR_BETA],
  initialGroups: [GROUP_FERRETERIA],
  canWrite: true,
  canDelete: true,
};

function openCreateForm() {
  fireEvent.click(screen.getByRole("button", { name: "+ Nuevo proveedor" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("VendorList — smoke del refactor RHF (P2)", () => {
  it("renderiza la lista con los 2 vendors iniciales", () => {
    render(<VendorList {...BASE_PROPS} />);

    expect(screen.getByText("Alfa Suministros")).toBeTruthy();
    expect(screen.getByText("Beta Corp")).toBeTruthy();
    expect(screen.getByText("J-11111111-1")).toBeTruthy();
    expect(screen.getByText("P-001")).toBeTruthy();
  });

  it("abre el form de crear al hacer click en '+ Nuevo proveedor' y muestra los campos", () => {
    render(<VendorList {...BASE_PROPS} />);

    // El form no está montado inicialmente
    expect(screen.queryByPlaceholderText("Nombre *")).toBeNull();

    openCreateForm();

    expect(screen.getByText("Nuevo proveedor")).toBeTruthy();
    expect(screen.getByPlaceholderText("Nombre *")).toBeTruthy();
    expect(screen.getByPlaceholderText("RIF (J-12345678-9)")).toBeTruthy();
    expect(screen.getByPlaceholderText("Email")).toBeTruthy();
    expect(screen.getByPlaceholderText("Teléfono")).toBeTruthy();
    expect(screen.getByPlaceholderText("Código (ej: P-001)")).toBeTruthy();
    expect(screen.getByText("Contribuyente Especial (aplican retenciones IVA/ISLR)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeTruthy();
  });

  it("guard doble-submit: botón Guardar deshabilitado con nombre vacío, habilitado al escribir", () => {
    render(<VendorList {...BASE_PROPS} />);
    openCreateForm();

    const submitBtn = screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("Nombre *"), {
      target: { value: "Proveedor X" },
    });
    expect(submitBtn.disabled).toBe(false);

    // Solo espacios cuenta como vacío (guard !name.trim())
    fireEvent.change(screen.getByPlaceholderText("Nombre *"), {
      target: { value: "   " },
    });
    expect(submitBtn.disabled).toBe(true);
  });

  it("RIF inválido → muestra el mensaje del schema bajo el campo y NO llama createVendorAction", async () => {
    render(<VendorList {...BASE_PROPS} />);
    openCreateForm();

    fireEvent.change(screen.getByPlaceholderText("Nombre *"), {
      target: { value: "Proveedor X" },
    });
    fireEvent.change(screen.getByPlaceholderText("RIF (J-12345678-9)"), {
      target: { value: "12345678" }, // sin prefijo J/V/E/G/C/P → inválido
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    // Mensaje client-side idéntico al del server (VendorFormSchema = pick del server schema)
    const errorMsg = await screen.findByText("RIF inválido (ej: J-12345678-9)");
    expect(errorMsg.id).toBe("vendor-create-rif-error");

    const rifInput = screen.getByPlaceholderText("RIF (J-12345678-9)");
    expect(rifInput.getAttribute("aria-invalid")).toBe("true");
    expect(rifInput.getAttribute("aria-describedby")).toBe("vendor-create-rif-error");

    expect(createVendorAction).not.toHaveBeenCalled();
  });

  it("RIF válido → submit llama createVendorAction con el payload que produce el schema", async () => {
    vi.mocked(createVendorAction).mockResolvedValue({
      success: true,
      data: makeVendor({ id: "vendor-3", name: "Proveedor Nuevo", rif: "J-12345678-9" }),
    } as never);

    render(<VendorList {...BASE_PROPS} />);
    openCreateForm();

    fireEvent.change(screen.getByPlaceholderText("Nombre *"), {
      target: { value: "Proveedor Nuevo" },
    });
    fireEvent.change(screen.getByPlaceholderText("RIF (J-12345678-9)"), {
      target: { value: "J-12345678-9" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(createVendorAction).toHaveBeenCalledTimes(1));
    // Payload exacto según el schema REAL (comportamiento actual, pineado):
    // Normalización uniforme del schema (fix del quirk 2026-07-07): TODO campo opcional
    // vacío → null — limpia columna, hace borrables rif/email en updates y evita
    // P2002 por "" en @@unique(companyId, rif/code).
    expect(createVendorAction).toHaveBeenCalledWith("company-1", {
      name: "Proveedor Nuevo",
      rif: "J-12345678-9",
      email: null,
      phone: null,
      code: null,
      groupId: null,
      notes: null,
      isSpecialContributor: false,
      category: "REGULAR",
    });
  });

  it("createVendorAction success → el vendor nuevo aparece en la lista y el form se cierra", async () => {
    vi.mocked(createVendorAction).mockResolvedValue({
      success: true,
      data: makeVendor({ id: "vendor-3", name: "Zeta Importaciones", rif: "G-33333333-3" }),
    } as never);

    render(<VendorList {...BASE_PROPS} />);
    openCreateForm();

    fireEvent.change(screen.getByPlaceholderText("Nombre *"), {
      target: { value: "Zeta Importaciones" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    // El vendor devuelto por la action se agrega a la lista (ordenado por nombre)
    expect(await screen.findByText("Zeta Importaciones")).toBeTruthy();
    // showCreate=false → el form desaparece
    await waitFor(() => expect(screen.queryByPlaceholderText("Nombre *")).toBeNull());
  });

  it("createVendorAction failure → muestra el error de la action y el form sigue abierto", async () => {
    vi.mocked(createVendorAction).mockResolvedValue({
      success: false,
      error: "Ya existe un proveedor con ese RIF",
    } as never);

    render(<VendorList {...BASE_PROPS} />);
    openCreateForm();

    fireEvent.change(screen.getByPlaceholderText("Nombre *"), {
      target: { value: "Proveedor Duplicado" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Ya existe un proveedor con ese RIF")).toBeTruthy();
    expect(screen.getByPlaceholderText("Nombre *")).toBeTruthy();
  });

  it("click en editar → el form inline muestra los defaultValues del vendor", () => {
    render(<VendorList {...BASE_PROPS} />);

    // Fila de Alfa Suministros (primera por orden alfabético)
    const editButtons = screen.getAllByTitle("Editar proveedor");
    fireEvent.click(editButtons[0]);

    expect(screen.getByDisplayValue("Alfa Suministros")).toBeTruthy();
    expect(screen.getByDisplayValue("J-11111111-1")).toBeTruthy();
    expect(screen.getByDisplayValue("P-001")).toBeTruthy();
    expect(screen.getByDisplayValue("alfa@ejemplo.com")).toBeTruthy();
    // El resto de las filas siguen en modo display
    expect(screen.getByText("Beta Corp")).toBeTruthy();
  });

  it("guardar edición → llama updateVendorAction con el payload del schema y actualiza la fila", async () => {
    vi.mocked(updateVendorAction).mockResolvedValue({
      success: true,
      data: makeVendor({ id: "vendor-1", name: "Alfa Suministros C.A.", rif: "J-11111111-1", code: "P-001", email: "alfa@ejemplo.com" }),
    } as never);

    render(<VendorList {...BASE_PROPS} />);
    fireEvent.click(screen.getAllByTitle("Editar proveedor")[0]);

    fireEvent.change(screen.getByDisplayValue("Alfa Suministros"), {
      target: { value: "Alfa Suministros C.A." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(updateVendorAction).toHaveBeenCalledTimes(1));
    // campos vacíos → null (normalización uniforme del schema)
    expect(updateVendorAction).toHaveBeenCalledWith("company-1", "vendor-1", {
      name: "Alfa Suministros C.A.",
      rif: "J-11111111-1",
      email: "alfa@ejemplo.com",
      phone: null,
      code: "P-001",
      groupId: null,
      notes: null,
      isSpecialContributor: false,
      category: "REGULAR",
    });

    expect(await screen.findByText("Alfa Suministros C.A.")).toBeTruthy();
  });

  it("búsqueda filtra las filas visibles por nombre", () => {
    render(<VendorList {...BASE_PROPS} />);

    const searchInput = screen.getByPlaceholderText("Buscar por nombre, RIF o código…");
    fireEvent.change(searchInput, { target: { value: "beta" } });

    expect(screen.getByText("Beta Corp")).toBeTruthy();
    expect(screen.queryByText("Alfa Suministros")).toBeNull();

    // Filtro por RIF también funciona
    fireEvent.change(searchInput, { target: { value: "J-11111111" } });
    expect(screen.getByText("Alfa Suministros")).toBeTruthy();
    expect(screen.queryByText("Beta Corp")).toBeNull();

    // Sin coincidencias → mensaje de vacío
    fireEvent.change(searchInput, { target: { value: "zzz-no-existe" } });
    expect(screen.getByText(/No hay proveedores que coincidan con/)).toBeTruthy();
  });

  it("canWrite=false → no muestra botón de crear ni checkboxes editables", () => {
    render(<VendorList {...BASE_PROPS} canWrite={false} canDelete={false} />);

    expect(screen.queryByRole("button", { name: "+ Nuevo proveedor" })).toBeNull();
    expect(screen.queryByTitle("Editar proveedor")).toBeNull();
    expect(screen.queryByLabelText("Contribuyente Especial")).toBeNull();
    // Lista sigue visible en modo lectura
    expect(screen.getByText("Alfa Suministros")).toBeTruthy();
  });
});
