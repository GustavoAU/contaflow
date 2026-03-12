// src/modules/import/services/ImportService.ts
import * as XLSX from "xlsx";
import prisma from "@/lib/prisma";
import { ImportAccountsSchema, type ImportAccountRow } from "../schemas/import.schema";

export class ImportService {
  static parseAccountsExcel(buffer: Buffer): ImportAccountRow[] {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[];

    // Normalizar columnas a minúsculas sin espacios
    const normalized = rows.map((row) => ({
      codigo: String(row["codigo"] ?? row["Codigo"] ?? row["CODIGO"] ?? "").trim(),
      nombre: String(row["nombre"] ?? row["Nombre"] ?? row["NOMBRE"] ?? "").trim(),
      tipo: String(row["tipo"] ?? row["Tipo"] ?? row["TIPO"] ?? "")
        .trim()
        .toUpperCase(),
      descripcion:
        String(row["descripcion"] ?? row["Descripcion"] ?? row["DESCRIPCION"] ?? "").trim() ||
        undefined,
    }));

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
        entityId: companyId,
        entityName: "Account",
        action: "IMPORT",
        userId,
        newValue: { created, skipped, errors },
      },
    });

    return { created, skipped, errors };
  }

  static generateAccountsTemplate(): Buffer {
    const data = [
      { codigo: "1105", nombre: "Caja General", tipo: "ASSET", descripcion: "Efectivo en caja" },
      { codigo: "1110", nombre: "Bancos", tipo: "ASSET", descripcion: "Cuentas bancarias" },
      {
        codigo: "2105",
        nombre: "Proveedores",
        tipo: "LIABILITY",
        descripcion: "Cuentas por pagar",
      },
      {
        codigo: "3105",
        nombre: "Capital Social",
        tipo: "EQUITY",
        descripcion: "Capital de la empresa",
      },
      { codigo: "4105", nombre: "Ventas", tipo: "REVENUE", descripcion: "Ingresos por ventas" },
      {
        codigo: "5105",
        nombre: "Gastos de Operación",
        tipo: "EXPENSE",
        descripcion: "Gastos operativos",
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Plan de Cuentas");

    // Ancho de columnas
    worksheet["!cols"] = [{ wch: 10 }, { wch: 30 }, { wch: 12 }, { wch: 35 }];

    return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  }
}
