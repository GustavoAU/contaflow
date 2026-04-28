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
