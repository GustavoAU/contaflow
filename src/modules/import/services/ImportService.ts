// src/modules/import/services/ImportService.ts
import ExcelJS from "exceljs";
import prisma from "@/lib/prisma";
import { ImportAccountsSchema, type ImportAccountRow } from "../schemas/import.schema";

export class ImportService {
  static async parseAccountsExcel(buffer: Buffer): Promise<ImportAccountRow[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];

    const allRows: unknown[][] = [];
    ws.eachRow((row: ExcelJS.Row) => {
      allRows.push((row.values as unknown[]).slice(1));
    });

    if (allRows.length < 2) throw new Error("El archivo está vacío");

    const headers = (allRows[0] as (string | null)[]).map((h) =>
      String(h ?? "").toLowerCase().trim()
    );
    const dataRows = allRows.slice(1);

    const normalized = dataRows.map((arr) => {
      const values = arr as unknown[];
      const get = (key: string) => {
        const idx = headers.indexOf(key);
        return idx >= 0 ? values[idx] : undefined;
      };
      return {
        codigo: String(get("codigo") ?? "").trim(),
        nombre: String(get("nombre") ?? "").trim(),
        tipo: String(get("tipo") ?? "").trim().toUpperCase(),
        descripcion: String(get("descripcion") ?? "").trim() || undefined,
      };
    });

    return ImportAccountsSchema.parse(normalized);
  }

  static async importAccounts(
    companyId: string,
    userId: string,
    rows: ImportAccountRow[]
  ): Promise<{ created: number; skipped: number; errors: string[] }> {
    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of rows) {
      try {
        const exists = await prisma.account.findUnique({
          where: { companyId_code: { companyId, code: row.codigo } },
        });

        if (exists) {
          skipped++;
          continue;
        }

        await prisma.account.create({
          data: {
            code: row.codigo,
            name: row.nombre,
            type: row.tipo as "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE",
            description: row.descripcion,
            companyId,
          },
        });

        created++;
      } catch {
        errors.push(`Fila ${row.codigo}: error al importar`);
      }
    }

    await prisma.auditLog.create({
      data: {
        companyId,
        entityId: companyId,
        entityName: "Account",
        action: "IMPORT",
        userId,
        newValue: { created, skipped, errors },
      },
    });

    return { created, skipped, errors };
  }

  static async generateAccountsTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Plan de Cuentas");

    ws.columns = [
      { header: "codigo", width: 10 },
      { header: "nombre", width: 30 },
      { header: "tipo", width: 12 },
      { header: "descripcion", width: 35 },
    ];

    const data = [
      { codigo: "1105", nombre: "Caja General", tipo: "ASSET", descripcion: "Efectivo en caja" },
      { codigo: "1110", nombre: "Bancos", tipo: "ASSET", descripcion: "Cuentas bancarias" },
      { codigo: "2105", nombre: "Proveedores", tipo: "LIABILITY", descripcion: "Cuentas por pagar" },
      { codigo: "3105", nombre: "Capital Social", tipo: "EQUITY", descripcion: "Capital de la empresa" },
      { codigo: "4105", nombre: "Ventas", tipo: "REVENUE", descripcion: "Ingresos por ventas" },
      { codigo: "5105", nombre: "Gastos de Operación", tipo: "EXPENSE", descripcion: "Gastos operativos" },
    ];

    data.forEach((row) =>
      ws.addRow([row.codigo, row.nombre, row.tipo, row.descripcion])
    );

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
