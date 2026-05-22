import JSZip from "jszip";
import prisma from "@/lib/prisma";
import { DeclaracionIVAService } from "@/modules/iva-declaration/services/DeclaracionIVAService";

export type ExportDataParams = {
  companyId: string;
  dateFrom: Date;
  dateTo: Date;
  /** true = ignora el rango de fechas y exporta todo el historial (portabilidad) */
  allHistory?: boolean;
};

// ─── CSV helpers ─────────────────────────────────────────────────────────────

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(",")),
  ];
  return lines.join("\n");
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().split("T")[0];
}

// ─── Data fetchers ────────────────────────────────────────────────────────────

async function fetchInvoices(params: ExportDataParams) {
  const rows = await prisma.invoice.findMany({
    where: {
      companyId: params.companyId,
      date: { gte: params.dateFrom, lte: params.dateTo },
      deletedAt: null,
    },
    select: {
      invoiceNumber: true,
      controlNumber: true,
      docType: true,
      type: true,
      date: true,
      counterpartName: true,
      counterpartRif: true,
      currency: true,
      taxCategory: true,
      ivaRetentionAmount: true,
      ivaRetentionVoucher: true,
      islrRetentionAmount: true,
      igtfAmount: true,
      paymentStatus: true,
      relatedDocNumber: true,
      taxLines: {
        select: {
          taxType: true,
          base: true,
          amount: true,
        },
      },
    },
    orderBy: [{ date: "asc" }, { invoiceNumber: "asc" }],
  });

  return rows.map((inv) => {
    const ivaGeneral = inv.taxLines.find((t) => t.taxType === "IVA_GENERAL");
    const ivaReducido = inv.taxLines.find((t) => t.taxType === "IVA_REDUCIDO");
    const ivaAdicional = inv.taxLines.find((t) => t.taxType === "IVA_ADICIONAL");
    return {
      "Número Factura": inv.invoiceNumber,
      "Número Control": inv.controlNumber ?? "",
      "Tipo Doc": inv.docType,
      "Tipo": inv.type,
      "Fecha": formatDate(inv.date),
      "Contraparte": inv.counterpartName,
      "RIF Contraparte": inv.counterpartRif,
      "Moneda": inv.currency,
      "Categoría Fiscal": inv.taxCategory,
      "Base Imponible 16%": String(ivaGeneral?.base ?? 0),
      "IVA 16%": String(ivaGeneral?.amount ?? 0),
      "Base Imponible 8%": String(ivaReducido?.base ?? 0),
      "IVA 8%": String(ivaReducido?.amount ?? 0),
      "Base Adicional 15%": String(ivaAdicional?.base ?? 0),
      "IVA Adicional 15%": String(ivaAdicional?.amount ?? 0),
      "Ret. IVA": String(inv.ivaRetentionAmount),
      "Comprobante Ret. IVA": inv.ivaRetentionVoucher ?? "",
      "Ret. ISLR": String(inv.islrRetentionAmount),
      "IGTF": String(inv.igtfAmount),
      "Estado Pago": inv.paymentStatus,
      "Doc. Relacionado": inv.relatedDocNumber ?? "",
    };
  });
}

async function fetchTransactions(params: ExportDataParams) {
  const rows = await prisma.transaction.findMany({
    where: {
      companyId: params.companyId,
      date: { gte: params.dateFrom, lte: params.dateTo },
    },
    select: {
      number: true,
      date: true,
      description: true,
      reference: true,
      type: true,
      status: true,
      entries: {
        select: {
          accountId: true,
          account: { select: { code: true, name: true } },
          amount: true,
        },
      },
    },
    orderBy: [{ date: "asc" }, { number: "asc" }],
  });

  const flatRows: Record<string, unknown>[] = [];
  for (const tx of rows) {
    for (const entry of tx.entries) {
      flatRows.push({
        "Número Asiento": tx.number,
        "Fecha": formatDate(tx.date),
        "Descripción": tx.description,
        "Referencia": tx.reference ?? "",
        "Tipo": tx.type,
        "Estado": tx.status,
        "Código Cuenta": entry.account.code,
        "Nombre Cuenta": entry.account.name,
        "Debe (+) / Haber (-)": String(entry.amount),
      });
    }
  }
  return flatRows;
}

async function fetchRetenciones(params: ExportDataParams) {
  const rows = await prisma.retencion.findMany({
    where: {
      companyId: params.companyId,
      invoiceDate: { gte: params.dateFrom, lte: params.dateTo },
      deletedAt: null,
    },
    select: {
      voucherNumber: true,
      providerName: true,
      providerRif: true,
      invoiceNumber: true,
      invoiceDate: true,
      invoiceAmount: true,
      taxBase: true,
      ivaAmount: true,
      ivaRetention: true,
      ivaRetentionPct: true,
      islrAmount: true,
      islrRetentionPct: true,
      totalRetention: true,
      type: true,
      status: true,
    },
    orderBy: { invoiceDate: "asc" },
  });

  return rows.map((r) => ({
    "N° Comprobante": r.voucherNumber ?? "",
    "Proveedor": r.providerName,
    "RIF Proveedor": r.providerRif,
    "N° Factura": r.invoiceNumber,
    "Fecha Factura": formatDate(r.invoiceDate),
    "Monto Factura": String(r.invoiceAmount),
    "Base Imponible": String(r.taxBase),
    "Monto IVA": String(r.ivaAmount),
    "Ret. IVA": String(r.ivaRetention),
    "% Ret. IVA": String(r.ivaRetentionPct),
    "Ret. ISLR": String(r.islrAmount ?? 0),
    "% Ret. ISLR": String(r.islrRetentionPct ?? 0),
    "Total Retenido": String(r.totalRetention),
    "Tipo": r.type,
    "Estado": r.status,
  }));
}

async function fetchFixedAssets(params: ExportDataParams) {
  const rows = await prisma.fixedAsset.findMany({
    where: {
      companyId: params.companyId,
      deletedAt: null,
    },
    select: {
      name: true,
      description: true,
      acquisitionDate: true,
      acquisitionCost: true,
      residualValue: true,
      usefulLifeMonths: true,
      depreciationMethod: true,
      status: true,
      entries: {
        where: {
          postedAt: { gte: params.dateFrom, lte: params.dateTo },
        },
        select: {
          periodYear: true,
          periodMonth: true,
          amount: true,
          accumulatedDepreciation: true,
          bookValue: true,
        },
        orderBy: [{ periodYear: "asc" }, { periodMonth: "asc" }],
      },
    },
  });

  const flatRows: Record<string, unknown>[] = [];
  for (const asset of rows) {
    if (asset.entries.length === 0) {
      flatRows.push({
        "Activo": asset.name,
        "Descripción": asset.description ?? "",
        "Fecha Adquisición": formatDate(asset.acquisitionDate),
        "Costo Adquisición": String(asset.acquisitionCost),
        "Valor Residual": String(asset.residualValue),
        "Vida Útil (meses)": asset.usefulLifeMonths,
        "Método Depreciación": asset.depreciationMethod,
        "Estado": asset.status,
        "Período Año": "",
        "Período Mes": "",
        "Depreciación Período": "",
        "Depreciación Acumulada": "",
        "Valor en Libros": "",
      });
    } else {
      for (const entry of asset.entries) {
        flatRows.push({
          "Activo": asset.name,
          "Descripción": asset.description ?? "",
          "Fecha Adquisición": formatDate(asset.acquisitionDate),
          "Costo Adquisición": String(asset.acquisitionCost),
          "Valor Residual": String(asset.residualValue),
          "Vida Útil (meses)": asset.usefulLifeMonths,
          "Método Depreciación": asset.depreciationMethod,
          "Estado": asset.status,
          "Período Año": entry.periodYear,
          "Período Mes": entry.periodMonth,
          "Depreciación Período": String(entry.amount),
          "Depreciación Acumulada": String(entry.accumulatedDepreciation),
          "Valor en Libros": String(entry.bookValue),
        });
      }
    }
  }
  return flatRows;
}

async function fetchForma30(params: ExportDataParams) {
  // Forma 30 is computed on-the-fly per month — there is no persisted model
  const rows: Record<string, unknown>[] = [];

  // Enumerate each month in [dateFrom, dateTo]
  const start = new Date(
    params.dateFrom.getFullYear(),
    params.dateFrom.getMonth(),
    1
  );
  const end = new Date(
    params.dateTo.getFullYear(),
    params.dateTo.getMonth(),
    1
  );

  const cursor = new Date(start);
  while (cursor <= end) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth() + 1; // 1-12
    try {
      const result = await DeclaracionIVAService.calculate(
        params.companyId,
        year,
        month
      );
      rows.push({
        "Año": year,
        "Mes": month,
        "Ventas Gravadas 16% Base": result.seccionA.general.base.toFixed(2),
        "Débito Fiscal 16%": result.seccionA.general.tax.toFixed(2),
        "Ventas Gravadas 8% Base": result.seccionA.reducida.base.toFixed(2),
        "Débito Fiscal 8%": result.seccionA.reducida.tax.toFixed(2),
        "Ventas Exentas": result.seccionA.exentasExoneradas.base.toFixed(2),
        "Total Débito Fiscal": result.seccionA.totalDebitosFiscales.toFixed(2),
        "Compras Gravadas 16% Base": result.seccionB.general.base.toFixed(2),
        "Crédito Fiscal 16%": result.seccionB.general.tax.toFixed(2),
        "Total Crédito Fiscal": result.seccionB.totalCreditosFiscales.toFixed(2),
        "Ret. IVA Sufridas": result.seccionC.retencionesIvaSufridas.toFixed(2),
        "Ret. IVA Practicadas": result.seccionC.retencionesIvaPracticadas.toFixed(2),
        "Cuota / Saldo a Favor": result.seccionE.cuotaPeriodo.toFixed(2),
        "Es Saldo a Favor": result.seccionE.esSaldoAFavor ? "SI" : "NO",
      });
    } catch {
      // Period may not exist — include empty row so the month is visible
      rows.push({
        "Año": year,
        "Mes": month,
        "Ventas Gravadas 16% Base": "",
        "Débito Fiscal 16%": "",
        "Ventas Gravadas 8% Base": "",
        "Débito Fiscal 8%": "",
        "Ventas Exentas": "",
        "Total Débito Fiscal": "",
        "Compras Gravadas 16% Base": "",
        "Crédito Fiscal 16%": "",
        "Total Crédito Fiscal": "",
        "Ret. IVA Sufridas": "",
        "Ret. IVA Practicadas": "",
        "Cuota / Saldo a Favor": "",
        "Es Saldo a Favor": "",
      });
    }
    // advance one month
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return rows;
}

// ─── Operaciones (portabilidad total) ────────────────────────────────────────

async function fetchEmployees(companyId: string) {
  const rows = await prisma.employee.findMany({
    where: { companyId },
    select: {
      firstName: true,
      lastName: true,
      cedulaType: true,
      cedulaNumber: true,
      contractType: true,
      employeeRegime: true,
      hireDate: true,
      terminationDate: true,
      status: true,
      position: true,
      department: true,
      costCenter: true,
      email: true,
      phone: true,
      bankName: true,
      salaryHistory: {
        orderBy: { effectiveFrom: "desc" },
        take: 1,
        select: { amount: true, effectiveFrom: true },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  return rows.map((e) => ({
    "Nombre": e.firstName,
    "Apellido": e.lastName,
    "Tipo Cédula": e.cedulaType,
    "Cédula": e.cedulaNumber,
    "Tipo Contrato": e.contractType,
    "Régimen LOTTT": e.employeeRegime,
    "Fecha Ingreso": formatDate(e.hireDate),
    "Fecha Egreso": formatDate(e.terminationDate),
    "Estado": e.status,
    "Cargo": e.position,
    "Departamento": e.department ?? "",
    "Centro de Costo": e.costCenter ?? "",
    "Email": e.email ?? "",
    "Teléfono": e.phone ?? "",
    "Banco": e.bankName ?? "",
    "Salario Vigente": e.salaryHistory[0] ? String(e.salaryHistory[0].amount) : "",
    "Vigencia Salario": e.salaryHistory[0] ? formatDate(e.salaryHistory[0].effectiveFrom) : "",
  }));
}

async function fetchPayrollRuns(params: ExportDataParams) {
  const where = params.allHistory
    ? { companyId: params.companyId, status: "APPROVED" as const }
    : {
        companyId: params.companyId,
        status: "APPROVED" as const,
        periodStart: { gte: params.dateFrom, lte: params.dateTo },
      };

  const rows = await prisma.payrollRun.findMany({
    where,
    select: {
      periodStart: true,
      periodEnd: true,
      totalEarnings: true,
      totalDeductions: true,
      totalNet: true,
      employeeCount: true,
      approvedAt: true,
    },
    orderBy: { periodStart: "asc" },
  });
  return rows.map((r) => ({
    "Período Inicio": formatDate(r.periodStart),
    "Período Fin": formatDate(r.periodEnd),
    "Total Asignaciones": String(r.totalEarnings),
    "Total Deducciones": String(r.totalDeductions),
    "Total Neto": String(r.totalNet),
    "Nro. Empleados": r.employeeCount,
    "Aprobado En": r.approvedAt ? r.approvedAt.toISOString() : "",
  }));
}

async function fetchInventoryItems(companyId: string) {
  const rows = await prisma.inventoryItem.findMany({
    where: { companyId, deletedAt: null },
    select: {
      name: true,
      sku: true,
      itemType: true,
      stockQuantity: true,
      baseUnitName: true,
      baseUnitAbbr: true,
      averageCost: true,
      account: { select: { code: true, name: true } },
      cogsAccount: { select: { code: true, name: true } },
    },
    orderBy: { name: "asc" },
  });
  return rows.map((i) => ({
    "Nombre": i.name,
    "SKU/Código": i.sku,
    "Tipo": i.itemType,
    "Stock": String(i.stockQuantity),
    "UdM Base": `${i.baseUnitName} (${i.baseUnitAbbr})`,
    "Costo Promedio": String(i.averageCost),
    "Cta. Inventario": i.account ? `${i.account.code} ${i.account.name}` : "",
    "Cta. COGS": i.cogsAccount ? `${i.cogsAccount.code} ${i.cogsAccount.name}` : "",
  }));
}

async function fetchExpenses(params: ExportDataParams) {
  const where = params.allHistory
    ? { companyId: params.companyId, deletedAt: null }
    : {
        companyId: params.companyId,
        deletedAt: null,
        createdAt: { gte: params.dateFrom, lte: params.dateTo },
      };

  const rows = await prisma.expense.findMany({
    where,
    select: {
      createdAt: true,
      invoiceDate: true,
      concept: true,
      category: { select: { name: true } },
      vendor: { select: { name: true } },
      supplierName: true,
      amount: true,
      currency: true,
      exchangeRate: true,
      amountVes: true,
      hasIva: true,
      ivaAmount: true,
      isDeductible: true,
      invoiceNumber: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((e) => ({
    "Fecha Registro": formatDate(e.createdAt),
    "Fecha Factura Prov.": formatDate(e.invoiceDate),
    "Concepto": e.concept,
    "Categoría": e.category.name,
    "Proveedor": e.vendor?.name ?? e.supplierName ?? "",
    "Monto": String(e.amount),
    "Moneda": e.currency,
    "Tasa Cambio": e.exchangeRate ? String(e.exchangeRate) : "",
    "Monto Bs.": String(e.amountVes),
    "Tiene IVA": e.hasIva ? "SI" : "NO",
    "IVA": e.ivaAmount ? String(e.ivaAmount) : "",
    "Deducible ISLR": e.isDeductible ? "SI" : "NO",
    "Nro. Factura": e.invoiceNumber ?? "",
  }));
}

// ─── Main ZIP generator ───────────────────────────────────────────────────────

export async function generateExportZip(
  params: ExportDataParams
): Promise<{ data: Buffer; sizeBytes: number }> {
  const zip = new JSZip();

  // Fiscal + operaciones en paralelo — las funciones que no usan rango de fecha
  // siempre exportan todo el historial (employees, inventory)
  const [invoices, transactions, retenciones, assets, forma30, employees, payrollRuns, inventory, expenses] =
    await Promise.all([
      fetchInvoices(params),
      fetchTransactions(params),
      fetchRetenciones(params),
      fetchFixedAssets(params),
      fetchForma30(params),
      fetchEmployees(params.companyId),
      fetchPayrollRuns(params),
      fetchInventoryItems(params.companyId),
      fetchExpenses(params),
    ]);

  // ── Libros IVA ────────────────────────────────────────────────────────────
  const ventas = invoices.filter((r) => r["Tipo"] === "SALE");
  const compras = invoices.filter((r) => r["Tipo"] === "PURCHASE");
  const libroVentas = toCsv(ventas);
  const libroCompras = toCsv(compras);

  if (libroVentas) zip.file("libros-iva/libro-ventas.csv", libroVentas);
  if (libroCompras) zip.file("libros-iva/libro-compras.csv", libroCompras);

  // ── Asientos contables ────────────────────────────────────────────────────
  const txCsv = toCsv(transactions);
  if (txCsv) zip.file("asientos/asientos.csv", txCsv);

  // ── Retenciones ───────────────────────────────────────────────────────────
  const retCsv = toCsv(retenciones);
  if (retCsv) zip.file("retenciones/retenciones.csv", retCsv);

  // ── Activos Fijos ─────────────────────────────────────────────────────────
  const assetsCsv = toCsv(assets);
  if (assetsCsv) zip.file("activos-fijos/activos.csv", assetsCsv);

  // ── Forma 30 ──────────────────────────────────────────────────────────────
  const forma30Csv = toCsv(forma30);
  if (forma30Csv) zip.file("forma-30/forma30.csv", forma30Csv);

  // ── Operaciones (portabilidad) ────────────────────────────────────────────
  const empCsv = toCsv(employees);
  if (empCsv) zip.file("nomina/empleados.csv", empCsv);

  const nomCsv = toCsv(payrollRuns);
  if (nomCsv) zip.file("nomina/nominas-aprobadas.csv", nomCsv);

  const invCsv = toCsv(inventory);
  if (invCsv) zip.file("inventario/items.csv", invCsv);

  const expCsv = toCsv(expenses);
  if (expCsv) zip.file("gastos/gastos.csv", expCsv);

  // ── README ────────────────────────────────────────────────────────────────
  const from = params.allHistory ? "todo-el-historial" : formatDate(params.dateFrom);
  const to   = params.allHistory ? "" : formatDate(params.dateTo);
  const periodo = params.allHistory ? "Todo el historial" : `${from} a ${to}`;

  zip.file(
    "LEEME.txt",
    [
      "ContaFlow — Exportación de Datos",
      `Empresa ID: ${params.companyId}`,
      `Período: ${periodo}`,
      `Generado: ${new Date().toISOString()}`,
      "",
      "Contenido:",
      "  libros-iva/libro-ventas.csv      — Libro de Ventas IVA",
      "  libros-iva/libro-compras.csv     — Libro de Compras IVA",
      "  asientos/asientos.csv            — Asientos Contables (Diario)",
      "  retenciones/retenciones.csv      — Comprobantes de Retención",
      "  activos-fijos/activos.csv        — Activos Fijos y Depreciación",
      "  forma-30/forma30.csv             — Declaraciones IVA (Forma 30)",
      "  nomina/empleados.csv             — Nómina: Empleados (historial completo)",
      "  nomina/nominas-aprobadas.csv     — Nómina: Procesos Aprobados",
      "  inventario/items.csv             — Inventario: Artículos (historial completo)",
      "  gastos/gastos.csv                — Gastos Operativos",
    ].join("\n")
  );

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return { data: buffer, sizeBytes: buffer.length };
}
