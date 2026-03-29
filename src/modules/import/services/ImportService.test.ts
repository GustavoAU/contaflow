// src/modules/import/services/ImportService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as XLSX from "xlsx";

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

function makeExcelBuffer(rows: object[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

describe("ImportService.parseAccountsExcel", () => {
  it("parsea un Excel v├ílido correctamente", () => {
    const buffer = makeExcelBuffer([
      { codigo: "1105", nombre: "Caja General", tipo: "ASSET", descripcion: "Efectivo" },
      { codigo: "2105", nombre: "Proveedores", tipo: "LIABILITY" },
    ]);

    const rows = ImportService.parseAccountsExcel(buffer);
    expect(rows).toHaveLength(2);
    expect(rows[0].codigo).toBe("1105");
    expect(rows[1].tipo).toBe("LIABILITY");
  });

  it("lanza error si el tipo es inv├ílido", () => {
    const buffer = makeExcelBuffer([{ codigo: "1105", nombre: "Caja", tipo: "INVALIDO" }]);

    expect(() => ImportService.parseAccountsExcel(buffer)).toThrow();
  });

  it("lanza error si el archivo est├í vac├¡o", () => {
    const buffer = makeExcelBuffer([]);
    expect(() => ImportService.parseAccountsExcel(buffer)).toThrow();
  });

  it("normaliza columnas en may├║sculas", () => {
    const buffer = makeExcelBuffer([{ CODIGO: "3105", NOMBRE: "Capital", TIPO: "equity" }]);

    const rows = ImportService.parseAccountsExcel(buffer);
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
  it("genera un buffer Excel v├ílido", () => {
    const buffer = ImportService.generateAccountsTemplate();
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("el Excel generado tiene las columnas correctas", () => {
    const buffer = ImportService.generateAccountsTemplate();
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, string>[];

    expect(rows[0]).toHaveProperty("codigo");
    expect(rows[0]).toHaveProperty("nombre");
    expect(rows[0]).toHaveProperty("tipo");
  });
});