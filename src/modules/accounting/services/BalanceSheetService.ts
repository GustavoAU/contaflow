// src/modules/accounting/services/BalanceSheetService.ts
//
// Construye el Balance General (Estado de Situación Financiera) según VEN-NIF BA-10 / IAS 1.
//
// Responsabilidades de este servicio:
//   1. Consultar las cuentas de balance (ASSET, CONTRA_ASSET, LIABILITY, EQUITY) y de resultado
//      (REVENUE, EXPENSE) con sus movimientos hasta la fecha de corte.
//   2. Clasificar cada cuenta en corriente / no corriente según el campo `isCurrent` del modelo.
//   3. Calcular el Resultado del Ejercicio (utilidad o pérdida) y agregarlo al Patrimonio.
//   4. Verificar el cuadre: Activos = Pasivos + Patrimonio (tolerancia ±0.02 Bs.).
//
// Convención de signos (contabilidad de partida doble):
//   - Activos y Gastos:    saldo débito  → positivo en BD  → se muestra tal cual
//   - Pasivos, Patrimonio
//     e Ingresos:          saldo crédito → negativo en BD  → se niega para mostrar positivo

import { Decimal } from "decimal.js";
import prisma from "@/lib/prisma";
import type { BalanceSheet, BalanceSheetRow } from "../types/report-types";
import { TX_STATUS } from "../constants";

// Diferencia mínima aceptable para considerar el balance cuadrado.
// Los redondeos a 2 decimales pueden generar discrepancias de hasta 0.01 Bs. por cuenta.
const BALANCE_TOLERANCE = new Decimal("0.02");

// ─── Tipos internos ───────────────────────────────────────────────────────────

// Forma mínima de cuenta con entradas que necesitamos para el cómputo.
// N5: pre-aggregated at DB level — no individual JournalEntry rows in memory.
type AccountWithBalance = {
  id: string;
  code: string;
  name: string;
  type: string;
  isCurrent: boolean;
  balance: Decimal; // Σ(amount) — computed by DB groupBy
};

// Resultado intermedio de procesar las cuentas de balance
type CategorizedBalanceAccounts = {
  assets: BalanceSheetRow[];
  currentAssets: BalanceSheetRow[];
  nonCurrentAssets: BalanceSheetRow[];
  liabilities: BalanceSheetRow[];
  currentLiabilities: BalanceSheetRow[];
  nonCurrentLiabilities: BalanceSheetRow[];
  equity: BalanceSheetRow[];
  totalAssets: Decimal;
  totalCurrentAssets: Decimal;
  totalNonCurrentAssets: Decimal;
  totalLiabilities: Decimal;
  totalCurrentLiabilities: Decimal;
  totalNonCurrentLiabilities: Decimal;
  totalEquity: Decimal;
};

// Procesa las cuentas de Activo, Contra-Activo, Pasivo y Patrimonio.
// Clasifica cada cuenta en corriente / no corriente y acumula los totales.
//
// Nota sobre los CONTRA_ASSET (p.ej. Depreciación Acumulada):
//   Tienen saldo crédito (negativo en BD). Se muestran con prefijo "(-)" para
//   indicar que reducen el Activo, pero se suman algebraicamente a totalAssets
//   (que resulta en una reducción). Esto cumple con NIC 16.
function categorizeBalanceAccounts(accounts: AccountWithBalance[]): CategorizedBalanceAccounts {
  const result: CategorizedBalanceAccounts = {
    assets: [],
    currentAssets: [],
    nonCurrentAssets: [],
    liabilities: [],
    currentLiabilities: [],
    nonCurrentLiabilities: [],
    equity: [],
    totalAssets: new Decimal(0),
    totalCurrentAssets: new Decimal(0),
    totalNonCurrentAssets: new Decimal(0),
    totalLiabilities: new Decimal(0),
    totalCurrentLiabilities: new Decimal(0),
    totalNonCurrentLiabilities: new Decimal(0),
    totalEquity: new Decimal(0),
  };

  for (const account of accounts) {
    const balance = account.balance;
    // Ignorar cuentas sin movimientos — no deben aparecer en el Balance General
    if (balance.isZero()) continue;

    if (account.type === "ASSET") {
      addAsset(result, account, balance, account.name);
    } else if (account.type === "CONTRA_ASSET") {
      // Se muestra con "(-)" para indicar visualmente que deduce del Activo
      addAsset(result, account, balance, `(-) ${account.name}`);
    } else if (account.type === "LIABILITY") {
      addLiability(result, account, balance);
    } else if (account.type === "EQUITY") {
      addEquity(result, account, balance);
    }
  }

  return result;
}

// Agrega una cuenta de Activo (o Contra-Activo) al resultado clasificado.
// El balance se suma algebraicamente: activos normales son positivos,
// contra-activos son negativos, lo que reduce el total correctamente.
function addAsset(
  result: CategorizedBalanceAccounts,
  account: AccountWithBalance,
  balance: Decimal,
  displayName: string,
): void {
  const row: BalanceSheetRow = {
    id: account.id,
    code: account.code,
    name: displayName,
    balance: balance.toFixed(2),
  };

  result.assets.push(row);
  result.totalAssets = result.totalAssets.plus(balance);

  if (account.isCurrent) {
    result.currentAssets.push(row);
    result.totalCurrentAssets = result.totalCurrentAssets.plus(balance);
  } else {
    result.nonCurrentAssets.push(row);
    result.totalNonCurrentAssets = result.totalNonCurrentAssets.plus(balance);
  }
}

// Agrega una cuenta de Pasivo al resultado clasificado.
// El balance en BD es negativo (saldo crédito); lo negamos para mostrar positivo.
function addLiability(
  result: CategorizedBalanceAccounts,
  account: AccountWithBalance,
  balance: Decimal,
): void {
  const displayBalance = balance.negated(); // crédito normal → mostrar positivo
  const row: BalanceSheetRow = {
    id: account.id,
    code: account.code,
    name: account.name,
    balance: displayBalance.toFixed(2),
  };

  result.liabilities.push(row);
  result.totalLiabilities = result.totalLiabilities.plus(displayBalance);

  if (account.isCurrent) {
    result.currentLiabilities.push(row);
    result.totalCurrentLiabilities = result.totalCurrentLiabilities.plus(displayBalance);
  } else {
    result.nonCurrentLiabilities.push(row);
    result.totalNonCurrentLiabilities = result.totalNonCurrentLiabilities.plus(displayBalance);
  }
}

// Agrega una cuenta de Patrimonio al resultado.
// Igual que Pasivos: saldo crédito en BD → negamos para mostrar positivo.
function addEquity(
  result: CategorizedBalanceAccounts,
  account: AccountWithBalance,
  balance: Decimal,
): void {
  const displayBalance = balance.negated();
  result.equity.push({
    id: account.id,
    code: account.code,
    name: account.name,
    balance: displayBalance.toFixed(2),
  });
  result.totalEquity = result.totalEquity.plus(displayBalance);
}

// Calcula el Resultado del Ejercicio neto a partir de las cuentas de Ingreso y Gasto.
//
// - Ingresos: saldo crédito (negativo en BD) → negamos para obtener monto positivo → sumamos
// - Gastos:   saldo débito  (positivo en BD) → tomamos tal cual               → restamos
//
// Retorna valor positivo si hay utilidad, negativo si hay pérdida.
function computeNetIncome(incomeAccounts: AccountWithBalance[]): Decimal {
  let totalRevenues = new Decimal(0);
  let totalExpenses = new Decimal(0);

  for (const account of incomeAccounts) {
    const balance = account.balance;
    if (balance.isZero()) continue;

    if (account.type === "REVENUE") {
      totalRevenues = totalRevenues.plus(balance.negated()); // crédito → positivo
    } else {
      totalExpenses = totalExpenses.plus(balance); // débito → positivo
    }
  }

  return totalRevenues.minus(totalExpenses);
}

// ─── Servicio principal ───────────────────────────────────────────────────────

export class BalanceSheetService {
  /**
   * Consulta la BD y construye el Balance General completo para la empresa.
   * @param companyId      - empresa propietaria (aislamiento multi-tenant, ADR-004)
   * @param dateTo         - fecha de corte; si se omite usa la fecha actual
   * @param incomeDateFrom - inicio del período para "Resultado del Ejercicio" (debe coincidir
   *                         con el dateFrom usado en getIncomeStatementAction — hallazgo #3)
   * @returns Balance General con activos, pasivos, patrimonio y flag `isBalanced`
   */
  static async compute(
  companyId: string,
  dateTo?: Date,
  incomeDateFrom?: Date,
): Promise<BalanceSheet> {
  // Activos/Pasivos/Patrimonio: acumulados desde el inicio hasta dateTo (sin límite inferior)
  const balanceDateFilter = dateTo ? { date: { lte: dateTo } } : {};
  // Resultado del Ejercicio: solo el año fiscal corriente — evita mezclar resultados históricos
  const incomeDateFilter =
    incomeDateFrom || dateTo
      ? {
          date: {
            ...(incomeDateFrom ? { gte: incomeDateFrom } : {}),
            ...(dateTo ? { lte: dateTo } : {}),
          },
        }
      : {};

  // N5: dos rondas de queries en paralelo — evita cargar filas individuales de JournalEntry.
  // Ronda 1: solo metadatos de cuentas (sin journalEntries).
  // Ronda 2: groupBy + _sum a nivel de BD → O(1) memoria por cuenta sin importar el volumen.
  const [balanceMeta, incomeMeta] = await Promise.all([
    prisma.account.findMany({
      where: { companyId, type: { in: ["ASSET", "CONTRA_ASSET", "LIABILITY", "EQUITY"] } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true, isCurrent: true },
    }),
    prisma.account.findMany({
      where: { companyId, type: { in: ["REVENUE", "EXPENSE"] } },
      select: { id: true, code: true, name: true, type: true, isCurrent: true },
    }),
  ]);

  const balanceAccountIds = balanceMeta.map((a) => a.id);
  const incomeAccountIds  = incomeMeta.map((a) => a.id);

  const [balanceSums, incomeSums] = await Promise.all([
    prisma.journalEntry.groupBy({
      by: ["accountId"],
      where: {
        accountId: { in: balanceAccountIds },
        transaction: { status: TX_STATUS.POSTED, ...balanceDateFilter },
      },
      _sum: { amount: true },
    }),
    prisma.journalEntry.groupBy({
      by: ["accountId"],
      where: {
        accountId: { in: incomeAccountIds },
        transaction: { status: TX_STATUS.POSTED, ...incomeDateFilter },
      },
      _sum: { amount: true },
    }),
  ]);

  const balanceSumMap = new Map(
    balanceSums.map((s) => [s.accountId, new Decimal(s._sum.amount?.toString() ?? "0")])
  );
  const incomeSumMap = new Map(
    incomeSums.map((s) => [s.accountId, new Decimal(s._sum.amount?.toString() ?? "0")])
  );

  const balanceAccounts: AccountWithBalance[] = balanceMeta.map((a) => ({
    ...a,
    balance: balanceSumMap.get(a.id) ?? new Decimal(0),
  }));
  const incomeAccounts: AccountWithBalance[] = incomeMeta.map((a) => ({
    ...a,
    balance: incomeSumMap.get(a.id) ?? new Decimal(0),
  }));

  // Clasificar activos, pasivos y patrimonio
  const categorized = categorizeBalanceAccounts(balanceAccounts);

  // El Resultado del Ejercicio (utilidad/pérdida) se incorpora al Patrimonio
  const netIncome = computeNetIncome(incomeAccounts);
  if (!netIncome.isZero()) {
    categorized.equity.push({
      id: "net-income",
      code: "—",
      name: "Resultado del Ejercicio",
      balance: netIncome.toFixed(2),
    });
    categorized.totalEquity = categorized.totalEquity.plus(netIncome);
  }

  const totalLiabilitiesAndEquity = categorized.totalLiabilities.plus(categorized.totalEquity);
  const isBalanced = categorized.totalAssets
    .minus(totalLiabilitiesAndEquity)
    .abs()
    .lessThan(BALANCE_TOLERANCE);

  // Advertencias contables: condiciones que no impiden generar el balance pero
  // deben revisarse antes de presentarlo al SENIAT o en una fiscalización.
  const warnings: string[] = [];
  if (categorized.totalNonCurrentAssets.isNegative()) {
    warnings.push(
      "El total de Activos No Corrientes es negativo. " +
      "Verifique que existan cuentas de costo original (ASSET) para cada cuenta de " +
      "depreciación acumulada (CONTRA_ASSET) configurada en el Plan de Cuentas. " +
      "Un activo no corriente negativo causará rechazo en una fiscalización SENIAT."
    );
  }
  if (!isBalanced) {
    warnings.push(
      `El Balance General no cuadra: Activos (${categorized.totalAssets.toFixed(2)} Bs.) ≠ ` +
      `Pasivos + Patrimonio (${totalLiabilitiesAndEquity.toFixed(2)} Bs.). ` +
      "Revise que todos los asientos estén registrados con partida doble correcta."
    );
  }

  return {
    currentAssets: categorized.currentAssets,
    nonCurrentAssets: categorized.nonCurrentAssets,
    currentLiabilities: categorized.currentLiabilities,
    nonCurrentLiabilities: categorized.nonCurrentLiabilities,
    totalCurrentAssets: categorized.totalCurrentAssets.toFixed(2),
    totalNonCurrentAssets: categorized.totalNonCurrentAssets.toFixed(2),
    totalCurrentLiabilities: categorized.totalCurrentLiabilities.toFixed(2),
    totalNonCurrentLiabilities: categorized.totalNonCurrentLiabilities.toFixed(2),
    assets: categorized.assets,
    liabilities: categorized.liabilities,
    equity: categorized.equity,
    totalAssets: categorized.totalAssets.toFixed(2),
    totalLiabilities: categorized.totalLiabilities.toFixed(2),
    totalEquity: categorized.totalEquity.toFixed(2),
    totalLiabilitiesAndEquity: totalLiabilitiesAndEquity.toFixed(2),
    isBalanced,
    warnings,
  };
}
}
