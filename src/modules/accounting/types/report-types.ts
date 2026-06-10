// src/modules/accounting/types/report-types.ts
//
// Tipos de datos para los reportes contables (Libro Diario, Libro Mayor,
// Balance de Comprobación, Estado de Resultados y Balance General).
//
// Estos tipos son compartidos entre:
//   - actions/report.actions.ts        (acciones del servidor)
//   - services/FinancialStatementsPDFService.ts (generación de PDFs)
//   - components y páginas que consumen los reportes

// ─── Libro Diario ─────────────────────────────────────────────────────────────

// Una línea de un asiento (cuenta + monto en débito o crédito)
export type JournalLine = {
  accountCode: string;
  accountName: string;
  debit: string;  // "1000.00" si es débito, "" si es crédito
  credit: string; // "1000.00" si es crédito, "" si es débito
};

// Una transacción completa del Libro Diario con sus líneas
export type JournalTransaction = {
  id: string;
  number: string;
  date: Date;
  description: string;
  reference: string | null;
  type: string;
  lines: JournalLine[];
  totalDebit: string;
  totalCredit: string;
};

// ─── Libro Mayor ──────────────────────────────────────────────────────────────

// Un movimiento individual en el Mayor de una cuenta (una fila de la tabla)
export type LedgerEntry = {
  date: Date;
  number: string;       // número de transacción
  description: string;
  debit: string;        // "1000.00" o "" si es crédito
  credit: string;       // "1000.00" o "" si es débito
  balance: string;      // saldo rodante acumulado después de este movimiento
  transactionId: string;
};

// El Mayor de una cuenta: cabecera + lista de movimientos + totales
// El openingBalance es el saldo acumulado antes del dateFrom del filtro;
// si no hay filtro de fecha, viene en "0.00".
export type LedgerAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  entries: LedgerEntry[];
  totalDebit: string;
  totalCredit: string;
  balance: string;
  openingBalance: string;
};

// ─── Balance de Comprobación ──────────────────────────────────────────────────

// Una fila del Balance de Comprobación (sumas y saldos por cuenta)
export type TrialBalanceRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  totalDebit: string;
  totalCredit: string;
  balance: string;
};

// ─── Estado de Resultados ─────────────────────────────────────────────────────

// Una fila de ingreso o gasto en el Estado de Resultados
export type IncomeStatementRow = {
  id: string;
  code: string;
  name: string;
  balance: string; // siempre positivo — el contexto (ingreso vs. gasto) lo aporta la lista padre
};

// El Estado de Resultados para un período
export type IncomeStatement = {
  revenues: IncomeStatementRow[];
  expenses: IncomeStatementRow[];
  totalRevenues: string;
  totalExpenses: string;
  netIncome: string; // positivo = utilidad, negativo = pérdida del período
};

// Resultado de getIncomeStatementAction: período actual + opcional período de comparación
export type IncomeStatementResult = {
  current: IncomeStatement;
  compare?: IncomeStatement;
};

// ─── Balance General ──────────────────────────────────────────────────────────

// Una cuenta en el Balance General (activo, pasivo o patrimonio)
export type BalanceSheetRow = {
  id: string;
  code: string;
  name: string;
  balance: string;
};

// El Balance General completo (VEN-NIF BA-10 / IAS 1)
// Incluye la clasificación corriente / no corriente según NIC 1
export type BalanceSheet = {
  // Activos clasificados
  currentAssets: BalanceSheetRow[];
  nonCurrentAssets: BalanceSheetRow[];
  // Pasivos clasificados
  currentLiabilities: BalanceSheetRow[];
  nonCurrentLiabilities: BalanceSheetRow[];
  // Totales clasificados
  totalCurrentAssets: string;
  totalNonCurrentAssets: string;
  totalCurrentLiabilities: string;
  totalNonCurrentLiabilities: string;
  // Listas completas (para compatibilidad con el PDF service que las usa por sección)
  assets: BalanceSheetRow[];
  liabilities: BalanceSheetRow[];
  equity: BalanceSheetRow[];
  // Totales generales
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  totalLiabilitiesAndEquity: string;
  // Validación de cuadre: |Activos - (Pasivos + Patrimonio)| < 0.02
  isBalanced: boolean;
  // Advertencias contables detectadas por el servicio (ej: activo no corriente negativo).
  // Array vacío si no hay problemas. Mostrar en UI antes de exportar o imprimir.
  warnings: string[];
};
