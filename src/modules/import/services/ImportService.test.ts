// src/modules/import/services/ImportService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";

// SPEC-008 RN-11: el importador valida el título padre de cada cuenta de movimiento. Puede
// consultarlo con `findMany` (por lote) o `findFirst` (por fila); el mock expone ambos para no
// atar los tests a una forma de consulta — lo que se verifica es el RESULTADO, evaluado contra una
// BD en memoria (ver src/__tests__/helpers/in-memory-account-db.ts).
vi.mock("@/lib/prisma", () => ({
  default: {
    account: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
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
import {
  accountRow,
  createAccountDb,
  type AccountDb,
} from "@/__tests__/helpers/in-memory-account-db";

// `mockClear` no restablece implementaciones: lo que un test conecta no debe filtrarse al siguiente.
function resetAccountMocks() {
  for (const fn of [
    prisma.account.findUnique,
    prisma.account.findFirst,
    prisma.account.findMany,
    prisma.account.create,
    prisma.auditLog.create,
  ]) {
    vi.mocked(fn).mockReset();
  }
}

/** Conecta una BD en memoria a `prisma.account.*` (cada consulta se evalúa contra filas reales). */
function mountAccountDb(db: AccountDb) {
  vi.mocked(prisma.account.findUnique).mockImplementation(db.findUnique as never);
  vi.mocked(prisma.account.findFirst).mockImplementation(db.findFirst as never);
  vi.mocked(prisma.account.findMany).mockImplementation(db.findMany as never);
  vi.mocked(prisma.account.create).mockImplementation(db.create as never);
}

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

// Cast defensivo equivalente para `isBudgetable` (columna "Pre." del ERP real,
// feedback tester Alpha 2026-09-26 — ver ADR-053 para el precedente isPostable/G-M).
type RowWithBudgetable = ImportAccountRow & { isBudgetable?: boolean };

// Cast defensivo equivalente para `requiresThirdParty` (columna "Ter." del ERP real,
// decision del dueno 2026-09-26, ADR-054 -- ver ADR-053 para el precedente isPostable/G-M).
type RowWithThirdParty = ImportAccountRow & { requiresThirdParty?: boolean };

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

  // Bug tester Alpha 2026-09-27: un .xlsx válido pero sin ninguna hoja hacía crashear
  // ws.eachRow con un TypeError crudo ("Cannot read properties of undefined") en vez
  // de un mensaje de negocio — reproduce el caso real sin depender de un archivo .xls
  // o .csv malformado (que exceljs.xlsx.load podría rechazar de otras formas).
  it("da un mensaje de negocio si el archivo no tiene ninguna hoja legible", async () => {
    const wb = new ExcelJS.Workbook();
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(ImportService.parseAccountsExcel(buffer)).rejects.toThrow(
      /no se pudo leer ninguna hoja/i
    );
  });

  it("normaliza columnas en mayúsculas", async () => {
    const buffer = await makeExcelBuffer([{ CODIGO: "3105", NOMBRE: "Capital", TIPO: "equity" }]);

    const rows = await ImportService.parseAccountsExcel(buffer);
    expect(rows[0].tipo).toBe("EQUITY");
  });

  // Feedback tester Alpha 2026-09-28: un contador que no lee inglés no sabe qué es
  // "ASSET" — la plantilla y el "tipo" que escribe ahora son en español, se traducen
  // al enum real (TIPO_ES_TO_EN) antes de llegar a Zod.
  it.each([
    ["Activo", "ASSET"],
    ["Pasivo", "LIABILITY"],
    ["Patrimonio", "EQUITY"],
    ["Ingreso", "REVENUE"],
    ["Gasto", "EXPENSE"],
    ["Contra-activo", "CONTRA_ASSET"],
    ["ACTIVO", "ASSET"],
    ["activo", "ASSET"],
  ])("traduce el tipo en español %s al enum %s", async (tipoEs, esperado) => {
    const buffer = await makeExcelBuffer([{ codigo: "9105", nombre: "Cuenta", tipo: tipoEs }]);
    const rows = await ImportService.parseAccountsExcel(buffer);
    expect(rows[0].tipo).toBe(esperado);
  });

  it("sigue aceptando el nombre del enum en inglés (compatibilidad)", async () => {
    const buffer = await makeExcelBuffer([{ codigo: "1105", nombre: "Caja", tipo: "ASSET" }]);
    const rows = await ImportService.parseAccountsExcel(buffer);
    expect(rows[0].tipo).toBe("ASSET");
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

  it("[RED 2] sin columna G/M: isPostable lo decide la longitud del código (ADR-059)", async () => {
    const buffer = await makeExcelBuffer([
      { codigo: "1105", nombre: "Caja General", tipo: "ASSET", descripcion: "Efectivo" },
      { codigo: "1.1.01.01.001", nombre: "Caja Principal", tipo: "ASSET" },
    ]);

    const rows = (await ImportService.parseAccountsExcel(buffer)) as RowWithPostable[];
    expect(rows[0].isPostable).toBe(false); // 4 dígitos → título
    expect(rows[1].isPostable).toBe(true); // 9 dígitos → movimiento
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
    const buffer = await makeExcelBufferFromRows(["codigo", "nombre"], [["ABC", "Cuenta rara"]]);

    await expect(ImportService.parseAccountsExcel(buffer)).rejects.toThrow(/ABC/);
  });

  it("[RED 6] la columna G/M se IGNORA: manda el código (ADR-059)", async () => {
    const buffer = await makeExcelBufferFromRows(
      ["codigo", "nombre", "tipo", "G/M"],
      [
        ["1.1.01.01.001", "Caja Principal", "ASSET", "G"], // 9 dígitos marcada G → movimiento
        ["1.1.01", "CAJAS", "ASSET", " M "], // 4 dígitos marcada M → título
      ]
    );

    const rows = (await ImportService.parseAccountsExcel(buffer)) as RowWithPostable[];
    expect(rows[0].isPostable).toBe(true);
    expect(rows[1].isPostable).toBe(false);
  });

  it("[ADR-059] títulos y subtítulos con el mismo nombre se importan sin chocar (el nombre no es único)", async () => {
    const buffer = await makeExcelBufferFromRows(
      ["codigo", "descripcion"],
      [
        ["3.2.01", "UTILIDADES ACUMULADAS"],
        ["3.2.01.01", "UTILIDADES ACUMULADAS"],
        ["3.2.01.01.001", "Utilidades Acumuladas"],
      ]
    );

    const rows = (await ImportService.parseAccountsExcel(buffer)) as RowWithPostable[];
    expect(rows.map((r) => r.isPostable)).toEqual([false, false, true]);
  });

  it("[GUARDA/RED 7] columnas Nivel/Pre./Ter./C-C/Clase/Tipo(O-C) en blanco no rompen la importación", async () => {
    const buffer = await makeExcelBufferFromRows(
      ["codigo", "nombre", "G/M", "Nivel", "Pre.", "Ter.", "C/C", "Clase", "Tipo"],
      [["1.2.01.01.001", "Cuentas por Cobrar Comerciales", "M", "", "", "", "", "", ""]]
    );

    const rows = (await ImportService.parseAccountsExcel(buffer)) as RowWithPostable[];
    expect(rows).toHaveLength(1);
    expect(rows[0].tipo).toBe("ASSET"); // inferido del dígito "1" (no hay columna tipo ASSET explícita)
    expect(rows[0].isPostable).toBe(true); // M
  });

  // ---------------------------------------------------------------------------
  // Bug tester Alpha 2026-09-28: el archivo real traía una fila de título ("PLAN DE
  // CUENTAS") antes de la fila de encabezados — se tomaba como encabezados y la fila de
  // encabezados real se procesaba como una cuenta con código "", disparando el mensaje
  // de "no se pudo determinar el tipo" que en realidad no tenía nada que ver con "tipo".
  // ---------------------------------------------------------------------------

  it("[RED — header] fila de título antes del encabezado real no rompe el import", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["PLAN DE CUENTAS"]);
    ws.addRow(["Código", "Descripción", "G/M", "Nivel", "Pre.", "Ter.", "C/C", "Clase", "Tipo"]);
    ws.addRow(["1", "ACTIVOS", "G", "1", "NO", "NO", "NO", "M", "O"]);
    ws.addRow(["1.1.01.01.001", "Caja Principal", "M", "5", "NO", "NO", "NO", "M", "C"]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const rows = (await ImportService.parseAccountsExcel(buffer)) as RowWithPostable[];

    expect(rows).toHaveLength(2);
    expect(rows[0].codigo).toBe("1");
    expect(rows[0].nombre).toBe("ACTIVOS");
    expect(rows[0].tipo).toBe("ASSET");
    expect(rows[1].nombre).toBe("Caja Principal");
  });

  // El caso de una fila Excel realmente vacía ya lo filtra exceljs (row.hasValues=false,
  // ni siquiera llega a allRows) — el caso real que sí llega es una "fila en blanco" que
  // solo tiene delimitadores (CSV exportado de otro sistema con una fila ",,," entre
  // secciones), que sobrevive al filtro de líneas vacías porque ",,," no es un string vacío.
  it("[RED — header] fila CSV solo con delimitadores (sin datos) entre cuentas no rompe el import", async () => {
    const csv = "codigo,nombre,tipo\n1105,Caja General,ASSET\n,,,\n2105,Proveedores,LIABILITY";
    const rows = await ImportService.parseAccountsCsv(Buffer.from(csv, "utf-8"));
    expect(rows).toHaveLength(2);
    expect(rows[1].codigo).toBe("2105");
  });

  it("[RED — header] sin columna 'codigo' en ningún lado del archivo → error claro", async () => {
    const buffer = await makeExcelBufferFromRows(["nombre", "tipo"], [["Caja General", "ASSET"]]);

    await expect(ImportService.parseAccountsExcel(buffer)).rejects.toThrow(/columna "codigo"/i);
  });

  // ---------------------------------------------------------------------------
  // Bug tester Alpha 2026-10-01: su archivo real es un reporte IMPRESO de otro ERP
  // (Perseo/Profit Plus) — "Descripción" es un encabezado COMBINADO ancho y el texto de
  // cada cuenta se indenta una columna más a la derecha por nivel jerárquico. Buscar por
  // índice exacto de columna dejaba el nombre vacío en el 100% de las filas.
  // ---------------------------------------------------------------------------

  it("[RED — indentación] 'Descripción' en columna combinada ancha: el dato puede caer en cualquier columna del tramo según la profundidad", async () => {
    // codigo=0, descripcion=1 (ancla), 2/3/4 = parte del mismo tramo combinado, g/m=5
    const buffer = await makeExcelBufferFromRows(
      ["codigo", "descripcion", "", "", "", "G/M"],
      [
        ["1", "ACTIVOS", "", "", "", "G"], // nivel 0: alineado con el ancla
        ["1.1.01", "", "", "CAJAS", "", "G"], // nivel 2: 2 columnas más a la derecha
        ["1.1.01.01.001", "", "", "", "Caja Principal", "M"], // nivel 4: 3 columnas más a la derecha
      ]
    );

    const rows = (await ImportService.parseAccountsExcel(buffer)) as RowWithPostable[];

    expect(rows).toHaveLength(3);
    expect(rows[0].nombre).toBe("ACTIVOS");
    expect(rows[1].nombre).toBe("CAJAS");
    expect(rows[1].isPostable).toBe(false); // G
    expect(rows[2].nombre).toBe("Caja Principal");
    expect(rows[2].isPostable).toBe(true); // M
  });

  it("[RED — indentación] la plantilla simple (1 encabezado = 1 columna) sigue funcionando igual (tramo de ancho 1)", async () => {
    const buffer = await makeExcelBuffer([
      { codigo: "1105", nombre: "Caja General", tipo: "ASSET" },
    ]);
    const rows = await ImportService.parseAccountsExcel(buffer);
    expect(rows[0].nombre).toBe("Caja General");
  });

  // ---------------------------------------------------------------------------
  // Bug tester Alpha 2026-10-01: el mismo archivo repite, cada ~45 filas (una página
  // impresa por bloque), el nombre de la empresa, el RIF, "PLAN DE CUENTAS" y la fila de
  // encabezados — ninguno es una cuenta real. Antes, la fila de encabezados repetida se
  // procesaba como código "Código" → inferAccountTypeFromCode fallaba y ABORTABA TODO el
  // archivo (no solo esa fila).
  // ---------------------------------------------------------------------------

  it("[RED — multi-página] encabezado repetido y bloque de membrete (empresa/RIF/título) se ignoran sin abortar el resto", async () => {
    const buffer = await makeExcelBufferFromRows(
      ["codigo", "nombre", "tipo"],
      [
        ["1105", "Caja General", "ASSET"],
        ["FARMACIA EJEMPLO, C.A.", "", ""], // membrete repetido — no es una cuenta
        ["R.I.F J000000000", "", ""],
        ["codigo", "nombre", "tipo"], // encabezado repetido (página 2)
        ["2105", "Proveedores", "LIABILITY"],
        ["Procesado por FARMACIA EJEMPLO, C.A.", "", ""], // footer del reporte impreso
      ]
    );

    const rows = await ImportService.parseAccountsExcel(buffer);

    expect(rows).toHaveLength(2);
    expect(rows[0].codigo).toBe("1105");
    expect(rows[1].codigo).toBe("2105");
  });

  it("[RED — multi-página] archivo con SOLO membrete (ninguna cuenta real) sigue dando un error claro", async () => {
    const buffer = await makeExcelBufferFromRows(
      ["codigo", "nombre", "tipo"],
      [["FARMACIA EJEMPLO, C.A.", "", ""]]
    );

    await expect(ImportService.parseAccountsExcel(buffer)).rejects.toThrow(/FARMACIA EJEMPLO/);
  });

  // ---------------------------------------------------------------------------
  // Bug tester Alpha 2026-10-01: ImportAccountsSchema.parse() (array completo) lanzaba un
  // ZodError crudo cuando alguna fila quedaba inválida — en Zod 4, error.message de un
  // ZodError es el JSON SIN PROCESAR de todos los issues, y mapPrismaError no lo reconoce
  // como técnico, así que llegaba tal cual al toast del navegador (un dump de cientos de
  // líneas de JSON ilegible).
  // ---------------------------------------------------------------------------

  it("[RED — error crudo] fila con código numérico pero sin nombre → mensaje de negocio, nunca el JSON crudo de Zod", async () => {
    const buffer = await makeExcelBufferFromRows(
      ["codigo", "nombre", "tipo"],
      [
        ["1105", "Caja General", "ASSET"],
        ["1110", "", "ASSET"], // código válido, pero sin nombre — SÍ debe reportarse
      ]
    );

    await expect(ImportService.parseAccountsExcel(buffer)).rejects.toThrow(
      /1 fila.*no tiene.*v[aá]lid/i
    );
    try {
      await ImportService.parseAccountsExcel(buffer);
      expect.unreachable();
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toMatch(/too_small/);
      expect(msg).not.toMatch(/"origin"/);
      expect(msg).not.toMatch(/"path"/);
    }
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

  // ---------------------------------------------------------------------------
  // Feature: "Pre." → Account.isBudgetable (feedback tester Alpha 2026-09-26).
  // La cuenta "formula presupuesto" (usable en BudgetLine). Sin consecuencia
  // fiscal — solo filtrado/UX. Ver ADR-053 para el precedente isPostable/G-M.
  // ---------------------------------------------------------------------------

  it("[RED — isBudgetable 1] columna 'Pre.' con SI/NO/vacío mapea a isBudgetable true/false/false", async () => {
    const buffer = await makeExcelBufferFromRows(
      ["codigo", "nombre", "tipo", "Pre."],
      [
        ["1105", "Caja General", "ASSET", "SI"],
        ["2105", "Proveedores", "LIABILITY", "NO"],
        ["3105", "Capital Social", "EQUITY", ""],
      ]
    );

    const rows = (await ImportService.parseAccountsExcel(buffer)) as RowWithBudgetable[];

    expect(rows[0].isBudgetable).toBe(true); // "SI"
    expect(rows[1].isBudgetable).toBe(false); // "NO"
    expect(rows[2].isBudgetable).toBe(false); // vacío
  });

  it("[RED — isBudgetable 2] 'Pre.' en minúscula ('si') o con espacios (' SI ') sigue siendo true", async () => {
    const buffer = await makeExcelBufferFromRows(
      ["codigo", "nombre", "tipo", "Pre."],
      [
        ["1105", "Caja", "ASSET", "si"],
        ["1110", "Banco", "ASSET", " SI "],
      ]
    );

    const rows = (await ImportService.parseAccountsExcel(buffer)) as RowWithBudgetable[];
    expect(rows[0].isBudgetable).toBe(true);
    expect(rows[1].isBudgetable).toBe(true);
  });

  it("[RED — isBudgetable 3] sin columna 'Pre.' en absoluto (plantilla simple actual) → isBudgetable false para todas las filas", async () => {
    const buffer = await makeExcelBuffer([
      { codigo: "1105", nombre: "Caja General", tipo: "ASSET", descripcion: "Efectivo" },
      { codigo: "2105", nombre: "Proveedores", tipo: "LIABILITY" },
    ]);

    const rows = (await ImportService.parseAccountsExcel(buffer)) as RowWithBudgetable[];
    expect(rows[0].isBudgetable).toBe(false);
    expect(rows[1].isBudgetable).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Feature: "Ter." -> Account.requiresThirdParty (decision del dueno 2026-09-26,
  // ADR-054). Cuenta "pote" que exige indicar el tercero (Customer/Vendor/Partner/
  // Employee) en cada linea de asiento -- ver src/lib/prisma-tercero-required-gate.ts.
  // Ver ADR-053 para el precedente isPostable/G-M e isBudgetable/Pre.
  // ---------------------------------------------------------------------------

  it("[RED — requiresThirdParty 1] columna 'Ter.' con SI/NO/vacío mapea a requiresThirdParty true/false/false", async () => {
    const buffer = await makeExcelBufferFromRows(
      ["codigo", "nombre", "tipo", "Ter."],
      [
        ["1201", "Cuentas por Cobrar Clientes", "ASSET", "SI"],
        ["2105", "Proveedores", "LIABILITY", "NO"],
        ["3105", "Capital Social", "EQUITY", ""],
      ]
    );

    const rows = (await ImportService.parseAccountsExcel(buffer)) as RowWithThirdParty[];

    expect(rows[0].requiresThirdParty).toBe(true); // "SI"
    expect(rows[1].requiresThirdParty).toBe(false); // "NO"
    expect(rows[2].requiresThirdParty).toBe(false); // vacío
  });

  it("[RED — requiresThirdParty 2] 'Ter.' en minúscula ('si') o con espacios (' SI ') sigue siendo true", async () => {
    const buffer = await makeExcelBufferFromRows(
      ["codigo", "nombre", "tipo", "Ter."],
      [
        ["1201", "Cuentas por Cobrar Clientes", "ASSET", "si"],
        ["2105", "Proveedores", "LIABILITY", " SI "],
      ]
    );

    const rows = (await ImportService.parseAccountsExcel(buffer)) as RowWithThirdParty[];
    expect(rows[0].requiresThirdParty).toBe(true);
    expect(rows[1].requiresThirdParty).toBe(true);
  });

  it("[RED — requiresThirdParty 3] sin columna 'Ter.' en absoluto (plantilla simple actual) → requiresThirdParty false para todas las filas (GUARDA de compatibilidad)", async () => {
    const buffer = await makeExcelBuffer([
      { codigo: "1105", nombre: "Caja General", tipo: "ASSET", descripcion: "Efectivo" },
      { codigo: "2105", nombre: "Proveedores", tipo: "LIABILITY" },
    ]);

    const rows = (await ImportService.parseAccountsExcel(buffer)) as RowWithThirdParty[];
    expect(rows[0].requiresThirdParty).toBe(false);
    expect(rows[1].requiresThirdParty).toBe(false);
  });
});

describe("ImportService.importAccounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Por defecto, una BD vacía: las consultas de padre que añade SPEC-008 no devuelven `undefined`.
    resetAccountMocks();
    mountAccountDb(createAccountDb([]));
  });

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

  it("[RED — isBudgetable] row.isBudgetable=true → prisma.account.create recibe isBudgetable:true en data", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.account.create).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await ImportService.importAccounts("company-1", "user-1", [
      { codigo: "1105", nombre: "Caja", tipo: "ASSET", isBudgetable: true } as RowWithBudgetable,
    ]);

    expect(prisma.account.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isBudgetable: true }) })
    );
  });

  it("[RED — isBudgetable] sin el campo en la fila → prisma.account.create recibe isBudgetable:false en data (default seguro)", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.account.create).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await ImportService.importAccounts("company-1", "user-1", [
      { codigo: "1105", nombre: "Caja", tipo: "ASSET" },
    ]);

    expect(prisma.account.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isBudgetable: false }) })
    );
  });

  it("[RED — requiresThirdParty] row.requiresThirdParty=true → prisma.account.create recibe requiresThirdParty:true en data", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.account.create).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await ImportService.importAccounts("company-1", "user-1", [
      {
        codigo: "1201",
        nombre: "Cuentas por Cobrar Clientes",
        tipo: "ASSET",
        requiresThirdParty: true,
      } as RowWithThirdParty,
    ]);

    expect(prisma.account.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ requiresThirdParty: true }) })
    );
  });

  it("[RED — requiresThirdParty] sin el campo en la fila → prisma.account.create recibe requiresThirdParty:false en data (default seguro)", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.account.create).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await ImportService.importAccounts("company-1", "user-1", [
      { codigo: "1105", nombre: "Caja", tipo: "ASSET" },
    ]);

    expect(prisma.account.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ requiresThirdParty: false }) })
    );
  });

  // ---------------------------------------------------------------------------
  // ADR-056: el único de (companyId, name) es PARCIAL en BD (solo cuentas de
  // movimiento) — un P2002 real aquí siempre es un duplicado real de nombre o código,
  // nunca un choque de título. Antes caía al catch genérico "error al importar" sin
  // decir cuál de los dos @@unique chocó (CLAUDE.md: nunca error crudo al cliente).
  // ---------------------------------------------------------------------------

  function p2002(target: unknown): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "7.0.0",
      meta: { target },
    });
  }

  it("[ADR-059] el servidor deriva isPostable del código, ignora lo que mande el cliente", async () => {
    // SPEC-008 RN-11: la cuenta de movimiento necesita su título padre (6 dígitos). Viene en el
    // mismo archivo; la BD en memoria hace que también sea visible si el importador lo consulta
    // después de crearlo.
    mountAccountDb(createAccountDb([]));
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await ImportService.importAccounts("company-1", "user-1", [
      { codigo: "1.1.01.01", nombre: "CAJAS", tipo: "ASSET", isPostable: true },
      { codigo: "1.1.01.01.001", nombre: "Caja Principal", tipo: "ASSET", isPostable: false },
    ]);

    const calls = vi.mocked(prisma.account.create).mock.calls;
    expect(calls[0][0].data.isPostable).toBe(false);
    expect(calls[1][0].data.isPostable).toBe(true);
  });

  it("[RED — P2002 código] choque de código que el pre-check findUnique no vio (carrera) → mensaje de negocio", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.account.create).mockRejectedValue(p2002(["companyId", "code"]));
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await ImportService.importAccounts("company-1", "user-1", [
      { codigo: "1105", nombre: "Caja General", tipo: "ASSET" },
    ]);

    expect(result.errors[0].reason).toBe("duplicate_code");
    expect(result.errors[0].message).toContain("ya existe una cuenta con ese código");
  });

  it("[GUARDA — P2002 otro] un P2002 sin target reconocido sigue cayendo al mensaje genérico", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.account.create).mockRejectedValue(p2002(undefined));
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await ImportService.importAccounts("company-1", "user-1", [
      { codigo: "1105", nombre: "Caja General", tipo: "ASSET" },
    ]);

    expect(result.errors[0].reason).toBe("unknown");
    expect(result.errors[0].message).toBe("Fila 1105: error al importar");
  });
});

// ─── SPEC-008 RN-11: una cuenta de movimiento solo se importa si existe su título padre ─────────

type ImportRows = Parameters<typeof ImportService.importAccounts>[2];
type ImportRow = ImportRows[number];

const fila = (
  codigo: string,
  nombre = `Cuenta ${codigo}`,
  tipo: ImportRow["tipo"] = "ASSET"
): ImportRow => ({ codigo, nombre, tipo });

describe("ImportService.importAccounts — título padre obligatorio (SPEC-008 RN-11)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAccountMocks();
    mountAccountDb(createAccountDb([]));
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  const codigosCreados = () =>
    vi
      .mocked(prisma.account.create)
      .mock.calls.map(([args]) => (args.data as { code: string }).code)
      .sort();

  // ─── CA-14: el padre viene en el MISMO archivo, en cualquier orden ──────────────────────────
  it("CA-14: el título padre viene DESPUÉS de su cuenta de movimiento en el archivo → ambas se importan", async () => {
    const result = await ImportService.importAccounts("company-1", "user-1", [
      fila("1.1.01.01.001", "Caja Principal"),
      fila("1.1.01.01", "CAJAS"),
    ]);

    expect(result).toEqual({ created: 2, skipped: 0, errors: [] });
    expect(codigosCreados()).toEqual(["1.1.01.01", "1.1.01.01.001"]);
  });

  it("CA-14: el título padre viene ANTES de su cuenta de movimiento → ambas se importan", async () => {
    const result = await ImportService.importAccounts("company-1", "user-1", [
      fila("1.1.01.01", "CAJAS"),
      fila("1.1.01.01.001", "Caja Principal"),
    ]);

    expect(result).toEqual({ created: 2, skipped: 0, errors: [] });
  });

  it("CA-14: varias cuentas de movimiento de familias distintas con sus títulos al final del archivo", async () => {
    const result = await ImportService.importAccounts("company-1", "user-1", [
      fila("1.1.01.01.001", "Caja Principal"),
      fila("1.1.01.01.002", "Caja Chica"),
      fila("2.1.05.02.001", "Proveedores Nacionales", "LIABILITY"),
      fila("1.1.01.01", "CAJAS"),
      fila("2.1.05.02", "PROVEEDORES", "LIABILITY"),
    ]);

    expect(result).toEqual({ created: 5, skipped: 0, errors: [] });
  });

  // ─── CA-14: padre inexistente → error de fila, el resto sigue ───────────────────────────────
  it("CA-14: padre inexistente → esa fila falla con missing_parent y las demás se importan", async () => {
    const result = await ImportService.importAccounts("company-1", "user-1", [
      fila("1.1.01.01.001", "Caja Principal"), // su padre 1.1.01.01 NO está en el archivo ni en la BD
      fila("2.1.01.01", "PASIVOS CORRIENTES", "LIABILITY"),
      fila("2.1.01.01.001", "Proveedores", "LIABILITY"), // este sí tiene padre en el archivo
    ]);

    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toBe("missing_parent");
    expect(result.errors[0].message).toBe("Fila 1.1.01.01.001: falta el título padre 1.1.01.01.");
    expect(result.errors[0].row.codigo).toBe("1.1.01.01.001");
    // La fila rechazada no se creó; las otras dos sí.
    expect(codigosCreados()).toEqual(["2.1.01.01", "2.1.01.01.001"]);
  });

  it("CA-14: un fallo de padre NO aborta el lote: filas buenas ANTES y DESPUÉS del error se importan", async () => {
    const result = await ImportService.importAccounts("company-1", "user-1", [
      fila("1.1.01", "CAJAS Y BANCOS"),
      fila("1.1.05.09.001", "Cuenta huérfana"),
      fila("1.1.01.01", "CAJAS"),
      fila("1.1.01.01.001", "Caja Principal"),
      fila("1.1.07.03.001", "Otra huérfana"),
      fila("1.1.01.01.002", "Caja Chica"),
    ]);

    expect(result.created).toBe(4);
    expect(result.errors.map((e) => e.row.codigo)).toEqual(["1.1.05.09.001", "1.1.07.03.001"]);
    expect(result.errors.map((e) => e.message)).toEqual([
      "Fila 1.1.05.09.001: falta el título padre 1.1.05.09.",
      "Fila 1.1.07.03.001: falta el título padre 1.1.07.03.",
    ]);
    // `reason` se compara como string: hasta que ImportErrorReason incluya "missing_parent" (modo RED),
    // el tipo estrecho de TypeScript no admite esa comparación.
    expect(result.errors.every((e) => (e.reason as string) === "missing_parent")).toBe(true);
  });

  it("CA-14: el error de fila conserva el resto de la fila (nombre, tipo e isPostable derivado del código)", async () => {
    const result = await ImportService.importAccounts("company-1", "user-1", [
      fila("2.1.05.02.001", "Proveedores Nacionales", "LIABILITY"),
    ]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toMatchObject({
      codigo: "2.1.05.02.001",
      nombre: "Proveedores Nacionales",
      tipo: "LIABILITY",
      isPostable: true,
    });
  });

  it("el error missing_parent queda en el AuditLog de la importación junto con los contadores", async () => {
    await ImportService.importAccounts("company-1", "user-1", [
      fila("1.1.01.01", "CAJAS"),
      fila("1.1.01.01.001", "Caja Principal"),
      fila("1.1.09.09.001", "Huérfana"),
    ]);

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: "company-1",
          action: "IMPORT",
          newValue: expect.objectContaining({
            created: 2,
            skipped: 0,
            errors: [expect.objectContaining({ reason: "missing_parent" })],
          }),
        }),
      })
    );
  });

  // ─── CA-14: el padre ya existe en la BASE ───────────────────────────────────────────────────
  it("CA-14: el título padre ya existe en la BD (no viene en el archivo) → la cuenta se importa", async () => {
    mountAccountDb(
      createAccountDb([accountRow({ id: "t-cajas", code: "1.1.01.01", name: "CAJAS" })])
    );

    const result = await ImportService.importAccounts("company-1", "user-1", [
      fila("1.1.01.01.001", "Caja Principal"),
      fila("1.1.01.01.002", "Caja Chica"),
    ]);

    expect(result).toEqual({ created: 2, skipped: 0, errors: [] });
    expect(codigosCreados()).toEqual(["1.1.01.01.001", "1.1.01.01.002"]);
  });

  it("CA-tenant: el padre de la BD se busca en la empresa verificada — un título de OTRA empresa no sirve", async () => {
    mountAccountDb(
      createAccountDb([
        accountRow({ id: "t-ajeno", code: "1.1.01.01", name: "CAJAS", companyId: "company-2" }),
      ])
    );

    const result = await ImportService.importAccounts("company-1", "user-1", [
      fila("1.1.01.01.001", "Caja Principal"),
    ]);

    expect(result.created).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toBe("missing_parent");
    expect(prisma.account.create).not.toHaveBeenCalled();
  });

  it("CA-tenant: toda consulta de padre va acotada a la empresa (companyId)", async () => {
    mountAccountDb(
      createAccountDb([accountRow({ id: "t-cajas", code: "1.1.01.01", name: "CAJAS" })])
    );

    await ImportService.importAccounts("company-1", "user-1", [fila("1.1.01.01.001", "Caja")]);

    const consultas = [
      ...vi.mocked(prisma.account.findFirst).mock.calls,
      ...vi.mocked(prisma.account.findMany).mock.calls,
    ].map(([args]) => (args as { where?: Record<string, unknown> }).where ?? {});
    expect(consultas.length).toBeGreaterThan(0); // el padre se consulta en la BD (no está en el archivo)
    for (const where of consultas) {
      expect(where.companyId).toBe("company-1");
    }
  });

  it("CA-5: el título padre de la BD está ELIMINADO → missing_parent", async () => {
    mountAccountDb(
      createAccountDb([
        accountRow({
          id: "t-cajas",
          code: "1.1.01.01",
          name: "CAJAS",
          deletedAt: new Date("2026-09-01"),
        }),
      ])
    );

    const result = await ImportService.importAccounts("company-1", "user-1", [
      fila("1.1.01.01.001", "Caja Principal"),
    ]);

    expect(result.created).toBe(0);
    expect(result.errors[0]?.reason).toBe("missing_parent");
  });

  // ─── CA-11 aplicado al importador: los títulos no necesitan padre ───────────────────────────
  it("CA-11: títulos de < 9 dígitos sin ningún padre en el archivo ni en la BD → se importan", async () => {
    const result = await ImportService.importAccounts("company-1", "user-1", [
      fila("1", "ACTIVOS"),
      fila("1.1", "ACTIVOS CORRIENTES"),
      fila("1.1.01", "EFECTIVO"),
      fila("1.1.01.01", "CAJAS"),
      fila("1105", "Caja heredada"),
    ]);

    expect(result).toEqual({ created: 5, skipped: 0, errors: [] });
    expect(
      vi.mocked(prisma.account.create).mock.calls.every(([a]) => a.data.isPostable === false)
    ).toBe(true);
  });

  // ─── RN-1 en el importador: forma inválida ─────────────────────────────────────────────────
  it.each([
    ["sin puntos (9 dígitos planos)", "110101001"],
    ["10 dígitos", "1.1.01.01.0010"],
    ["separador guion", "1-1-01-01-001"],
  ])(
    "RN-1: un código de movimiento mal formado (%s) NO se importa aunque exista un título que parezca su padre",
    async (_label, codigo) => {
      const result = await ImportService.importAccounts("company-1", "user-1", [
        fila("1.1.01.01", "CAJAS"),
        fila(codigo, "Caja Principal"),
      ]);

      expect(result.created).toBe(1); // solo el título
      expect(codigosCreados()).toEqual(["1.1.01.01"]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].row.codigo).toBe(codigo);
      expect(result.errors[0].reason).not.toBe("duplicate_code");
    }
  );

  // ─── RN-12: lo existente no se toca ────────────────────────────────────────────────────────
  it("RN-12: reimportar una cuenta de movimiento que YA existe (sin título padre, empresa demo) → se omite, no es un error", async () => {
    mountAccountDb(
      createAccountDb([
        accountRow({ id: "acc-vieja", code: "1.1.01.01.001", name: "Caja Principal" }),
      ])
    );

    const result = await ImportService.importAccounts("company-1", "user-1", [
      fila("1.1.01.01.001", "Caja Principal"),
    ]);

    expect(result).toEqual({ created: 0, skipped: 1, errors: [] });
    expect(prisma.account.create).not.toHaveBeenCalled();
  });

  // ─── Regresión: el choque de código sigue siendo duplicate_code ────────────────────────────
  it("un P2002 de código con padre válido sigue reportándose como duplicate_code (no como missing_parent)", async () => {
    mountAccountDb(
      createAccountDb([accountRow({ id: "t-cajas", code: "1.1.01.01", name: "CAJAS" })])
    );
    vi.mocked(prisma.account.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.0.0",
        meta: { target: ["companyId", "code"] },
      })
    );

    const result = await ImportService.importAccounts("company-1", "user-1", [
      fila("1.1.01.01.001", "Caja Principal"),
    ]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toBe("duplicate_code");
  });
});

// Bug tester Alpha 2026-09-28: su archivo era .xls (no soportado, distinto bug), pero
// CSV compartía el mismo defecto de fondo — usaba wb.xlsx.load() para todo, y un CSV
// nunca es un zip válido. parseAccountsCsv es la implementación real, separada.
describe("ImportService.parseAccountsCsv", () => {
  it("parsea un CSV separado por comas", async () => {
    const csv =
      "codigo,nombre,tipo,descripcion\n1105,Caja General,ASSET,Efectivo\n2105,Proveedores,LIABILITY,";
    const rows = await ImportService.parseAccountsCsv(Buffer.from(csv, "utf-8"));
    expect(rows).toHaveLength(2);
    expect(rows[0].codigo).toBe("1105");
    expect(rows[1].tipo).toBe("LIABILITY");
  });

  // Excel en configuración regional VE/LatAm exporta CSV con ";" — "," es el separador
  // decimal ahí, así que Excel nunca lo usa como delimitador de columnas.
  it("detecta ; como delimitador (CSV exportado por Excel en configuración regional VE)", async () => {
    const csv = "codigo;nombre;tipo;descripcion\n1105;Caja General;ASSET;Efectivo en caja";
    const rows = await ImportService.parseAccountsCsv(Buffer.from(csv, "utf-8"));
    expect(rows).toHaveLength(1);
    expect(rows[0].codigo).toBe("1105");
    expect(rows[0].descripcion).toBe("Efectivo en caja");
  });

  it("respeta comillas — un valor con el delimitador adentro no se parte en dos columnas", async () => {
    const csv = 'codigo,nombre,tipo\n1105,"Caja, General",ASSET';
    const rows = await ImportService.parseAccountsCsv(Buffer.from(csv, "utf-8"));
    expect(rows[0].nombre).toBe("Caja, General");
  });

  it("ignora un BOM inicial (típico de CSV exportado por Excel en Windows)", async () => {
    const csv = "﻿codigo,nombre,tipo\n1105,Caja General,ASSET";
    const rows = await ImportService.parseAccountsCsv(Buffer.from(csv, "utf-8"));
    expect(rows[0].codigo).toBe("1105");
  });

  it("infiere el tipo por el dígito del código igual que parseAccountsExcel", async () => {
    const csv = "codigo,nombre\n2105,Proveedores";
    const rows = await ImportService.parseAccountsCsv(Buffer.from(csv, "utf-8"));
    expect(rows[0].tipo).toBe("LIABILITY");
  });

  it("lanza error si el archivo está vacío", async () => {
    await expect(ImportService.parseAccountsCsv(Buffer.from("", "utf-8"))).rejects.toThrow();
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
    const firstRow = (ws.getRow(1).values as (string | null)[])
      .slice(1)
      .map((v) => String(v ?? "").toLowerCase());

    expect(firstRow).toContain("codigo");
    expect(firstRow).toContain("nombre");
    expect(firstRow).toContain("tipo");
  });

  // Feedback tester Alpha 2026-09-28: la plantilla traía 6 cuentas de ejemplo ya
  // llenas — parecía datos reales listos para enviar en vez de un formato vacío.
  it("no trae cuentas de ejemplo precargadas — solo encabezados", async () => {
    const buffer = await ImportService.generateAccountsTemplate();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];
    expect(ws.rowCount).toBe(1);
  });
});
