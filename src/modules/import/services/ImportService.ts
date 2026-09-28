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

// Fila CSV cruda respetando comillas ("valor, con coma" no se parte en dos columnas) y
// comillas escapadas ("" dentro de un campo entre comillas → un solo "). No usar
// String.split(",") — rompe con cualquier valor que traiga el delimitador adentro.
function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      result.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

// Normaliza las filas crudas (header + datos, ya separadas en columnas) al shape de
// ImportAccountRow — compartido entre parseAccountsExcel y parseAccountsCsv para no
// duplicar la lógica de columnas (tildes, G/M, Pre., Ter., inferencia de tipo).
function normalizeAccountRows(allRows: unknown[][]): ImportAccountRow[] {
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

    // Pre.: "SI" = la cuenta se puede usar en líneas de presupuesto (BudgetLine). Confirmado
    // por el dueño 2026-09-26. Cualquier otro valor, vacío o columna ausente = false (default
    // seguro). El header conserva el punto tras stripAccents+lowercase+trim ("pre.").
    const pre = hasCol("pre.") ? String(get("pre.") ?? "").trim().toUpperCase() : "";
    const isBudgetable = pre === "SI";

    // Ter.: "SI" = cuenta "pote" que exige tercero (Customer/Vendor/Partner/Employee) en cada
    // línea de asiento — decisión del dueño 2026-09-26 (ADR-054). Cualquier otro valor, vacío
    // o columna ausente = false (default seguro, misma convención que Pre./isBudgetable).
    const ter = hasCol("ter.") ? String(get("ter.") ?? "").trim().toUpperCase() : "";
    const requiresThirdParty = ter === "SI";

    // Nivel, C/C, Clase, Tipo(O/C) — significado sin confirmar o pendiente de otra tanda, se
    // ignoran a propósito (en particular NO "Clase"→isMonetary: hipótesis descartada por
    // evidencia real, ver ADR-053 — C/C confirmado pero diferido a otra tanda).

    return { codigo, nombre, tipo, descripcion, isPostable, isBudgetable, requiresThirdParty };
  });

  return ImportAccountsSchema.parse(normalized);
}

// Fila de importación tal como llega a `importAccounts` — `isPostable` es opcional aquí (a
// diferencia de `ImportAccountRow`, cuya salida de Zod siempre lo resuelve a boolean) para no
// forzar a cada caller/test existente a proveerlo; se asume `true` (detalle) si falta.
type ImportAccountRowInput = Omit<ImportAccountRow, "isPostable" | "isBudgetable" | "requiresThirdParty"> & {
  isPostable?: boolean;
  isBudgetable?: boolean;
  requiresThirdParty?: boolean;
};

export class ImportService {
  static async parseAccountsExcel(buffer: Buffer): Promise<ImportAccountRow[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];

    // Bug tester Alpha 2026-09-27: un archivo que no es un .xlsx real (CSV renombrado,
    // .xls antiguo, protegido con contraseña, corrupto) hace que exceljs "cargue" sin
    // lanzar error pero sin producir ninguna hoja — ws.eachRow explotaba con un
    // TypeError crudo ("Cannot read properties of undefined") en vez de un mensaje
    // de negocio.
    if (!ws) {
      throw new Error(
        "No se pudo leer ninguna hoja del archivo. Verifica que sea un Excel (.xlsx) válido, sin contraseña y no dañado. Si tu archivo es .xls antiguo o CSV, ábrelo en Excel y guárdalo como .xlsx."
      );
    }

    const allRows: unknown[][] = [];
    ws.eachRow((row: ExcelJS.Row) => {
      allRows.push((row.values as unknown[]).slice(1));
    });

    return normalizeAccountRows(allRows);
  }

  // CSV real (no el .xlsx.load() que se usaba antes para todo — un CSV no es un zip y
  // nunca iba a cargar). Detecta el delimitador por conteo en el encabezado: Excel en
  // configuración regional VE/LatAm exporta CSV con ";" porque "," es el separador
  // decimal — de ahí que no se pueda asumir coma siempre.
  static async parseAccountsCsv(buffer: Buffer): Promise<ImportAccountRow[]> {
    let text = buffer.toString("utf-8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);

    if (lines.length === 0) throw new Error("El archivo está vacío");

    const semiCount = (lines[0].match(/;/g) ?? []).length;
    const commaCount = (lines[0].match(/,/g) ?? []).length;
    const delimiter = semiCount > commaCount ? ";" : ",";

    const allRows = lines.map((line) => parseCsvLine(line, delimiter));
    return normalizeAccountRows(allRows);
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
            isBudgetable: row.isBudgetable ?? false,
            requiresThirdParty: row.requiresThirdParty ?? false,
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
