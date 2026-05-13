// prisma/seed-demo.ts
// ─────────────────────────────────────────────────────────────────────────────
// Seed de simulación — 1 mes completo de operaciones (Abril 2026)
// Ejecutar DESPUÉS de seed.ts (empresa/usuario ya deben existir):
//   npx tsx prisma/seed-demo.ts
//
// IDEMPOTENTE: se puede correr múltiples veces sin duplicar datos.
// ─────────────────────────────────────────────────────────────────────────────

import {
  PrismaClient,
  AccountType,
  Currency,
  InvoiceType,
  InvoiceDocType,
  TaxCategory,
  TaxLineType,
  RetentionType,
  RetentionStatus,
  InvoicePaymentStatus,
  PaymentMethod,
  BankTransactionType,
  BankStatementStatus,
  DepreciationMethod,
  FixedAssetStatus,
  MovementType,
  MovementStatus,
  ContractType,
  LottRegime,
  PayrollPaymentCurrency,
  EmployeeStatus,
  PayrollFrequency,
  CestaTicketType,
  FideicomisoType,
  PayrollSizeRange,
  QuotationType,
  QuotationStatus,
  OrderStatus,
  OrderDocType,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── Constantes ───────────────────────────────────────────────────────────────

const USER_ID = "user_3ASUXQGjepsTxT5W6AcIyytnqdf";
const COMPANY_RIF = "J-12345678-9";

// Fechas del período demo (Abril 2026)
const d = (day: number) => new Date(`2026-04-${String(day).padStart(2, "0")}T12:00:00Z`);
const dateOnly = (dateStr: string) => new Date(`${dateStr}T00:00:00Z`);

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Iniciando seed demo — Abril 2026...\n");

  // ── 0. Obtener empresa ───────────────────────────────────────────────────
  const company = await prisma.company.findUniqueOrThrow({ where: { rif: COMPANY_RIF } });
  const cId = company.id;
  console.log(`✅ Empresa: ${company.name} (${cId})`);

  // ── 1. Plan de Cuentas ampliado ──────────────────────────────────────────
  console.log("\n📊 Cuentas contables...");

  const accountDefs: { code: string; name: string; type: AccountType }[] = [
    // ACTIVOS
    { code: "1105", name: "Caja General", type: "ASSET" },
    { code: "1110", name: "Bancos — Banesco CTA CTE", type: "ASSET" },
    { code: "1115", name: "Inventario de Mercancías", type: "ASSET" },
    { code: "1120", name: "IVA Crédito Fiscal", type: "ASSET" },
    { code: "1305", name: "Cuentas por Cobrar Clientes", type: "ASSET" },
    { code: "1310", name: "Anticipo a Proveedores", type: "ASSET" },
    { code: "1505", name: "Equipos de Computación", type: "ASSET" },
    { code: "1510", name: "Dep. Acum. Equipos de Computación", type: "CONTRA_ASSET" },
    { code: "1520", name: "Vehículos", type: "ASSET" },
    { code: "1521", name: "Dep. Acum. Vehículos", type: "CONTRA_ASSET" },
    { code: "1530", name: "Mobiliario y Equipo de Oficina", type: "ASSET" },
    { code: "1531", name: "Dep. Acum. Mobiliario y Equipo", type: "CONTRA_ASSET" },
    { code: "1540", name: "Maquinaria y Equipos", type: "ASSET" },
    { code: "1541", name: "Dep. Acum. Maquinaria y Equipos", type: "CONTRA_ASSET" },
    // PASIVOS
    { code: "2105", name: "IVA Débito Fiscal", type: "LIABILITY" },
    { code: "2110", name: "Retenciones IVA por Pagar", type: "LIABILITY" },
    { code: "2115", name: "Retenciones ISLR por Pagar", type: "LIABILITY" },
    { code: "2205", name: "Proveedores", type: "LIABILITY" },
    { code: "2210", name: "Nómina por Pagar", type: "LIABILITY" },
    // PATRIMONIO
    { code: "3105", name: "Capital Social", type: "EQUITY" },
    { code: "3205", name: "Utilidades Retenidas", type: "EQUITY" },
    { code: "3210", name: "Resultado del Ejercicio", type: "EQUITY" },
    // INGRESOS
    { code: "4110", name: "Prestación de Servicios", type: "REVENUE" },
    { code: "4135", name: "Ventas de Mercancías", type: "REVENUE" },
    // GASTOS
    { code: "5105", name: "Gastos de Personal", type: "EXPENSE" },
    { code: "5110", name: "Costo de Ventas", type: "EXPENSE" },
    { code: "5115", name: "Depreciación de Activos", type: "EXPENSE" },
    { code: "5120", name: "Alquileres", type: "EXPENSE" },
    { code: "5125", name: "Servicios Públicos", type: "EXPENSE" },
    { code: "5130", name: "Compras de Mercancías", type: "EXPENSE" },
  ];

  const accounts: Record<string, string> = {}; // code → id
  for (const acc of accountDefs) {
    const a = await prisma.account.upsert({
      where: { companyId_code: { companyId: cId, code: acc.code } },
      update: { name: acc.name, type: acc.type },
      create: { companyId: cId, code: acc.code, name: acc.name, type: acc.type },
    });
    accounts[acc.code] = a.id;
    process.stdout.write(`  ✅ ${acc.code} — ${acc.name}\n`);
  }

  // Pre-configurar cuentas de cierre fiscal
  await prisma.company.update({
    where: { id: cId },
    data: { resultAccountId: accounts["3210"], retainedEarningsAccountId: accounts["3205"] },
  });
  console.log("  ✅ Cierre fiscal configurado: 3210 + 3205");

  // ── 2. Período contable Abril 2026 ───────────────────────────────────────
  console.log("\n📅 Período contable...");
  const period = await prisma.accountingPeriod.upsert({
    where: { companyId_year_month: { companyId: cId, year: 2026, month: 4 } },
    update: {},
    create: {
      companyId: cId,
      year: 2026,
      month: 4,
      status: "OPEN",
      openedAt: dateOnly("2026-04-01"),
      openedBy: USER_ID,
    },
  });
  console.log(`  ✅ Período: Abril 2026 (${period.status})`);

  // ── 3. Tasas BCV (USD/VES) ───────────────────────────────────────────────
  console.log("\n💱 Tasas BCV...");
  const exchangeRates: { date: string; rate: string }[] = [
    { date: "2026-04-01", rate: "470.00" },
    { date: "2026-04-07", rate: "473.50" },
    { date: "2026-04-14", rate: "477.00" },
    { date: "2026-04-21", rate: "481.22" }, // BCV oficial 20/04/2026
    { date: "2026-04-28", rate: "484.00" },
  ];

  const rateIds: Record<string, string> = {}; // date → id
  for (const er of exchangeRates) {
    const r = await prisma.exchangeRate.upsert({
      where: { companyId_currency_date: { companyId: cId, currency: "USD", date: dateOnly(er.date) } },
      update: { rate: er.rate },
      create: {
        companyId: cId,
        currency: "USD",
        rate: er.rate,
        date: dateOnly(er.date),
        source: "BCV",
        createdBy: USER_ID,
      },
    });
    rateIds[er.date] = r.id;
    console.log(`  ✅ ${er.date}: 1 USD = ${er.rate} VES`);
  }

  // Tasas EUR/VES (BCV oficial ~1.08–1.10 × USD)
  const eurRates: { date: string; rate: string }[] = [
    { date: "2026-04-01", rate: "507.60" },
    { date: "2026-04-07", rate: "511.38" },
    { date: "2026-04-14", rate: "515.16" },
    { date: "2026-04-21", rate: "519.72" }, // ~1.08 × 481.22
    { date: "2026-04-28", rate: "522.72" },
  ];
  for (const er of eurRates) {
    await prisma.exchangeRate.upsert({
      where: { companyId_currency_date: { companyId: cId, currency: "EUR", date: dateOnly(er.date) } },
      update: { rate: er.rate },
      create: { companyId: cId, currency: "EUR", rate: er.rate, date: dateOnly(er.date), source: "BCV", createdBy: USER_ID },
    });
    console.log(`  ✅ ${er.date}: 1 EUR = ${er.rate} VES`);
  }

  // ── 4. Proveedores ───────────────────────────────────────────────────────
  console.log("\n🏭 Proveedores...");
  const vendorDefs = [
    { name: "Distribuidora TechPro C.A.", rif: "J-30123456-7", email: "ventas@techpro.com.ve" },
    { name: "Suministros Generales Bolívar S.R.L.", rif: "J-20987654-3", email: "info@sgbolivar.com.ve" },
    { name: "Servicios Informáticos Andinos C.A.", rif: "J-40234567-8", email: "soporte@siandinos.com.ve" },
    { name: "Papelería y Oficina Nacional C.A.", rif: "J-10876543-2", email: "pedidos@ponacional.com.ve" },
  ];

  const vendors: Record<string, string> = {}; // name → id
  for (const v of vendorDefs) {
    const existing = await prisma.vendor.findFirst({ where: { companyId: cId, rif: v.rif } });
    const vend = existing
      ? await prisma.vendor.update({ where: { id: existing.id }, data: { name: v.name, email: v.email } })
      : await prisma.vendor.create({ data: { companyId: cId, ...v } });
    vendors[v.name] = vend.id;
    console.log(`  ✅ ${v.name}`);
  }

  // ── 5. Clientes ──────────────────────────────────────────────────────────
  console.log("\n👥 Clientes...");
  const customerDefs = [
    { name: "Corporación Venezolana de Servicios C.A.", rif: "J-31456789-0", email: "admin@cvservicios.com.ve" },
    { name: "Inversiones Carabobo 2025 C.A.", rif: "J-41567890-1", email: "finanzas@invcarabobo.com.ve" },
    { name: "Construcciones Andinas del Orinoco S.A.", rif: "J-21234567-5", email: "cuentas@candinaso.com.ve" },
    { name: "Pedro Antonio Rodríguez", rif: "V-12345678-9", email: "pedro.rodriguez@gmail.com" },
    { name: "María Elena Gutiérrez", rif: "V-23456789-0", email: "m.gutierrez@empresa.com.ve" },
  ];

  const customers: Record<string, string> = {}; // name → id
  for (const c of customerDefs) {
    const existing = await prisma.customer.findFirst({ where: { companyId: cId, rif: c.rif } });
    const cust = existing
      ? await prisma.customer.update({ where: { id: existing.id }, data: { name: c.name, email: c.email } })
      : await prisma.customer.create({ data: { companyId: cId, ...c } });
    customers[c.name] = cust.id;
    console.log(`  ✅ ${c.name}`);
  }

  // ── 6. Facturas de VENTA ─────────────────────────────────────────────────
  console.log("\n🧾 Facturas de Venta...");

  const saleDefs = [
    // PAGADA — Corporación Venezolana (servicios, IVA 16%) — ≈USD 600 × 470 Bs
    {
      invoiceNumber: "0001", controlNumber: "00-00000001",
      date: d(3), dueDate: d(18),
      counterpartName: "Corporación Venezolana de Servicios C.A.", counterpartRif: "J-31456789-0",
      customerId: customers["Corporación Venezolana de Servicios C.A."],
      base: "282000.00", ivaRate: 16, ivaAmt: "45120.00", total: "327120.00",
      taxType: "IVA_GENERAL" as TaxLineType, taxCategory: "GRAVADA" as TaxCategory,
      paymentStatus: "PAID" as InvoicePaymentStatus,
    },
    // PAGADA PARCIAL — Inversiones Carabobo (servicios, IVA 16%) — ≈USD 1,000 × 473.50 Bs
    {
      invoiceNumber: "0002", controlNumber: "00-00000002",
      date: d(5), dueDate: d(20),
      counterpartName: "Inversiones Carabobo 2025 C.A.", counterpartRif: "J-41567890-1",
      customerId: customers["Inversiones Carabobo 2025 C.A."],
      base: "473500.00", ivaRate: 16, ivaAmt: "75760.00", total: "549260.00",
      taxType: "IVA_GENERAL" as TaxLineType, taxCategory: "GRAVADA" as TaxCategory,
      paymentStatus: "PARTIAL" as InvoicePaymentStatus,
    },
    // PENDIENTE — Construcciones Andinas (servicios, IVA 16%) — ≈USD 1,500 × 473.50 Bs
    {
      invoiceNumber: "0003", controlNumber: "00-00000003",
      date: d(8), dueDate: d(23),
      counterpartName: "Construcciones Andinas del Orinoco S.A.", counterpartRif: "J-21234567-5",
      customerId: customers["Construcciones Andinas del Orinoco S.A."],
      base: "710250.00", ivaRate: 16, ivaAmt: "113640.00", total: "823890.00",
      taxType: "IVA_GENERAL" as TaxLineType, taxCategory: "GRAVADA" as TaxCategory,
      paymentStatus: "UNPAID" as InvoicePaymentStatus,
    },
    // PAGADA — Pedro Rodríguez (producto, IVA 8% reducido) — ≈USD 200 × 477 Bs
    {
      invoiceNumber: "0004", controlNumber: "00-00000004",
      date: d(10), dueDate: d(25),
      counterpartName: "Pedro Antonio Rodríguez", counterpartRif: "V-12345678-9",
      customerId: customers["Pedro Antonio Rodríguez"],
      base: "95400.00", ivaRate: 8, ivaAmt: "7632.00", total: "103032.00",
      taxType: "IVA_REDUCIDO" as TaxLineType, taxCategory: "GRAVADA" as TaxCategory,
      paymentStatus: "PAID" as InvoicePaymentStatus,
    },
    // PAGADA — María Gutiérrez (servicios, EXENTO) — ≈USD 280 × 477 Bs
    {
      invoiceNumber: "0005", controlNumber: "00-00000005",
      date: d(14), dueDate: d(29),
      counterpartName: "María Elena Gutiérrez", counterpartRif: "V-23456789-0",
      customerId: customers["María Elena Gutiérrez"],
      base: "133560.00", ivaRate: 0, ivaAmt: "0.00", total: "133560.00",
      taxType: "EXENTO" as TaxLineType, taxCategory: "EXENTA" as TaxCategory,
      paymentStatus: "PAID" as InvoicePaymentStatus,
    },
    // VENCIDA +90 días (simulada en enero — para detector de anomalías FiscalAnomalyDetectorService)
    // ≈USD 800 × 460 Bs (tasa enero 2026)
    {
      invoiceNumber: "0006", controlNumber: "00-00000006",
      date: new Date("2026-01-05T12:00:00Z"), dueDate: new Date("2026-01-20T12:00:00Z"),
      counterpartName: "Corporación Venezolana de Servicios C.A.", counterpartRif: "J-31456789-0",
      customerId: customers["Corporación Venezolana de Servicios C.A."],
      base: "368000.00", ivaRate: 16, ivaAmt: "58880.00", total: "426880.00",
      taxType: "IVA_GENERAL" as TaxLineType, taxCategory: "GRAVADA" as TaxCategory,
      paymentStatus: "UNPAID" as InvoicePaymentStatus,
    },
  ];

  const saleInvoiceIds: string[] = [];
  for (const inv of saleDefs) {
    const existing = await prisma.invoice.findUnique({
      where: { companyId_invoiceNumber_type: { companyId: cId, invoiceNumber: inv.invoiceNumber, type: "SALE" } },
    });
    if (!existing) {
      const created = await prisma.invoice.create({
        data: {
          companyId: cId,
          type: "SALE",
          docType: "FACTURA",
          taxCategory: inv.taxCategory,
          invoiceNumber: inv.invoiceNumber,
          controlNumber: inv.controlNumber,
          date: inv.date,
          dueDate: inv.dueDate,
          counterpartName: inv.counterpartName,
          counterpartRif: inv.counterpartRif,
          customerId: inv.customerId,
          periodId: period.id,
          totalAmountVes: inv.total,
          // SALE-0002 PARTIAL: pagado Bs. 200,000 (PaymentRecord) → pendiente 349,260
          pendingAmount: inv.paymentStatus === "PAID" ? "0.00" : inv.paymentStatus === "PARTIAL" ? "349260.00" : inv.total,
          paymentStatus: inv.paymentStatus,
          createdBy: USER_ID,
          taxLines: {
            create: inv.ivaRate > 0
              ? [{ taxType: inv.taxType, base: inv.base, rate: inv.ivaRate, amount: inv.ivaAmt }]
              : [{ taxType: "EXENTO" as TaxLineType, base: inv.base, rate: 0, amount: "0.00" }],
          },
        },
      });
      saleInvoiceIds.push(created.id);
      console.log(`  ✅ SALE ${inv.invoiceNumber} — ${inv.counterpartName} — Bs. ${inv.total} [${inv.paymentStatus}]`);
    } else {
      saleInvoiceIds.push(existing.id);
      console.log(`  ⏭️  SALE ${inv.invoiceNumber} ya existe`);
    }
  }

  // ── 7. Facturas de COMPRA ────────────────────────────────────────────────
  console.log("\n🛒 Facturas de Compra...");

  const purchaseDefs = [
    // ≈USD 350 × 470 Bs
    {
      invoiceNumber: "C-0001",
      date: d(2), dueDate: d(17),
      counterpartName: "Distribuidora TechPro C.A.", counterpartRif: "J-30123456-7",
      vendorId: vendors["Distribuidora TechPro C.A."],
      base: "165000.00", ivaRate: 16, ivaAmt: "26400.00", total: "191400.00",
      paymentStatus: "PAID" as InvoicePaymentStatus,
    },
    // ≈USD 200 × 473.50 Bs
    {
      invoiceNumber: "C-0002",
      date: d(6), dueDate: d(21),
      counterpartName: "Suministros Generales Bolívar S.R.L.", counterpartRif: "J-20987654-3",
      vendorId: vendors["Suministros Generales Bolívar S.R.L."],
      base: "94500.00", ivaRate: 16, ivaAmt: "15120.00", total: "109620.00",
      paymentStatus: "UNPAID" as InvoicePaymentStatus,
    },
    // ≈USD 480 × 473.50 Bs
    {
      invoiceNumber: "C-0003",
      date: d(9), dueDate: d(24),
      counterpartName: "Servicios Informáticos Andinos C.A.", counterpartRif: "J-40234567-8",
      vendorId: vendors["Servicios Informáticos Andinos C.A."],
      base: "227000.00", ivaRate: 16, ivaAmt: "36320.00", total: "263320.00",
      paymentStatus: "PARTIAL" as InvoicePaymentStatus,
    },
    // ≈USD 80 × 477 Bs
    {
      invoiceNumber: "C-0004",
      date: d(12), dueDate: d(27),
      counterpartName: "Papelería y Oficina Nacional C.A.", counterpartRif: "J-10876543-2",
      vendorId: vendors["Papelería y Oficina Nacional C.A."],
      base: "38000.00", ivaRate: 16, ivaAmt: "6080.00", total: "44080.00",
      paymentStatus: "PAID" as InvoicePaymentStatus,
    },
    // ≈USD 250 × 477 Bs
    {
      invoiceNumber: "C-0005",
      date: d(15), dueDate: d(30),
      counterpartName: "Servicios Informáticos Andinos C.A.", counterpartRif: "J-40234567-8",
      vendorId: vendors["Servicios Informáticos Andinos C.A."],
      base: "120000.00", ivaRate: 16, ivaAmt: "19200.00", total: "139200.00",
      paymentStatus: "UNPAID" as InvoicePaymentStatus,
    },
  ];

  const purchaseInvoiceIds: string[] = [];
  for (const inv of purchaseDefs) {
    const existing = await prisma.invoice.findUnique({
      where: { companyId_invoiceNumber_type: { companyId: cId, invoiceNumber: inv.invoiceNumber, type: "PURCHASE" } },
    });
    if (!existing) {
      const created = await prisma.invoice.create({
        data: {
          companyId: cId,
          type: "PURCHASE",
          docType: "FACTURA",
          taxCategory: "GRAVADA",
          invoiceNumber: inv.invoiceNumber,
          date: inv.date,
          dueDate: inv.dueDate,
          counterpartName: inv.counterpartName,
          counterpartRif: inv.counterpartRif,
          vendorId: inv.vendorId,
          periodId: period.id,
          totalAmountVes: inv.total,
          // C-0003 PARTIAL: pendiente aprox. Bs. 120,000
          pendingAmount: inv.paymentStatus === "PAID" ? "0.00" : inv.paymentStatus === "PARTIAL" ? "120000.00" : inv.total,
          paymentStatus: inv.paymentStatus,
          createdBy: USER_ID,
          taxLines: {
            create: [{ taxType: "IVA_GENERAL" as TaxLineType, base: inv.base, rate: inv.ivaRate, amount: inv.ivaAmt }],
          },
        },
      });
      purchaseInvoiceIds.push(created.id);
      console.log(`  ✅ PURCHASE ${inv.invoiceNumber} — ${inv.counterpartName} — Bs. ${inv.total} [${inv.paymentStatus}]`);
    } else {
      purchaseInvoiceIds.push(existing.id);
      console.log(`  ⏭️  PURCHASE ${inv.invoiceNumber} ya existe`);
    }
  }

  // ── 8. Retenciones IVA (75%) ─────────────────────────────────────────────
  console.log("\n📋 Retenciones IVA...");

  const retDefs = [
    {
      key: "demo-ret-iva-001",
      invoiceIdx: 0, // C-0001 TechPro
      ivaAmt: "26400.00", taxBase: "165000.00", invoiceAmt: "191400.00",
      retention: "19800.00", // 75% de 26,400
      voucherNumber: "RIV-2026-001",
    },
    {
      key: "demo-ret-iva-002",
      invoiceIdx: 2, // C-0003 SIA
      ivaAmt: "36320.00", taxBase: "227000.00", invoiceAmt: "263320.00",
      retention: "27240.00", // 75% de 36,320
      voucherNumber: "RIV-2026-002",
    },
    {
      key: "demo-ret-iva-003",
      invoiceIdx: 4, // C-0005 SIA
      ivaAmt: "19200.00", taxBase: "120000.00", invoiceAmt: "139200.00",
      retention: "14400.00", // 75% de 19,200
      voucherNumber: "RIV-2026-003",
    },
  ];

  for (const ret of retDefs) {
    const pd = purchaseDefs[ret.invoiceIdx];
    await prisma.retencion.upsert({
      where: { idempotencyKey: ret.key },
      update: {},
      create: {
        companyId: cId,
        providerName: pd.counterpartName,
        providerRif: pd.counterpartRif,
        invoiceNumber: pd.invoiceNumber,
        invoiceDate: pd.date,
        invoiceAmount: ret.invoiceAmt,
        taxBase: ret.taxBase,
        ivaAmount: ret.ivaAmt,
        ivaRetention: ret.retention,
        ivaRetentionPct: "75.00",
        totalRetention: ret.retention,
        type: "IVA",
        status: "ISSUED",
        invoiceId: purchaseInvoiceIds[ret.invoiceIdx],
        voucherNumber: ret.voucherNumber,
        idempotencyKey: ret.key,
        createdBy: USER_ID,
      },
    });
    console.log(`  ✅ ${ret.voucherNumber} — ${pd.counterpartName} — Bs. ${ret.retention}`);
  }

  // ── 9. Cuenta Bancaria ───────────────────────────────────────────────────
  console.log("\n🏦 Cuenta bancaria...");
  let bankAccount = await prisma.bankAccount.findFirst({ where: { companyId: cId, deletedAt: null } });
  if (!bankAccount) {
    bankAccount = await prisma.bankAccount.create({
      data: {
        companyId: cId,
        accountId: accounts["1110"],
        name: "Banesco — Cuenta Corriente Principal",
        bankName: "Banesco",
        accountNumber: "0134-0055-18-5512345678",
        currency: "VES",
        closingBalance: "0",
        isActive: true,
        createdBy: USER_ID,
      },
    });
    console.log(`  ✅ Cuenta: ${bankAccount.name}`);
  } else {
    console.log(`  ⏭️  Cuenta bancaria ya existe`);
  }

  // ── 10. Estado de cuenta bancario (para conciliación) ──────────────────
  console.log("\n📄 Estado de cuenta bancario...");
  let statement = await prisma.bankStatement.findFirst({
    where: { bankAccountId: bankAccount.id, periodStart: dateOnly("2026-04-01") },
  });
  if (!statement) {
    statement = await prisma.bankStatement.create({
      data: {
        bankAccountId: bankAccount.id,
        periodStart: dateOnly("2026-04-01"),
        periodEnd: dateOnly("2026-04-30"),
        openingBalance: "1500000.00",
        closingBalance: "1827482.00",
        status: "OPEN",
        importedBy: USER_ID,
      },
    });
    console.log(`  ✅ Estado de cuenta: Abril 2026`);

    // Transacciones bancarias (3 coincidencias exactas + 1 sin conciliar)
    const bankTxDefs = [
      // ── CASO 1: Coincidencia exacta (monto + fecha perfectos) ─────────────
      { date: "2026-04-03", desc: "TRANSF RECIBIDA CORP VENEZOLANA 0001", type: "CREDIT" as BankTransactionType, amount: "327120.00", ref: "BNS-2026-001" },
      { date: "2026-04-04", desc: "TRANSF RECIBIDA PEDRO RODRIGUEZ 0004", type: "CREDIT" as BankTransactionType, amount: "103032.00", ref: "BNS-2026-002" },
      { date: "2026-04-05", desc: "PAGO PROV TECHPRO FACT C-0001", type: "DEBIT" as BankTransactionType, amount: "191400.00", ref: "BNS-2026-003" },
      { date: "2026-04-14", desc: "TRANSF RECIBIDA MARIA GUTIERREZ 0005", type: "CREDIT" as BankTransactionType, amount: "133560.00", ref: "BNS-2026-004" },
      // ── CASO 2: Solo en banco — sin contraparte en el sistema ─────────────
      // Comisión bancaria: el banco la cobra directamente, no hay factura en el sistema
      { date: "2026-04-20", desc: "CARGO COMISION BANCARIA ABRIL", type: "DEBIT" as BankTransactionType, amount: "350.00", ref: "BNS-2026-005" },
      // ── CASO 3: Coincidencia parcial — monto difiere (comisión de transf.) ─
      // El banco cobró Bs. 48 adicionales por comisión de transferencia interbancaria.
      // La factura C-0004 era Bs. 3,712 pero el banco procesó Bs. 3,760.
      // → No auto-concilia. Usuario debe conciliar manualmente y crear asiento por Bs. 48.
      // Monto banco: 44,480 vs factura C-0004: 44,080 → diferencia Bs. 400 comisión interbancaria
      { date: "2026-04-21", desc: "PAGO PROV PAPELERIA NACIONAL C-0004", type: "DEBIT" as BankTransactionType, amount: "44480.00", ref: "BNS-2026-006" },
    ];

    for (const tx of bankTxDefs) {
      await prisma.bankTransaction.create({
        data: {
          statementId: statement.id,
          companyId: cId,
          date: dateOnly(tx.date),
          description: tx.desc,
          type: tx.type,
          amount: tx.amount,
          reference: tx.ref,
          isReconciled: false,
        },
      });
    }
    console.log(`  ✅ ${bankTxDefs.length} transacciones bancarias creadas`);
  } else {
    console.log(`  ⏭️  Estado de cuenta ya existe`);
  }

  // ── 10B. PaymentRecord "solo en sistema" (caso conciliación) ───────────────
  // Inversiones Carabobo pagó un abono parcial de Bs. 26,400 via PagoMóvil el 07/04.
  // Se registró en el sistema, pero NO aparece en el estado de cuenta Banesco importado
  // (pago en tránsito / acreditado en fecha posterior al corte).
  // → Aparece en la columna "Solo en sistema" de la vista de conciliación.
  console.log("\n💳 PaymentRecord (solo en sistema)...");
  const saleInv0002 = await prisma.invoice.findUnique({
    where: { companyId_invoiceNumber_type: { companyId: cId, invoiceNumber: "0002", type: "SALE" } },
  });
  if (saleInv0002) {
    const existingPaymentRecord = await prisma.paymentRecord.findFirst({
      where: { companyId: cId, invoiceId: saleInv0002.id, amountVes: "26400.00" },
    });
    if (!existingPaymentRecord) {
      await prisma.paymentRecord.create({
        data: {
          companyId: cId,
          invoiceId: saleInv0002.id,
          method: "PAGOMOVIL" as PaymentMethod,
          amountVes: "200000.00",
          currency: "VES" as Currency,
          referenceNumber: "00112345678901",
          originBank: "Mercantil",
          destBank: "Banesco",
          date: d(7),
          notes: "Abono parcial SALE-0002 Inversiones Carabobo — pago en tránsito (no aparece en estado de cuenta)",
          createdBy: USER_ID,
        },
      });
      console.log(`  ✅ PaymentRecord Bs. 200,000 — Inversiones Carabobo (PagoMóvil, sin banco)`);
    } else {
      console.log(`  ⏭️  PaymentRecord ya existe`);
    }
  }

  // ── 11. Empleados ────────────────────────────────────────────────────────
  console.log("\n👤 Empleados...");

  const employeeDefs = [
    {
      firstName: "Carlos", lastName: "Mendoza", cedulaType: "V", cedulaNumber: "15234567",
      contractType: "INDEFINIDO" as ContractType,
      employeeRegime: "POST_2012" as LottRegime,
      hireDate: dateOnly("2022-01-15"),
      position: "Gerente de Ventas", department: "Ventas",
      email: "c.mendoza@empresademo.com.ve",
      salary: "3500.00", salaryCurrency: "USD" as PayrollPaymentCurrency,
    },
    {
      firstName: "Ana", lastName: "Pérez", cedulaType: "V", cedulaNumber: "18765432",
      contractType: "INDEFINIDO" as ContractType,
      employeeRegime: "POST_2012" as LottRegime,
      hireDate: dateOnly("2023-03-01"),
      position: "Contadora", department: "Administración",
      email: "a.perez@empresademo.com.ve",
      salary: "2800.00", salaryCurrency: "USD" as PayrollPaymentCurrency,
    },
    {
      firstName: "Luis", lastName: "García", cedulaType: "V", cedulaNumber: "22456789",
      contractType: "DETERMINADO" as ContractType,
      employeeRegime: "POST_2012" as LottRegime,
      hireDate: dateOnly("2025-06-01"),
      position: "Asistente Administrativo", department: "Administración",
      email: "l.garcia@empresademo.com.ve",
      salary: "150000.00", salaryCurrency: "VES" as PayrollPaymentCurrency,
    },
  ];

  for (const emp of employeeDefs) {
    const { salary, salaryCurrency, ...empData } = emp;
    const employee = await prisma.employee.upsert({
      where: { companyId_cedulaType_cedulaNumber: { companyId: cId, cedulaType: empData.cedulaType, cedulaNumber: empData.cedulaNumber } },
      update: {},
      create: { companyId: cId, status: "ACTIVE" as EmployeeStatus, ...empData },
    });

    // SalaryHistory
    const existingSalary = await prisma.salaryHistory.findFirst({
      where: { employeeId: employee.id, effectiveFrom: dateOnly("2026-01-01") },
    });
    if (!existingSalary) {
      await prisma.salaryHistory.create({
        data: {
          companyId: cId,
          employeeId: employee.id,
          effectiveFrom: dateOnly("2026-01-01"),
          amount: salary,
          currency: salaryCurrency,
          createdByUserId: USER_ID,
        },
      });
    }
    console.log(`  ✅ ${emp.firstName} ${emp.lastName} — ${emp.position} (${salaryCurrency} ${salary})`);
  }

  // ── 11b. CompanySettings — cuentas GL para causación automática (ADR-026) ──
  console.log("\n⚙️  CompanySettings GL...");
  await prisma.companySettings.upsert({
    where: { companyId: cId },
    update: {
      arAccountId: accounts["1305"],              // Cuentas por Cobrar Clientes
      apAccountId: accounts["2205"],              // Proveedores
      salesAccountId: accounts["4135"],           // Ventas de Mercancías
      purchaseExpenseAccountId: accounts["5130"], // Compras de Mercancías
      ivaDFAccountId: accounts["2105"],           // IVA Débito Fiscal
      ivaCFAccountId: accounts["1120"],           // IVA Crédito Fiscal
    },
    create: {
      companyId: cId,
      arAccountId: accounts["1305"],
      apAccountId: accounts["2205"],
      salesAccountId: accounts["4135"],
      purchaseExpenseAccountId: accounts["5130"],
      ivaDFAccountId: accounts["2105"],
      ivaCFAccountId: accounts["1120"],
    },
  });
  console.log(`  ✅ CompanySettings GL configurado`);

  // ── 12. PayrollConfig ─────────────────────────────────────────────────────
  console.log("\n⚙️  Configuración de nómina...");
  const existingConfig = await prisma.payrollConfig.findUnique({ where: { companyId: cId } });
  if (!existingConfig) {
    await prisma.payrollConfig.create({
      data: {
        companyId: cId,
        frequency: "MONTHLY" as PayrollFrequency,
        lottRegime: "POST_2012" as LottRegime,
        sizeRange: "SMALL" as PayrollSizeRange,
        paymentCurrency: "USD" as PayrollPaymentCurrency,
        ivssEnabled: true,
        incesEnabled: true,
        banavihEnabled: true,
        rpeEnabled: true,
        salaryMinimumVes: "130.00",
        cestaTicketType: "CARD" as CestaTicketType,
        fideicomiso: "INTERNAL" as FideicomisoType,
        expenseAccountId: accounts["5105"],
        payableAccountId: accounts["2210"],
      },
    });
    console.log(`  ✅ PayrollConfig creada`);
  } else {
    console.log(`  ⏭️  PayrollConfig ya existe`);
  }

  // ── 13. Activo Fijo ───────────────────────────────────────────────────────
  console.log("\n🖥️  Activos fijos...");
  const existingAsset = await prisma.fixedAsset.findFirst({ where: { companyId: cId, deletedAt: null } });
  if (!existingAsset) {
    await prisma.fixedAsset.create({
      data: {
        companyId: cId,
        name: "Computadora Dell Inspiron 15",
        description: "Equipo de computación para uso administrativo",
        assetAccountId: accounts["1505"],
        depreciationAccountId: accounts["5115"],
        accDepreciationAccountId: accounts["1510"],
        acquisitionDate: dateOnly("2025-01-10"),
        acquisitionCost: "350000.00",  // ≈USD 700 × ~500 Bs/USD (tasa ene 2025)
        residualValue: "35000.00",
        usefulLifeMonths: 36,
        depreciationMethod: "LINEA_RECTA" as DepreciationMethod,
        status: "ACTIVE" as FixedAssetStatus,
        createdBy: USER_ID,
      },
    });
    console.log(`  ✅ Computadora Dell Inspiron 15 — Bs. 8,000 / 36 meses (Línea Recta)`);
  } else {
    console.log(`  ⏭️  Activo fijo ya existe`);
  }

  // ── 14. Inventario ────────────────────────────────────────────────────────
  console.log("\n📦 Inventario...");

  const itemDefs = [
    {
      sku: "PROD-001", name: "Cable HDMI 2.0 (2m)", unit: "unidad",
      averageCost: "962.00", stockQuantity: "45", minimumStock: "10",   // ≈USD 2 × 481
    },
    {
      sku: "PROD-002", name: "Teclado Mecánico USB", unit: "unidad",
      averageCost: "7215.00", stockQuantity: "18", minimumStock: "5",   // ≈USD 15 × 481
    },
    {
      sku: "PROD-003", name: "Mouse Inalámbrico Logitech", unit: "unidad",
      averageCost: "3848.00", stockQuantity: "8", minimumStock: "10",   // ≈USD 8 × 481 — bajo stock → alerta
    },
  ];

  for (const item of itemDefs) {
    const existing = await prisma.inventoryItem.findUnique({
      where: { companyId_sku: { companyId: cId, sku: item.sku } },
    });
    if (!existing) {
      const created = await prisma.inventoryItem.create({
        data: {
          companyId: cId,
          sku: item.sku,
          name: item.name,
          unit: item.unit,
          baseUnitName: item.unit,
          baseUnitAbbr: item.unit.substring(0, 10).toUpperCase(),
          averageCost: item.averageCost,
          stockQuantity: item.stockQuantity,
          minimumStock: item.minimumStock,
          accountId: accounts["1115"],
          cogsAccountId: accounts["5110"],
          createdBy: USER_ID,
        },
      });

      // Movimiento de entrada inicial
      await prisma.inventoryMovement.create({
        data: {
          companyId: cId,
          itemId: created.id,
          type: "ENTRADA" as MovementType,
          status: "POSTED" as MovementStatus,
          quantity: item.stockQuantity,
          unitCost: item.averageCost,
          totalCost: String(parseFloat(item.stockQuantity) * parseFloat(item.averageCost)),
          quantityInUnit: item.stockQuantity,
          conversionSnapshot: "1.0000000000",
          reference: `Inventario inicial — ${item.sku}`,
          date: dateOnly("2026-04-01"),
          idempotencyKey: `demo-inv-entry-${item.sku}`,
          createdBy: USER_ID,
          postedAt: dateOnly("2026-04-01"),
          postedBy: USER_ID,
        },
      });
      console.log(`  ✅ ${item.sku} — ${item.name} (stock: ${item.stockQuantity} ${item.unit})`);
    } else {
      console.log(`  ⏭️  ${item.sku} ya existe`);
    }
  }

  // ── 15. Tasas INPC (para ajuste por inflación) ────────────────────────────
  console.log("\n📈 Tasas INPC...");
  const inpcRates = [
    { year: 2026, month: 1, indexValue: "12450.500000" },
    { year: 2026, month: 2, indexValue: "12698.750000" },
    { year: 2026, month: 3, indexValue: "12952.200000" },
  ];

  for (const rate of inpcRates) {
    await prisma.iNPCRate.upsert({
      where: { companyId_year_month: { companyId: cId, year: rate.year, month: rate.month } },
      update: { indexValue: rate.indexValue },
      create: { companyId: cId, ...rate },
    });
    console.log(`  ✅ INPC ${rate.year}-${String(rate.month).padStart(2, "0")}: ${rate.indexValue}`);
  }

  // ── 16. Compras y Ventas — Cotizaciones y Órdenes ────────────────────────
  console.log("\n🛒 Compras y Ventas...");

  // Secuencias de numeración (para que el próximo número autogenerado no colisione)
  const seqDefs = [
    { docType: OrderDocType.PURCHASE_QUOTATION, lastNumber: 2 },
    { docType: OrderDocType.SALE_QUOTATION,     lastNumber: 1 },
    { docType: OrderDocType.PURCHASE_ORDER,     lastNumber: 1 },
    { docType: OrderDocType.SALE_ORDER,         lastNumber: 1 },
  ];
  for (const seq of seqDefs) {
    await prisma.orderNumberSequence.upsert({
      where: { companyId_docType: { companyId: cId, docType: seq.docType } },
      update: { lastNumber: seq.lastNumber },
      create: { companyId: cId, docType: seq.docType, lastNumber: seq.lastNumber },
    });
  }

  // ── Cotización 1: PRE-0001 — SALE / DRAFT ────────────────────────────────
  await prisma.quotation.upsert({
    where: { companyId_number_type: { companyId: cId, number: "PRE-0001", type: QuotationType.SALE } },
    update: {},
    create: {
      companyId: cId,
      type:      QuotationType.SALE,
      status:    QuotationStatus.DRAFT,
      number:    "PRE-0001",
      counterpartName: "Laboratorios Behrens C.A.",
      counterpartRif:  "J-00019533-8",
      validUntil: new Date("2026-05-30T00:00:00Z"),
      notes:    "Propuesta de servicios contables mensuales",
      subtotal:  "450000.0000",
      taxAmount: "72000.0000",
      total:     "522000.0000",
      currency:  Currency.VES,
      createdBy: USER_ID,
      items: {
        create: [{
          description: "Servicio de consultoría contable — Abril 2026",
          unit: "MES", quantity: "1.0000", unitPrice: "450000.0000",
          taxRate: "16.00", totalPrice: "450000.0000",
        }],
      },
    },
  });
  console.log("  ✅ PRE-0001 (SALE / DRAFT) — Laboratorios Behrens");

  // ── Cotización 2: COT-0001 — PURCHASE / APPROVED ──────────────────────────
  await prisma.quotation.upsert({
    where: { companyId_number_type: { companyId: cId, number: "COT-0001", type: QuotationType.PURCHASE } },
    update: {},
    create: {
      companyId: cId,
      type:   QuotationType.PURCHASE,
      status: QuotationStatus.APPROVED,
      number: "COT-0001",
      counterpartName: "Distribuidora Tecno C.A.",
      counterpartRif:  "J-30456789-1",
      validUntil: new Date("2026-05-15T00:00:00Z"),
      notes:    "Renovación equipos informáticos sede principal",
      subtotal:  "620000.0000",
      taxAmount: "99200.0000",
      total:     "719200.0000",
      currency:  Currency.VES,
      createdBy: USER_ID,
      items: {
        create: [
          {
            description: "Computadoras portátiles HP ProBook 450",
            unit: "UND", quantity: "2.0000", unitPrice: "280000.0000",
            taxRate: "16.00", totalPrice: "560000.0000",
          },
          {
            description: "Mouse y teclados inalámbricos Logitech",
            unit: "UND", quantity: "5.0000", unitPrice: "12000.0000",
            taxRate: "16.00", totalPrice: "60000.0000",
          },
        ],
      },
    },
  });
  console.log("  ✅ COT-0001 (PURCHASE / APPROVED) — Distribuidora Tecno");

  // ── Cotización 3: COT-0002 — PURCHASE / CONVERTED (vinculada a OC-0001) ──
  const quot3 = await prisma.quotation.upsert({
    where: { companyId_number_type: { companyId: cId, number: "COT-0002", type: QuotationType.PURCHASE } },
    update: {},
    create: {
      companyId: cId,
      type:   QuotationType.PURCHASE,
      status: QuotationStatus.CONVERTED,
      number: "COT-0002",
      counterpartName: "Suministros del Norte C.A.",
      counterpartRif:  "J-40556677-3",
      validUntil: new Date("2026-04-30T00:00:00Z"),
      notes:    "Reposición mensual de suministros de oficina",
      subtotal:  "150000.0000",
      taxAmount: "24000.0000",
      total:     "174000.0000",
      currency:  Currency.VES,
      createdBy: USER_ID,
      items: {
        create: [{
          description: "Suministros de oficina varios (papel, carpetas, bolígrafos)",
          unit: "KIT", quantity: "10.0000", unitPrice: "15000.0000",
          taxRate: "16.00", totalPrice: "150000.0000",
        }],
      },
    },
  });
  console.log("  ✅ COT-0002 (PURCHASE / CONVERTED) — Suministros del Norte");

  // ── Orden de Compra: OC-0001 — PURCHASE / APPROVED (proviene de COT-0002) ─
  await prisma.order.upsert({
    where: { companyId_number_type: { companyId: cId, number: "OC-0001", type: QuotationType.PURCHASE } },
    update: {},
    create: {
      companyId:   cId,
      type:        QuotationType.PURCHASE,
      status:      OrderStatus.APPROVED,
      number:      "OC-0001",
      quotationId: quot3.id,
      counterpartName: "Suministros del Norte C.A.",
      counterpartRif:  "J-40556677-3",
      expectedDate: new Date("2026-04-25T00:00:00Z"),
      notes:    "Generada desde cotización COT-0002",
      subtotal:  "150000.0000",
      taxAmount: "24000.0000",
      total:     "174000.0000",
      currency:  Currency.VES,
      createdBy: USER_ID,
      items: {
        create: [{
          description: "Suministros de oficina varios (papel, carpetas, bolígrafos)",
          unit: "KIT", quantity: "10.0000", unitPrice: "15000.0000",
          taxRate: "16.00", totalPrice: "150000.0000",
        }],
      },
    },
  });
  console.log("  ✅ OC-0001 (PURCHASE / APPROVED) — vinculada a COT-0002");

  // ── Orden de Venta: OV-0001 — SALE / APPROVED (standalone) ───────────────
  await prisma.order.upsert({
    where: { companyId_number_type: { companyId: cId, number: "OV-0001", type: QuotationType.SALE } },
    update: {},
    create: {
      companyId: cId,
      type:      QuotationType.SALE,
      status:    OrderStatus.APPROVED,
      number:    "OV-0001",
      counterpartName: "Clínica El Ávila C.A.",
      counterpartRif:  "J-07547583-3",
      expectedDate: new Date("2026-04-30T00:00:00Z"),
      notes:    "Orden de venta directa — sin cotización previa",
      subtotal:  "950000.0000",
      taxAmount: "152000.0000",
      total:     "1102000.0000",
      currency:  Currency.VES,
      createdBy: USER_ID,
      items: {
        create: [
          {
            description: "Licencia ContaFlow — Plan Anual",
            unit: "UND", quantity: "1.0000", unitPrice: "800000.0000",
            taxRate: "16.00", totalPrice: "800000.0000",
          },
          {
            description: "Capacitación y soporte técnico",
            unit: "HRS", quantity: "3.0000", unitPrice: "50000.0000",
            taxRate: "16.00", totalPrice: "150000.0000",
          },
        ],
      },
    },
  });
  console.log("  ✅ OV-0001 (SALE / APPROVED) — Clínica El Ávila (standalone)");

  // ── 18. Factura de venta con IVA Adicional Lujo ──────────────────────────
  console.log("\n🧾 Factura Lujo (IVA Adicional 31%)...");
  const luxuryExisting = await prisma.invoice.findUnique({
    where: { companyId_invoiceNumber_type: { companyId: cId, invoiceNumber: "0007", type: "SALE" } },
  });
  if (!luxuryExisting) {
    await prisma.invoice.create({
      data: {
        companyId: cId,
        type: "SALE" as InvoiceType,
        docType: "FACTURA" as InvoiceDocType,
        taxCategory: "GRAVADA" as TaxCategory,
        invoiceNumber: "0007",
        controlNumber: "00-00000007",
        date: d(16),
        dueDate: d(31),
        counterpartName: "Boutique Glamour Internacional C.A.",
        counterpartRif: "J-50123456-7",
        periodId: period.id,
        totalAmountVes: "262000.00",
        pendingAmount: "0.00",
        paymentStatus: "PAID" as InvoicePaymentStatus,
        createdBy: USER_ID,
        taxLines: {
          create: [
            { taxType: "IVA_GENERAL" as TaxLineType, taxCategory: "GRAVADA" as TaxCategory, base: "200000.00", rate: 16, amount: "32000.00" },
            { taxType: "IVA_ADICIONAL" as TaxLineType, taxCategory: "GRAVADA" as TaxCategory, base: "200000.00", rate: 15, amount: "30000.00" },
          ],
        },
      },
    });
    console.log("  ✅ SALE 0007 — Boutique Glamour — Bs. 262,000 [IVA Adicional Lujo 31%]");
  } else {
    console.log("  ⏭️  SALE 0007 ya existe");
  }

  // ── 19. Retención ISLR (Decreto 1808 — Honorarios Profesionales 5%) ──────
  console.log("\n📋 Retención ISLR...");
  await prisma.retencion.upsert({
    where: { idempotencyKey: "demo-ret-islr-001" },
    update: {},
    create: {
      companyId: cId,
      providerName: "Servicios Informáticos Andinos C.A.",
      providerRif: "J-40234567-8",
      invoiceNumber: "C-0003",
      invoiceDate: d(9),
      invoiceAmount: "263320.00",
      taxBase: "227000.00",
      ivaAmount: "36320.00",
      ivaRetention: "0.00",
      ivaRetentionPct: "0.00",
      islrAmount: "11350.00",   // 5% × Bs. 227,000
      islrRetentionPct: "5.00",
      totalRetention: "11350.00",
      type: "ISLR" as RetentionType,
      status: "ISSUED" as RetentionStatus,
      invoiceId: purchaseInvoiceIds[2],
      voucherNumber: "RIS-2026-001",
      idempotencyKey: "demo-ret-islr-001",
      createdBy: USER_ID,
    },
  });
  console.log("  ✅ RIS-2026-001 — Servicios Informáticos Andinos — ISLR 5% — Bs. 11,350");

  // ── 20. Asientos Contables Manuales (Libro Diario) ────────────────────────
  console.log("\n📒 Asientos contables...");

  const asientoDefs = [
    {
      number: "A-2026-001",
      date: d(1),
      description: "Apertura: inversión inicial de capital",
      entries: [
        { accountCode: "1110", amount: "1500000.00" },   // Bancos +1,500,000 (Débito)
        { accountCode: "3105", amount: "-1500000.00" },  // Capital Social -1,500,000 (Crédito)
      ],
    },
    {
      number: "A-2026-002",
      date: d(5),
      description: "Pago de alquiler de oficina — Abril 2026",
      entries: [
        { accountCode: "5120", amount: "180000.00" },    // Alquileres +180,000 (Débito)
        { accountCode: "1110", amount: "-180000.00" },   // Bancos -180,000 (Crédito)
      ],
    },
    {
      number: "A-2026-003",
      date: d(20),
      description: "Pago de servicios públicos — internet y electricidad",
      entries: [
        { accountCode: "5125", amount: "24000.00" },     // Servicios Públicos +24,000 (Débito)
        { accountCode: "1110", amount: "-24000.00" },    // Bancos -24,000 (Crédito)
      ],
    },
    {
      number: "A-2026-004",
      date: d(30),
      description: "Depreciación mensual — Computadora Dell Inspiron 15",
      entries: [
        { accountCode: "5115", amount: "9722.22" },      // Depreciación +9,722.22 (Débito)
        { accountCode: "1510", amount: "-9722.22" },     // Dep. Acum. Equipos -9,722.22 (Crédito)
      ],
    },
  ];

  for (const asiento of asientoDefs) {
    const existing = await prisma.transaction.findUnique({
      where: { companyId_number: { companyId: cId, number: asiento.number } },
    });
    if (!existing) {
      await prisma.transaction.create({
        data: {
          companyId: cId,
          number: asiento.number,
          date: asiento.date,
          description: asiento.description,
          periodId: period.id,
          userId: USER_ID,
          entries: {
            create: asiento.entries.map((e) => ({
              accountId: accounts[e.accountCode]!,
              amount: e.amount,
            })),
          },
        },
      });
      console.log(`  ✅ ${asiento.number} — ${asiento.description}`);
    } else {
      console.log(`  ⏭️  ${asiento.number} ya existe`);
    }
  }

  // ─── Resumen ────────────────────────────────────────────────────────────────
  console.log(`
╔════════════════════════════════════════════════════╗
║          SEED DEMO COMPLETADO — Abril 2026         ║
╠════════════════════════════════════════════════════╣
║  📊 ${accountDefs.length} cuentas contables                            ║
║  📅 1 período fiscal OPEN (Abr 2026)               ║
║  💱 5 tasas BCV (USD/VES)                          ║
║  🏭 ${vendorDefs.length} proveedores                                   ║
║  👥 ${customerDefs.length} clientes                                    ║
║  🧾 ${saleDefs.length + 1} facturas de venta (incl. lujo 31%)          ║
║  🛒 ${purchaseDefs.length} facturas de compra                          ║
║  📋 3 retenciones IVA 75% + 1 ISLR 5%             ║
║  📒 4 asientos contables manuales                  ║
║  🏦 1 cuenta bancaria + estado de cuenta           ║
║  👤 3 empleados con historial salarial             ║
║  🖥️  1 activo fijo (PC 36 meses)                  ║
║  📦 3 ítems de inventario                          ║
║  📈 3 meses de tasas INPC                          ║
║  📋 3 cotizaciones + 2 órdenes (C&V)               ║
╚════════════════════════════════════════════════════╝

Próximos pasos en la app:
  1. Revisar Dashboard KPIs → métricas del período
  2. Libro de Ventas → 5 facturas SALE
  3. Libro de Compras → 5 facturas PURCHASE + 3 retenciones
  4. Generar Forma 30 IVA de Abril 2026
  5. Conciliación Bancaria → 6 transacciones del banco
  6. Nómina → Calcular nómina Abril 2026 (3 empleados)
  7. Depreciación → Registrar depreciación mensual PC
  8. Asistente IA → "auditar el período actual"
  9. Compras y Ventas → PRE-0001 (borrador), COT-0001 (aprobada), COT-0002→OC-0001 (flujo completo)
  `);
}

main()
  .catch((e) => {
    console.error("❌ Seed demo fallido:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
