// src/modules/bank-reconciliation/services/CsvParserService.ts
import { Decimal } from "decimal.js";

export type CsvRow = {
  date: Date;
  description: string;
  debit: Decimal | null;
  credit: Decimal | null;
  balance: Decimal | null;
};

/**
 * Normaliza un string de monto en formato venezolano o estándar a Decimal.
 * Formato venezolano: "1.000,50" (miles=punto, decimal=coma)
 * Formato estándar:   "1000.50"
 * Retorna null si la cadena está vacía.
 */
function parseAmount(raw: string): Decimal | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  let normalized: string;

  // Detectar formato venezolano: contiene coma como separador decimal
  if (trimmed.includes(",")) {
    // Eliminar puntos (miles) y reemplazar coma por punto (decimal)
    normalized = trimmed.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = trimmed;
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Monto inválido: "${raw}"`);
  }

  return new Decimal(normalized);
}

/**
 * Parsea una fecha en formato dd/mm/yyyy o yyyy-mm-dd.
 */
function parseDate(raw: string, rowIndex: number): Date {
  const trimmed = raw.trim();

  // Formato dd/mm/yyyy
  const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/;

  let day: number, month: number, year: number;

  const matchDmy = ddmmyyyy.exec(trimmed);
  const matchIso = isoDate.exec(trimmed);

  if (matchDmy) {
    day = parseInt(matchDmy[1], 10);
    month = parseInt(matchDmy[2], 10);
    year = parseInt(matchDmy[3], 10);
  } else if (matchIso) {
    year = parseInt(matchIso[1], 10);
    month = parseInt(matchIso[2], 10);
    day = parseInt(matchIso[3], 10);
  } else {
    throw new Error(`Fecha inválida en fila ${rowIndex + 1}: "${raw}"`);
  }

  const d = new Date(Date.UTC(year, month - 1, day));
  if (isNaN(d.getTime())) {
    throw new Error(`Fecha inválida en fila ${rowIndex + 1}: "${raw}"`);
  }
  return d;
}

export type ColumnMap = {
  date: number;
  description: number;
  debit: number;
  credit: number;
  balance?: number;
};

const DEFAULT_COLUMN_MAP: ColumnMap = { date: 0, description: 1, debit: 2, credit: 3, balance: 4 };

/**
 * Parsea el contenido CSV de un extracto bancario.
 * Formato esperado: date,description,debit,credit,balance (por defecto, columnas 0-4)
 * Usar columnMap para especificar índices personalizados (0-based).
 * La primera línea (header) es ignorada.
 * Las filas completamente vacías son ignoradas.
 */
export function parseBankCsv(csvContent: string, columnMap?: ColumnMap): CsvRow[] {
  const cm = columnMap ?? DEFAULT_COLUMN_MAP;
  const lines = csvContent.split(/\r?\n/);
  const rows: CsvRow[] = [];

  // Saltar header (línea 0)
  const dataLines = lines.slice(1);

  dataLines.forEach((line, index) => {
    const trimmedLine = line.trim();
    if (trimmedLine === "") return; // Ignorar filas vacías

    const parts = trimmedLine.split(",");

    // Necesitamos al menos 4 columnas: date, description, debit, credit
    const minCols = Math.max(cm.date, cm.description, cm.debit, cm.credit) + 1;
    if (parts.length < minCols) {
      throw new Error(
        `Fila ${index + 2} malformada: se esperan al menos ${minCols} columnas, encontradas ${parts.length}`
      );
    }

    const rawDate = parts[cm.date];
    const rawDescription = parts[cm.description].trim();
    const rawDebit = parts[cm.debit].trim();
    const rawCredit = parts[cm.credit].trim();
    const rawBalance = cm.balance !== undefined && parts.length > cm.balance ? parts[cm.balance].trim() : "";

    if (!rawDescription) {
      throw new Error(`Fila ${index + 2} malformada: descripción vacía`);
    }

    let date: Date;
    try {
      date = parseDate(rawDate, index + 1);
    } catch (e) {
      throw new Error(`Fila ${index + 2}: ${(e as Error).message}`);
    }

    let debit: Decimal | null;
    let credit: Decimal | null;
    let balance: Decimal | null;

    try {
      debit = parseAmount(rawDebit);
    } catch (e) {
      throw new Error(`Fila ${index + 2} — débito: ${(e as Error).message}`);
    }

    try {
      credit = parseAmount(rawCredit);
    } catch (e) {
      throw new Error(`Fila ${index + 2} — crédito: ${(e as Error).message}`);
    }

    try {
      balance = parseAmount(rawBalance);
    } catch (e) {
      throw new Error(`Fila ${index + 2} — saldo: ${(e as Error).message}`);
    }

    rows.push({ date, description: rawDescription, debit, credit, balance });
  });

  return rows;
}

/**
 * Valida que el saldo final calculado coincide con el saldo de cierre declarado.
 * actual = openingBalance + sum(credits) - sum(debits)
 */
export function validateCsvBalance(
  rows: CsvRow[],
  openingBalance: Decimal,
  closingBalance: Decimal
): { valid: boolean; expected?: Decimal; actual?: Decimal } {
  let actual = new Decimal(openingBalance);

  for (const row of rows) {
    if (row.credit !== null) actual = actual.plus(row.credit);
    if (row.debit !== null) actual = actual.minus(row.debit);
  }

  if (actual.equals(closingBalance)) {
    return { valid: true };
  }

  return { valid: false, expected: closingBalance, actual };
}

export const CsvParserService = {
  parseBankCsv,
  validateCsvBalance,
};
