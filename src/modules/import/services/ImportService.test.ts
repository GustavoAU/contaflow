// src/modules/import/services/ImportService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import ExcelJS from "exceljs";

vi.mock("@/lib/prisma", () => ({
  default: {
    account: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

import prisma from "@/lib/prisma";
import { ImportService } from "./ImportService";
import type { ImportAccountRow } from "../schemas/import.schema";

async function makeExcelBuffer(rows: object[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");

  if (rows.length > 0) {
    ws.addRow(Object.keys(rows[0]));
    rows.forEach((row) => ws.addRow(Object.values(row)));
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// Helper para construir un workbook a partir de encabezados y filas EXPLÍCITOS
// (a diferencia de makeExcelBuffer, que deriva encabezados de Object.keys). Necesario
// para probar encabezados con tilde ("Código", "Descripción") y orden exacto de
// columnas del archivo real de la tester, algo que makeExcelBuffer no puede expresar
// porque Object.keys no preserva nombres de propiedad con caracteres especiales de forma
// legible ni columnas repetidas conceptualmente distintas.
async function makeExcelBufferFromRows(
  headers: string[],
  rows: (string | number)[][]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(headers);
  rows.forEach((row) => ws.addRow(row));
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// Cast defensivo para leer `isPostable` sin importar si el tipo `ImportAccountRow`
// ya lo declara o todavía no (evita tener que editar estos tests cuando se implemente).
type RowWithPostable = ImportAccountRow & { isPostable?: boolean };

describe("ImportService.parseAccountsExcel", () => {
  it("parsea un Excel válido correctamente", async () => {
    const buffer = await makeExcelBuffer([
      { codigo: "1105", nombre: "Caja General", tipo: "ASSET", descripcion: "Efectivo" },
      { codigo: "2105", nombre: "Proveedores", tipo: "LIABILITY" },
    ]);

    const rows = await ImportService.parseAccountsExcel(buffer);
    expect(rows).toHaveLength(2);
    expect(rows[0].codigo).toBe("1105");
    expect(rows[1].tipo).toBe("LIABILITY");
  });

  it("lanza error si el tipo es inválido", async () => {
    const buffer = await makeExcelBuffer([{ codigo: "1105", nombre: "Caja", tipo: "INVALIDO" }]);

    await expect(ImportService.parseAccountsExcel(buffer)).rejects.toThrow();
  });

  it("lanza error si el archivo está vacío", async () => {
    const buffer = await makeExcelBuffer([]);
    await expect(ImportService.parseAccountsExcel(buffer)).rejects.toThrow();
  });

  it("normaliza columnas en mayúsculas", async () => {
    const buffer = await makeExcelBuffer([{ CODIGO: "3105", NOMBRE: "Capital", TIPO: "equity" }]);

    const rows = await ImportService.parseAccountsExcel(buffer);
    expect(rows[0].tipo).toBe("EQUITY");
  });

  // ---------------------------------------------------------------------------
  // Feature: cuentas de título (G/M) + inferencia de tipo por dígito + alias
  // nombre/descripcion — archivo real de la tester (formato estándar ERP venezolano)
  // ---------------------------------------------------------------------------

  it("[RED 1] archivo real de la tester: encabezados Código/Descripción/G-M/Nivel/Pre/Ter/C-C/Clase/Tipo(O-C)", async () => {
    const buffer = await makeExcelBufferFromRows(
      ["Código", "Descripción", "G/M", "Nivel", "Pre.", "Ter.", "C/C", "Clase", "Tipo"],
      [
        ["1", "ACTIVOS", "G", "1", "NO", "NO", "NO", "M", "O"],
        ["1.1.01.01.001", "Caja Principal", "M", "5", "NO", "NO", "NO", "M", "C"],
        ["2.1.01.01.001", "Proveedores Nacionales", "M", "5", "NO", "SI", "NO", "M", "C"],
      ]
    );

    const rows = (await ImportService.parseAccountsExcel(buffer)) as RowWithPostable[];

    expect(rows[0].codigo).toBe("1");
    expect(rows[0].nombre).toBe("ACTIVOS");
    expect(rows[0].tipo).toBe("ASSET"); // inferido del dígito "1"
    expect(rows[0].isPostable).toBe(false); // G

    expect(rows[1].nombre).toBe("Caja Principal");
    expect(rows[1].tipo).toBe("ASSET");
    expect(rows[1].isPostable).toBe(true); // M

    expect(rows[2].tipo).toBe("LIABILITY"); // inferido del dígito "2"
    expect(rows[2].isPostable).toBe(true); // M — "Ter."="SI" se ignora, no debe romper nada
  });

  it("[RED 2] plantilla simple actual sin columna G/M → isPostable default true", async () => {
    const buffer = await makeExcelBuffer([
      { codigo: "1105", nombre: "Caja General", tipo: "ASSET", descripcion: "Efectivo" },
      { codigo: "2105", nombre: "Proveedores", tipo: "LIABILITY" },
    ]);

    const rows = (await ImportService.parseAccountsExcel(buffer)) as RowWithPostable[];
    expect(rows[0].isPostable).toBe(true);
    expect(rows[1].isPostable).toBe(true);
  });

  it("[RED 3] inferencia de tipo por dígito cuando falta la columna 'tipo' (y nombre viene de 'descripcion')", async () => {
    const buffer = await makeExcelBufferFromRows(
      ["codigo", "descripcion"],
      [
        ["3.1.01", "Capital Social"],
        ["4.1.01", "Ventas"],
        ["5.1.01", "Gastos de Personal"],
        ["9.1.01", "Cuentas de Orden"],
      ]
    );

    const rows = await ImportService.parseAccountsExcel(buffer);

    expect(rows[0].nombre).toBe("Capital Social");
    expect(rows[0].tipo).toBe("EQUITY"); // dígito "3"
    expect(rows[0].descripcion).toBeUndefined(); // no se duplica en ambos campos

    expect(rows[1].nombre).toBe("Ventas");
    expect(rows[1].tipo).toBe("REVENUE"); // dígito "4"

    expect(rows[2].nombre).toBe("Gastos de Personal");
    expect(rows[2].tipo).toBe("EXPENSE"); // dígito "5"

    expect(rows[3].nombre).toBe("Cuentas de Orden");
    expect(rows[3].tipo).toBe("EXPENSE"); // dígito "9" (fuera de 1-4 → EXPENSE)
  });

  it("[GUARDA] columna 'tipo' explícita gana sobre la inferencia por dígito (CONTRA_ASSET)", async () => {
    const buffer = await makeExcelBufferFromRows(
      ["codigo", "nombre", "tipo"],
      [["1.1.05", "Depreciación Acumulada", "CONTRA_ASSET"]]
    );

    const rows = await ImportService.parseAccountsExcel(buffer);
    // NO se infiere "ASSET" del dígito "1" — la columna explícita manda.
    expect(rows[0].tipo).toBe("CONTRA_ASSET");
  });

  it("[RED 5] código sin dígito reconocible y sin columna 'tipo' → error de fila menciona el código", async () => {
    const buffer = await makeExcelBufferFromRows(
      ["codigo", "nombre"],
      [["ABC", "Cuenta rara"]]
    );

    await expect(ImportService.parseAccountsExcel(buffer)).rejects.toThrow(/ABC/);
  });

  it("[RED 6] G/M en minúscula o con espacios ('m', ' M ') sigue siendo movimiento (isPostable true)", async () => {
    const buffer = await makeExcelBufferFromRows(
      ["codigo", "nombre", "tipo", "G/M"],
      [
        ["1105", "Caja", "ASSET", "m"],
        ["1110", "Banco", "ASSET", " M "],
      ]
    );

    const rows = (await ImportService.parseAccountsExcel(buffer)) as RowWithPostable[];
    expect(rows[0].isPostable).toBe(true);
    expect(rows[1].isPostable).toBe(true);
  });

  it("[GUARDA/RED 7] columnas Nivel/Pre./Ter./C-C/Clase/Tipo(O-C) en blanco no rompen la importación", async () => {
    const buffer = await makeExcelBufferFromRows(
      ["codigo", "nombre", "G/M", "Nivel", "Pre.", "Ter.", "C/C", "Clase", "Tipo"],
      [["1201", "Cuentas por Cobrar Comerciales", "M", "", "", "", "", "", ""]]
    );

    const rows = (await ImportService.parseAccountsExcel(buffer)) as RowWithPostable[];
    expect(rows).toHaveLength(1);
    expect(rows[0].tipo).toBe("ASSET"); // inferido del dígito "1" (no hay columna tipo ASSET explícita)
    expect(rows[0].isPostable).toBe(true); // M
  });

  it("[RED 8] nombre desde 'descripcion' cuando NO existe columna 'nombre'", async () => {
    const buffer = await makeExcelBufferFromRows(
      ["codigo", "descripcion", "tipo"],
      [["1105", "Caja General", "ASSET"]]
    );

    const rows = await ImportService.parseAccountsExcel(buffer);
    expect(rows[0].nombre).toBe("Caja General");
    expect(rows[0].descripcion).toBeUndefined();
  });

  it("[GUARDA 9] con AMBAS columnas 'nombre' y 'descripcion' presentes, no se fusionan (comportamiento actual)", async () => {
    const buffer = await makeExcelBuffer([
      { codigo: "1105", nombre: "Caja General", tipo: "ASSET", descripcion: "Efectivo en caja" },
    ]);

    const rows = await ImportService.parseAccountsExcel(buffer);
    expect(rows[0].nombre).toBe("Caja General");
    expect(rows[0].descripcion).toBe("Efectivo en caja");
  });
});

describe("ImportService.importAccounts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("crea cuentas nuevas correctamente", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.account.create).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await ImportService.importAccounts("company-1", "user-1", [
      { codigo: "1105", nombre: "Caja", tipo: "ASSET" },
    ]);

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("omite cuentas que ya existen", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue({ id: "acc-1" } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await ImportService.importAccounts("company-1", "user-1", [
      { codigo: "1105", nombre: "Caja", tipo: "ASSET" },
    ]);

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

describe("ImportService.generateAccountsTemplate", () => {
  it("genera un buffer Excel válido", async () => {
    const buffer = await ImportService.generateAccountsTemplate();
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("el Excel generado tiene las columnas correctas", async () => {
    const buffer = await ImportService.generateAccountsTemplate();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];
    const firstRow = (ws.getRow(1).values as (string | null)[]).slice(1).map((v) =>
      String(v ?? "").toLowerCase()
    );

    expect(firstRow).toContain("codigo");
    expect(firstRow).toContain("nombre");
    expect(firstRow).toContain("tipo");
  });
});
