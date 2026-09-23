// src/modules/import/services/ImportService.ts
import ExcelJS from "exceljs";
import prisma from "@/lib/prisma";
import { ImportAccountsSchema, type ImportAccountRow } from "../schemas/import.schema";

const ACCOUNT_TYPES = new Set(["ASSET", "CONTRA_ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]);

// Convención estándar venezolana: el primer dígito del código clasifica la cuenta, así es
// como cualquier contador ya lee un plan de cuentas, sin tener que clasificar nada a mano.
// CONTRA_ASSET nunca se infiere (comparte dígito "1" con ASSET) — solo llega por columna "tipo"
// explícita.
function inferAccountTypeFromCode(codigo: string): string | undefined {
  switch (codigo.trim()[0]) {
    case "1": return "ASSET";
    case "2": return "LIABILITY";
    case "3": return "EQUITY";
    case "4": return "REVENUE";
    case "5": case "6": case "7": case "8": case "9": return "EXPENSE";
    default: return undefined;
  }
}

const ACCENT_MAP: Record<string, string> = { "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ñ": "n", "Á": "A", "É": "E", "Í": "I", "Ó": "O", "Ú": "U", "Ñ": "N" };
const stripAccents = (s: string) => s.replace(/[áéíóúñÁÉÍÓÚÑ]/g, (c) => ACCENT_MAP[c] ?? c);

// Fila de importación tal como llega a `importAccounts` — `isPostable` es opcional aquí (a
// diferencia de `ImportAccountRow`, cuya salida de Zod siempre lo resuelve a boolean) para no
// forzar a cada caller/test existente a proveerlo; se asume `true` (detalle) si falta.
type ImportAccountRowInput = Omit<ImportAccountRow, "isPostable"> & { isPostable?: boolean };

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

    // stripAccents primero: "Código"/"Descripción" (archivo real venezolano) deben matchear
    // "codigo"/"descripcion" igual que la plantilla simple sin tilde.
    const headers = (allRows[0] as (string | null)[]).map((h) =>
      stripAccents(String(h ?? "")).toLowerCase().trim()
    );
    const dataRows = allRows.slice(1);
    const hasCol = (key: string) => headers.indexOf(key) >= 0;

    const normalized = dataRows.map((arr) => {
      const values = arr as unknown[];
      const get = (key: string) => {
        const idx = headers.indexOf(key);
        return idx >= 0 ? values[idx] : undefined;
      };

      const codigo = String(get("codigo") ?? "").trim();

      // Nombre: prioriza la columna "nombre"; si no existe, usa "descripcion" como nombre (caso
      // real de la tester, cuyo archivo no tiene una columna "nombre" separada) — no duplicar el
      // valor en ambos campos.
      let nombre: string;
      let descripcion: string | undefined;
      if (hasCol("nombre")) {
        nombre = String(get("nombre") ?? "").trim();
        descripcion = hasCol("descripcion") ? (String(get("descripcion") ?? "").trim() || undefined) : undefined;
      } else {
        nombre = String(get("descripcion") ?? "").trim();
        descripcion = undefined;
      }

      // Tipo: columna "tipo" explícita manda (único camino a CONTRA_ASSET, y deja que el Zod
      // final rechace un valor inválido con su mensaje de siempre) — PERO solo si el valor tiene
      // pinta de ser un intento real de AccountType (>2 caracteres: el más corto válido es
      // "ASSET", 5). El archivo real de la tester también trae una columna "Tipo" (O/C) que
      // normaliza al MISMO nombre de encabezado que la "tipo" ASSET/LIABILITY de la plantilla
      // vieja — un código de 1-2 letras ("O", "C") nunca puede ser un AccountType, así que se
      // ignora y se infiere del dígito, igual que si la columna no existiera.
      const explicitTipo = hasCol("tipo") ? String(get("tipo") ?? "").trim().toUpperCase() : "";
      let tipo: string;
      if (explicitTipo.length > 2) {
        tipo = explicitTipo;
      } else {
        const inferred = inferAccountTypeFromCode(codigo);
        if (!inferred) {
          throw new Error(
            `No se pudo determinar el tipo de cuenta para el código "${codigo}" — agrega una columna "tipo" con ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE/CONTRA_ASSET.`
          );
        }
        tipo = inferred;
      }

      // G/M: "G" = cuenta de título (no admite movimientos); cualquier otro valor, vacío o
      // columna ausente = detalle/movimiento (default seguro — nunca bloquear una cuenta por una
      // columna rara o ausente, rompería la plantilla simple actual).
      const gm = hasCol("g/m") ? String(get("g/m") ?? "").trim().toUpperCase() : "";
      const isPostable = gm !== "G";

      // Nivel, Pre., Ter., C/C, Clase, Tipo(O/C) — significado sin confirmar, se ignoran a
      // propósito: no se mapean a ningún campo (en particular NO "Clase"→isMonetary, hipótesis
      // sin confirmar con consecuencia fiscal real de INPC si se equivoca).

      return { codigo, nombre, tipo, descripcion, isPostable };
    });

    return ImportAccountsSchema.parse(normalized);
  }

  static async importAccounts(
    companyId: string,
    userId: string,
    rows: ImportAccountRowInput[]
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
            type: row.tipo as "ASSET" | "CONTRA_ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE",
            description: row.descripcion,
            isPostable: row.isPostable ?? true,
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
        ipAddress: null,
        userAgent: null,
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
