// src/modules/import/services/ImportService.ts
import ExcelJS from "exceljs";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { p2002TargetIncludes } from "@/lib/prisma-errors";
import {
  ImportAccountsSchema,
  type ImportAccountRow,
  type ImportAccountRowError,
} from "../schemas/import.schema";

const ACCOUNT_TYPES = new Set(["ASSET", "CONTRA_ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]);

// Mismas etiquetas en español que ya usa AccountsTable.tsx (TYPE_LABELS) — un contador
// que no lee inglés no sabe qué es "ASSET". El archivo puede seguir trayendo el nombre
// en inglés del enum (compatibilidad con plantillas viejas o quien ya lo conoce así).
const TIPO_ES_TO_EN: Record<string, string> = {
  ACTIVO: "ASSET",
  "CONTRA-ACTIVO": "CONTRA_ASSET",
  "CONTRA ACTIVO": "CONTRA_ASSET",
  PASIVO: "LIABILITY",
  PATRIMONIO: "EQUITY",
  INGRESO: "REVENUE",
  INGRESOS: "REVENUE",
  GASTO: "EXPENSE",
  GASTOS: "EXPENSE",
};

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

// Bug tester Alpha 2026-09-28: su archivo real trae una fila de título ("PLAN DE
// CUENTAS", merged) antes de la fila de encabezados real — ws.eachRow salta filas
// totalmente vacías pero NO esa fila de título (tiene una celda con contenido), así que
// terminaba siendo allRows[0] y la fila de encabezados de verdad (Código/Descripción/...)
// se procesaba como si fuera una CUENTA con código "" → el error de "tipo" que veía la
// tester en realidad era este, no una columna "tipo" faltante. Se busca la fila de
// encabezados por contenido ("codigo" en alguna celda) en vez de asumir que es la fila 0,
// tolerando cualquier cantidad de filas de título/espaciado arriba.
const MAX_HEADER_SCAN_ROWS = 20;
function findHeaderRowIndex(allRows: unknown[][]): number {
  const limit = Math.min(allRows.length, MAX_HEADER_SCAN_ROWS);
  for (let i = 0; i < limit; i++) {
    const normalized = (allRows[i] as (string | null)[]).map((h) =>
      stripAccents(String(h ?? "")).toLowerCase().trim()
    );
    if (normalized.includes("codigo")) return i;
  }
  return -1;
}

// Normaliza las filas crudas (header + datos, ya separadas en columnas) al shape de
// ImportAccountRow — compartido entre parseAccountsExcel y parseAccountsCsv para no
// duplicar la lógica de columnas (tildes, G/M, Pre., Ter., inferencia de tipo).
function normalizeAccountRows(allRows: unknown[][]): ImportAccountRow[] {
  if (allRows.length < 2) throw new Error("El archivo está vacío");

  const headerIndex = findHeaderRowIndex(allRows);
  if (headerIndex === -1) {
    throw new Error(
      'No se encontró la columna "codigo" en el archivo. Verifica que la primera fila con datos sea la fila de encabezados (codigo, nombre, tipo, descripcion) — quita cualquier título o fila en blanco antes de esa fila.'
    );
  }

  // stripAccents primero: "Código"/"Descripción" (archivo real venezolano) deben matchear
  // "codigo"/"descripcion" igual que la plantilla simple sin tilde.
  const headers = (allRows[headerIndex] as (string | null)[]).map((h) =>
    stripAccents(String(h ?? "")).toLowerCase().trim()
  );
  // Filas separadoras totalmente en blanco entre secciones (común en un plan de cuentas
  // real exportado de otro sistema, p.ej. un espacio entre "CAJAS" y "BANCOS") no son una
  // cuenta — se descartan aquí en vez de reventar más abajo con el mismo error de código
  // vacío que causaba la fila de título mal detectada como encabezado.
  //
  // Bug tester Alpha 2026-10-01: su archivo real es un reporte IMPRESO de otro ERP
  // (Perseo/Profit Plus) — repite el bloque "Nombre de empresa / RIF / 'PLAN DE
  // CUENTAS' / fila de encabezados" cada ~45 filas (una página impresa por bloque), con
  // un footer "Procesado por..." al cierre de cada una. Una fila de encabezados
  // REPETIDA se procesaba como una CUENTA con código literal "Código" →
  // inferAccountTypeFromCode fallaba y abortaba la importación COMPLETA (no solo esa
  // fila). Se descarta aquí cualquier fila que sea ELLA MISMA un encabezado, con el
  // mismo criterio que detecta la primera (findHeaderRowIndex).
  const isHeaderLikeRow = (arr: unknown[]) =>
    arr.some((v) => stripAccents(String(v ?? "")).toLowerCase().trim() === "codigo");
  const dataRows = allRows
    .slice(headerIndex + 1)
    .filter((arr) => (arr as unknown[]).some((v) => String(v ?? "").trim() !== ""))
    .filter((arr) => !isHeaderLikeRow(arr as unknown[]));
  const hasCol = (key: string) => headers.indexOf(key) >= 0;

  // Bug tester Alpha 2026-10-01: su archivo real es un reporte IMPRESO de otro ERP
  // (Perseo/Profit Plus) exportado a Excel — "Descripción" es un encabezado combinado
  // ANCHO (varias columnas de Excel), y el texto de cada cuenta se indenta una columna
  // más a la derecha por cada nivel jerárquico ("ACTIVOS" en una columna, "Caja
  // Principal" cinco niveles después, varias columnas más allá). Buscar por ÍNDICE
  // EXACTO de columna (como antes) deja el 100% de las filas sin nombre — ninguna cae
  // justo en la columna donde vive la etiqueta "Descripción". La columna real de un dato
  // puede ser cualquiera dentro del TRAMO [esta etiqueta, la siguiente etiqueta no
  // vacía) según la profundidad de esa fila. Para la plantilla simple (1 encabezado = 1
  // columna, sin combinar) el tramo mide 1 columna → mismo comportamiento de siempre.
  const headerSpans = new Map<string, [number, number]>();
  {
    const labeled = headers
      .map((h, i) => ({ h, i }))
      .filter(({ h }) => h !== "");
    labeled.forEach(({ h, i }, pos) => {
      const end = pos + 1 < labeled.length ? labeled[pos + 1].i : headers.length;
      if (!headerSpans.has(h)) headerSpans.set(h, [i, end]);
    });
  }

  // Filas cuyo código no se pudo clasificar (sin columna "tipo" explícita ni dígito
  // reconocible) — en un reporte impreso multi-página esto es el nombre de la empresa,
  // el RIF, o el título "PLAN DE CUENTAS" repetidos antes de cada encabezado repetido
  // (ninguno es una cuenta real). Se excluyen de `normalized` en vez de abortar TODA la
  // importación por una fila que no es un dato del usuario — pero si el archivo termina
  // sin NINGUNA fila reconocible, sí se informa (con el primer código no reconocido)
  // en vez de un vacío "El archivo está vacío" que no explica nada.
  const codigosNoReconocidos: string[] = [];

  const normalized = dataRows.flatMap((arr) => {
    const values = arr as unknown[];
    const get = (key: string) => {
      const span = headerSpans.get(key);
      if (!span) return undefined;
      const [start, end] = span;
      for (let i = start; i < end; i++) {
        const v = values[i];
        if (String(v ?? "").trim() !== "") return v;
      }
      return undefined;
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
    const explicitTipoRaw = hasCol("tipo") ? stripAccents(String(get("tipo") ?? "")).trim().toUpperCase() : "";
    // Acepta "Activo"/"Pasivo"/etc (español, lo que ve el usuario en la plantilla) y también
    // "ASSET"/"LIABILITY"/etc (inglés, nombre real del enum) — TIPO_ES_TO_EN no toca lo que
    // ya es un nombre de enum válido, solo traduce si reconoce la palabra en español.
    const explicitTipo = TIPO_ES_TO_EN[explicitTipoRaw] ?? explicitTipoRaw;
    let tipo: string;
    if (explicitTipo.length > 2) {
      tipo = explicitTipo;
    } else {
      const inferred = inferAccountTypeFromCode(codigo);
      if (!inferred) {
        codigosNoReconocidos.push(codigo || "(vacío)");
        return [];
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

    return [{ codigo, nombre, tipo, descripcion, isPostable, isBudgetable, requiresThirdParty }];
  });

  if (normalized.length === 0 && codigosNoReconocidos.length > 0) {
    throw new Error(
      `No se pudo determinar el tipo de cuenta para el código "${codigosNoReconocidos[0]}" — agrega una columna "tipo" con Activo/Pasivo/Patrimonio/Ingreso/Gasto/Contra-activo.`
    );
  }

  // Bug tester Alpha 2026-10-01: una fila inválida (código/nombre/tipo vacío o
  // desalineado con los encabezados) hacía que ImportAccountsSchema.parse() lanzara un
  // ZodError crudo — y en Zod 4 `error.message` de un ZodError es el JSON *sin procesar*
  // de todos los issues (`[{"origin":"string","code":"too_small",...}]`), que
  // mapPrismaError no reconoce como error técnico (no tiene ninguna de sus keywords) y
  // deja pasar tal cual hasta el toast del navegador. Un archivo con TODAS las filas
  // desalineadas (p.ej. una columna de más antes de "código") generaba un dump de
  // cientos de líneas de JSON ilegible en vez de un mensaje de negocio.
  try {
    return ImportAccountsSchema.parse(normalized);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const filas = new Set<number>();
      for (const issue of err.issues) {
        const idx = issue.path[0];
        if (typeof idx === "number") filas.add(idx + 1); // 1-indexado, fila de datos (no de Excel)
      }
      // Issue a nivel de ARRAY (path vacío, p.ej. ImportAccountsSchema.min(1) con 0
      // filas) no tiene fila que señalar — su propio mensaje ("El archivo está vacío")
      // ya es de negocio, no crudo; no envolverlo en el conteo "0 filas...".
      if (filas.size === 0) throw new Error(err.issues[0]?.message ?? "El archivo está vacío");
      const total = filas.size;
      const muestra = [...filas].sort((a, b) => a - b).slice(0, 5);
      throw new Error(
        `${total} fila${total === 1 ? "" : "s"} del archivo no ${total === 1 ? "tiene" : "tienen"} ` +
          `código, nombre o tipo válidos (fila${muestra.length === 1 ? "" : "s"} de datos ${muestra.join(", ")}` +
          `${total > muestra.length ? "…" : ""}). Esto suele pasar cuando los datos quedan desalineados ` +
          `con los encabezados (código, nombre, tipo) — revisa que no haya columnas movidas, combinadas o ` +
          `vacías antes de los datos.`
      );
    }
    throw err;
  }
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
  ): Promise<{ created: number; skipped: number; errors: ImportAccountRowError[] }> {
    let created = 0;
    let skipped = 0;
    const errors: ImportAccountRowError[] = [];

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
      } catch (e) {
        // ADR-056: el único de (companyId, name) ahora es PARCIAL (solo entre cuentas
        // de movimiento) — un P2002 aquí es un duplicado real de nombre entre dos
        // cuentas de movimiento, no una colisión de título, así que vale la pena
        // decirlo. Antes caía al catch genérico sin explicar cuál de los dos @@unique
        // había chocado (CLAUDE.md: "Errores Prisma al cliente? Nunca raw").
        //
        // `row` completo viaja en el error (no solo el código) para que el cliente
        // pueda ofrecer "renombrar y reintentar esta fila" sin tener que reconstruir
        // el objeto original — feedback del dueño 2026-10-01.
        const fullRow: ImportAccountRow = {
          codigo: row.codigo,
          nombre: row.nombre,
          tipo: row.tipo as ImportAccountRow["tipo"],
          descripcion: row.descripcion,
          isPostable: row.isPostable ?? true,
          isBudgetable: row.isBudgetable ?? false,
          requiresThirdParty: row.requiresThirdParty ?? false,
        };
        if (p2002TargetIncludes(e, "name")) {
          errors.push({
            row: fullRow,
            reason: "duplicate_name",
            message:
              `Fila ${row.codigo}: ya existe una cuenta de movimiento con el nombre "${row.nombre}" — ` +
              `cámbiale el nombre en el archivo para diferenciarla y vuelve a importar esta fila`,
          });
        } else if (p2002TargetIncludes(e, "code")) {
          errors.push({
            row: fullRow,
            reason: "duplicate_code",
            message: `Fila ${row.codigo}: ya existe una cuenta con ese código`,
          });
        } else {
          errors.push({ row: fullRow, reason: "unknown", message: `Fila ${row.codigo}: error al importar` });
        }
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
      { header: "tipo", width: 14 },
      { header: "descripcion", width: 35 },
    ];

    // Feedback tester Alpha 2026-09-28: la plantilla traía 6 cuentas de ejemplo ya
    // llenas (Caja General, Bancos...) — parecía que ya tenía datos reales cargados y
    // listos para enviar, en vez de un formato vacío para que ella escriba SU plan de
    // cuentas. Solo encabezados; la caja azul de instrucciones en la página ya explica
    // las columnas y los tipos válidos, no hace falta una fila de ejemplo aquí.

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
