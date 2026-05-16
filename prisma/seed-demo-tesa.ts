// prisma/seed-demo-tesa.ts
// ─────────────────────────────────────────────────────────────────────────────
// Seed simulación TESA — Tecnología y Suministros Andina, C.A.
// Período: Abril 2026 | Banco: BNC | RIF: J-31645287-9
//
// Cubre: empresa, cuentas, período, tasas BCV, proveedores, clientes,
//        inventario (SERIAL + LOT + NONE), lotes, seriales, activos fijos,
//        empleados, nómina (DRAFT), prestaciones, préstamo empleado,
//        facturas (0%/8%/16%/31%), retenciones IVA+ISLR, pagos mixtos,
//        IGTF, conciliación BNC, cotizaciones, órdenes, gastos, caja chica,
//        asientos contables.
//
// IDEMPOTENTE: se puede correr múltiples veces.
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
  ConceptType,
  TrackingType,
  SerialStatus,
  ExpenseStatus,
  PayrollRunStatus,
  LegalThresholdType,
  BcvRateType,
  BenefitAccrualType,
  LoanStatus,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import "dotenv/config";
import { Decimal } from "decimal.js";
import { InvoiceGLPostingService } from "../src/modules/invoices/services/InvoiceGLPostingService";

const connectionString = process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── Constantes ───────────────────────────────────────────────────────────────

const USER_ID = "user_3ASUXQGjepsTxT5W6AcIyytnqdf";
const TESA_RIF = "J-31645287-9";

const d = (day: number) => new Date(`2026-04-${String(day).padStart(2, "0")}T12:00:00Z`);
const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`);

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Iniciando seed TESA — Abril 2026...\n");

  // ── 0. Empresa TESA ──────────────────────────────────────────────────────
  console.log("🏢 Empresa TESA...");
  const company = await prisma.company.upsert({
    where: { rif: TESA_RIF },
    update: {
      name: "Tecnología y Suministros Andina, C.A.",
      address: "Av. Libertador, Torre Empresarial, Piso 5, Of. 5-B, Caracas 1050",
      telefono: "0212-555-8900",
      email: "administracion@tesa.com.ve",
      ciiu: "4651",
      actividad: "Comercio al por mayor de computadoras, equipos periféricos y programas informáticos",
      isSpecialContributor: true,
    },
    create: {
      name: "Tecnología y Suministros Andina, C.A.",
      rif: TESA_RIF,
      address: "Av. Libertador, Torre Empresarial, Piso 5, Of. 5-B, Caracas 1050",
      telefono: "0212-555-8900",
      email: "administracion@tesa.com.ve",
      ciiu: "4651",
      actividad: "Comercio al por mayor de computadoras, equipos periféricos y programas informáticos",
      isSpecialContributor: true,
    },
  });
  const cId = company.id;
  console.log(`  ✅ ${company.name} (${cId})`);

  // Membership del usuario en TESA
  await prisma.companyMember.upsert({
    where: { userId_companyId: { userId: USER_ID, companyId: cId } },
    update: {},
    create: { userId: USER_ID, companyId: cId, role: "OWNER" },
  });
  console.log(`  ✅ Membership OWNER asignada`);

  // ── 1. Plan de Cuentas ────────────────────────────────────────────────────
  console.log("\n📊 Plan de cuentas...");
  const accountDefs: { code: string; name: string; type: AccountType; isMonetary?: boolean }[] = [
    // ACTIVOS
    { code: "1105", name: "Caja General", type: "ASSET" },
    { code: "1110", name: "BNC — Cuenta de Ahorro VES ***9550", type: "ASSET", isMonetary: true },
    { code: "1112", name: "BNC — Cuenta Corriente USD", type: "ASSET", isMonetary: true },
    { code: "1115", name: "Inventario de Mercancías", type: "ASSET" },
    { code: "1120", name: "IVA Crédito Fiscal", type: "ASSET", isMonetary: true },
    { code: "1305", name: "Cuentas por Cobrar — Clientes", type: "ASSET", isMonetary: true },
    { code: "1310", name: "Anticipo a Proveedores", type: "ASSET", isMonetary: true },
    { code: "1315", name: "Préstamos a Empleados", type: "ASSET", isMonetary: true },
    { code: "1505", name: "Servidores y Equipos de Red", type: "ASSET" },
    { code: "1510", name: "Dep. Acum. — Servidores y Equipos", type: "CONTRA_ASSET" },
    { code: "1520", name: "Vehículos", type: "ASSET" },
    { code: "1521", name: "Dep. Acum. — Vehículos", type: "CONTRA_ASSET" },
    // PASIVOS
    { code: "2105", name: "IVA Débito Fiscal", type: "LIABILITY", isMonetary: true },
    { code: "2110", name: "Retenciones IVA por Pagar", type: "LIABILITY", isMonetary: true },
    { code: "2115", name: "Retenciones ISLR por Pagar", type: "LIABILITY", isMonetary: true },
    { code: "2205", name: "Proveedores", type: "LIABILITY", isMonetary: true },
    { code: "2210", name: "Nómina por Pagar", type: "LIABILITY", isMonetary: true },
    { code: "2215", name: "IVSS por Pagar", type: "LIABILITY", isMonetary: true },
    { code: "2220", name: "INCES por Pagar", type: "LIABILITY", isMonetary: true },
    { code: "2225", name: "Vacaciones por Pagar", type: "LIABILITY", isMonetary: true },
    { code: "2230", name: "Prestaciones Sociales por Pagar", type: "LIABILITY", isMonetary: true },
    { code: "2235", name: "IGTF por Pagar", type: "LIABILITY", isMonetary: true },
    // PATRIMONIO
    { code: "3105", name: "Capital Social", type: "EQUITY" },
    { code: "3205", name: "Utilidades Retenidas", type: "EQUITY" },
    { code: "3210", name: "Resultado del Ejercicio", type: "EQUITY" },
    // INGRESOS
    { code: "4110", name: "Ventas — Equipos y Tecnología", type: "REVENUE" },
    { code: "4115", name: "Ventas — Equipos Médicos", type: "REVENUE" },
    { code: "4120", name: "Servicios de Capacitación", type: "REVENUE" },
    // GASTOS
    { code: "5105", name: "Sueldos y Salarios", type: "EXPENSE" },
    { code: "5107", name: "Beneficios Sociales y Prestaciones", type: "EXPENSE" },
    { code: "5110", name: "Costo de Ventas", type: "EXPENSE" },
    { code: "5115", name: "Depreciación de Activos", type: "EXPENSE" },
    { code: "5120", name: "Alquiler de Locales", type: "EXPENSE" },
    { code: "5125", name: "Servicios Públicos y Telecomunicaciones", type: "EXPENSE" },
    { code: "5130", name: "Gastos de Oficina y Papelería", type: "EXPENSE" },
    { code: "5135", name: "IGTF — Impuesto Grandes Transacciones", type: "EXPENSE" },
  ];

  const accounts: Record<string, string> = {};
  for (const acc of accountDefs) {
    const a = await prisma.account.upsert({
      where: { companyId_code: { companyId: cId, code: acc.code } },
      update: { name: acc.name, type: acc.type, isMonetary: acc.isMonetary ?? false },
      create: { companyId: cId, code: acc.code, name: acc.name, type: acc.type, isMonetary: acc.isMonetary ?? false },
    });
    accounts[acc.code] = a.id;
    process.stdout.write(`  ✅ ${acc.code} — ${acc.name}\n`);
  }

  // Configurar cuentas de cierre fiscal
  await prisma.company.update({
    where: { id: cId },
    data: { resultAccountId: accounts["3210"], retainedEarningsAccountId: accounts["3205"] },
  });
  console.log("  ✅ Cierre fiscal: 3210 + 3205");

  // ── 2. CompanySettings (GL mapping) ─────────────────────────────────────
  console.log("\n⚙️  CompanySettings GL...");
  await prisma.companySettings.upsert({
    where: { companyId: cId },
    update: {
      arAccountId:              accounts["1305"],
      apAccountId:              accounts["2205"],
      salesAccountId:           accounts["4110"],
      purchaseExpenseAccountId: accounts["5110"],
      ivaDFAccountId:           accounts["2105"],
      ivaCFAccountId:           accounts["1120"],
    },
    create: {
      companyId:                cId,
      arAccountId:              accounts["1305"],
      apAccountId:              accounts["2205"],
      salesAccountId:           accounts["4110"],
      purchaseExpenseAccountId: accounts["5110"],
      ivaDFAccountId:           accounts["2105"],
      ivaCFAccountId:           accounts["1120"],
    },
  });
  console.log("  ✅ GL mapping configurado");

  // ── 3. Topes Legales ─────────────────────────────────────────────────────
  console.log("\n⚖️  Topes legales...");
  await prisma.legalThreshold.upsert({
    where: { companyId_type_effectiveFrom: { companyId: cId, type: "SALARY_MIN_VES", effectiveFrom: dateOnly("2022-03-01") } },
    update: { value: "130.00" },
    create: { companyId: cId, type: "SALARY_MIN_VES", effectiveFrom: dateOnly("2022-03-01"), value: "130.00", notes: "Decreto presidencial — sin ajuste desde marzo 2022" },
  });
  await prisma.legalThreshold.upsert({
    where: { companyId_type_effectiveFrom: { companyId: cId, type: "UT_VALUE", effectiveFrom: dateOnly("2025-06-02") } },
    update: { value: "43.00" },
    create: { companyId: cId, type: "UT_VALUE", effectiveFrom: dateOnly("2025-06-02"), value: "43.00", notes: "Gaceta Oficial 43.140 — 02/06/2025" },
  });
  console.log("  ✅ Salario Mínimo: Bs. 130 | UT: Bs. 43");

  // ── 4. Período Abril 2026 ────────────────────────────────────────────────
  console.log("\n📅 Período contable...");
  const period = await prisma.accountingPeriod.upsert({
    where: { companyId_year_month: { companyId: cId, year: 2026, month: 4 } },
    update: {},
    create: { companyId: cId, year: 2026, month: 4, status: "OPEN", openedAt: dateOnly("2026-04-01"), openedBy: USER_ID },
  });
  console.log(`  ✅ Abril 2026 (${period.status})`);

  // ── 5. Tasas BCV ─────────────────────────────────────────────────────────
  console.log("\n💱 Tasas BCV Abril 2026...");
  const usdRates = [
    { date: "2026-04-01", rate: "468.50" },
    { date: "2026-04-07", rate: "474.35" },
    { date: "2026-04-14", rate: "480.20" },
    { date: "2026-04-21", rate: "486.50" },
    { date: "2026-04-28", rate: "492.80" },
  ];
  const rateIds: Record<string, string> = {};
  for (const er of usdRates) {
    const r = await prisma.exchangeRate.upsert({
      where: { companyId_currency_date: { companyId: cId, currency: "USD", date: dateOnly(er.date) } },
      update: { rate: er.rate },
      create: { companyId: cId, currency: "USD", rate: er.rate, date: dateOnly(er.date), source: "BCV", createdBy: USER_ID },
    });
    rateIds[er.date] = r.id;
    console.log(`  ✅ ${er.date}: 1 USD = ${er.rate} VES`);
  }
  // EUR (≈ 1.08 × USD)
  const eurRates = [
    { date: "2026-04-01", rate: "505.98" },
    { date: "2026-04-07", rate: "512.30" },
    { date: "2026-04-14", rate: "518.62" },
    { date: "2026-04-21", rate: "525.42" },
    { date: "2026-04-28", rate: "532.22" },
  ];
  for (const er of eurRates) {
    await prisma.exchangeRate.upsert({
      where: { companyId_currency_date: { companyId: cId, currency: "EUR", date: dateOnly(er.date) } },
      update: { rate: er.rate },
      create: { companyId: cId, currency: "EUR", rate: er.rate, date: dateOnly(er.date), source: "BCV", createdBy: USER_ID },
    });
  }
  console.log("  ✅ Tasas EUR también cargadas");

  // ── 6. Tasas INPC ────────────────────────────────────────────────────────
  console.log("\n📈 Tasas INPC...");
  for (const r of [
    { year: 2026, month: 1, indexValue: "12450.500000" },
    { year: 2026, month: 2, indexValue: "12698.750000" },
    { year: 2026, month: 3, indexValue: "12952.200000" },
  ]) {
    await prisma.iNPCRate.upsert({
      where: { companyId_year_month: { companyId: cId, year: r.year, month: r.month } },
      update: { indexValue: r.indexValue },
      create: { companyId: cId, ...r },
    });
    console.log(`  ✅ INPC ${r.year}-${String(r.month).padStart(2, "0")}: ${r.indexValue}`);
  }

  // ── 7. Proveedores ────────────────────────────────────────────────────────
  console.log("\n🏭 Proveedores...");
  const vendorDefs = [
    { name: "Importaciones Global Tech C.A.",        rif: "J-30987654-6", email: "ventas@globaltech.com.ve" },
    { name: "Distribuidora Médica Andina C.A.",       rif: "J-41123456-9", email: "pedidos@medandina.com.ve" },
    { name: "Servicios Cloud Venezuela C.A.",         rif: "J-29345678-5", email: "soporte@cloudven.com.ve" },
    { name: "Papelería Caracas Norte C.A.",           rif: "J-20456789-2", email: "ventas@papcaracas.com.ve" },
    { name: "Samsung Venezuela Representaciones C.A.",rif: "J-31123456-7", email: "b2b@samsung.com.ve" },
  ];
  const vendors: Record<string, string> = {};
  for (const v of vendorDefs) {
    const existing = await prisma.vendor.findFirst({ where: { companyId: cId, rif: v.rif } });
    const vend = existing
      ? await prisma.vendor.update({ where: { id: existing.id }, data: { name: v.name, email: v.email } })
      : await prisma.vendor.create({ data: { companyId: cId, ...v } });
    vendors[v.name] = vend.id;
    console.log(`  ✅ ${v.name}`);
  }

  // ── 8. Clientes ───────────────────────────────────────────────────────────
  console.log("\n👥 Clientes...");
  const customerDefs = [
    { name: "Clínica Médica Caracas, S.A.",          rif: "J-40123456-8", email: "compras@clinicacaracas.com.ve" },
    { name: "Universidad Central de Venezuela",       rif: "J-00305299-5", email: "daf@ucv.ve" },
    { name: "Distribuidora Orinoco Tech C.A.",        rif: "J-32456789-1", email: "tecnologia@orinocotech.com.ve" },
    { name: "Smart Solutions Venezuela C.A.",         rif: "J-29876543-7", email: "ventas@smartsolutions.com.ve" },
    { name: "Industrias Metálicas del Llano C.A.",    rif: "J-31245678-3", email: "logistica@indumetallano.com.ve" },
    { name: "Carlos Eduardo Rivas",                   rif: "V-17234567-8", email: "c.rivas@gmail.com" },
  ];
  const customers: Record<string, string> = {};
  for (const c of customerDefs) {
    const existing = await prisma.customer.findFirst({ where: { companyId: cId, rif: c.rif } });
    const cust = existing
      ? await prisma.customer.update({ where: { id: existing.id }, data: { name: c.name, email: c.email } })
      : await prisma.customer.create({ data: { companyId: cId, ...c } });
    customers[c.name] = cust.id;
    console.log(`  ✅ ${c.name}`);
  }

  // ── 9. Inventario ─────────────────────────────────────────────────────────
  console.log("\n📦 Inventario...");
  const itemDefs = [
    // Seriales — laptops
    { sku: "LAP-001", name: "Laptop Lenovo ThinkPad L14 Gen 4 (Intel i7)", unit: "unidad",
      trackingType: "SERIAL" as TrackingType, averageCost: "369993.00", stockQuantity: "5", minimumStock: "2" },
    // Seriales — smartwatches (artículo de lujo — IVA adicional 31% al vender)
    { sku: "SWT-001", name: "Smartwatch Samsung Galaxy Watch 6 40mm", unit: "unidad",
      trackingType: "SERIAL" as TrackingType, averageCost: "109100.00", stockQuantity: "4", minimumStock: "1" },
    // Lotes — oxímetros (IVA reducido 8%)
    { sku: "OXI-001", name: "Oxímetro Fingertip CONTEC CMS50D", unit: "unidad",
      trackingType: "LOT" as TrackingType, averageCost: "13282.00", stockQuantity: "20", minimumStock: "5" },
    // Lotes — tensiómetros (IVA reducido 8%)
    { sku: "TEN-001", name: "Tensiómetro Digital Omron HEM-7141T1", unit: "unidad",
      trackingType: "LOT" as TrackingType, averageCost: "22769.00", stockQuantity: "12", minimumStock: "3" },
    // Sin tracking — servicio capacitación (IVA exento 0%)
    { sku: "CAP-SVC", name: "Servicio de Capacitación Ofimática (por hora)", unit: "hora",
      trackingType: "NONE" as TrackingType, averageCost: "0.00", stockQuantity: "999", minimumStock: "0" },
    // Sin tracking — suministros (IVA general 16%)
    { sku: "SUMIN-001", name: "Kit Suministros de Oficina General", unit: "kit",
      trackingType: "NONE" as TrackingType, averageCost: "1423.00", stockQuantity: "150", minimumStock: "20" },
  ];

  const items: Record<string, string> = {};
  for (const item of itemDefs) {
    const existing = await prisma.inventoryItem.findUnique({ where: { companyId_sku: { companyId: cId, sku: item.sku } } });
    let created = existing;
    if (!existing) {
      created = await prisma.inventoryItem.create({
        data: {
          companyId: cId, sku: item.sku, name: item.name,
          baseUnitName: item.unit, baseUnitAbbr: item.unit.substring(0, 10).toUpperCase(),
          trackingType: item.trackingType, averageCost: item.averageCost,
          stockQuantity: item.stockQuantity, minimumStock: item.minimumStock,
          accountId: accounts["1115"], cogsAccountId: accounts["5110"], createdBy: USER_ID,
        },
      });

      // Movimiento de entrada inicial
      await prisma.inventoryMovement.create({
        data: {
          companyId: cId, itemId: created!.id, type: "ENTRADA", status: "POSTED",
          quantity: item.stockQuantity, unitCost: item.averageCost,
          totalCost: String(parseFloat(item.stockQuantity) * parseFloat(item.averageCost)),
          quantityInUnit: item.stockQuantity, conversionSnapshot: "1.0000000000",
          reference: `Stock inicial TESA — ${item.sku}`,
          date: dateOnly("2026-04-01"), idempotencyKey: `tesa-inv-${item.sku}-init`,
          createdBy: USER_ID, postedAt: dateOnly("2026-04-01"), postedBy: USER_ID,
        },
      });
    }
    items[item.sku] = (created ?? existing)!.id;
    console.log(`  ✅ ${item.sku} — ${item.name} (${item.trackingType})`);
  }

  // ── 9b. Lotes (OXI-001 + TEN-001) ────────────────────────────────────────
  console.log("\n🗃️  Lotes de inventario...");
  const lotOxi = await prisma.inventoryLot.upsert({
    where: { companyId_itemId_lotNumber: { companyId: cId, itemId: items["OXI-001"], lotNumber: "L2026-001" } },
    update: {},
    create: {
      companyId: cId, itemId: items["OXI-001"], lotNumber: "L2026-001",
      quantityOnHand: "20", expiresAt: dateOnly("2027-03-31"),
      notes: "Importación directa CONTEC — Ref. Aduana 2026-OXI-7743", createdBy: USER_ID,
    },
  });
  const lotTen = await prisma.inventoryLot.upsert({
    where: { companyId_itemId_lotNumber: { companyId: cId, itemId: items["TEN-001"], lotNumber: "L2026-002" } },
    update: {},
    create: {
      companyId: cId, itemId: items["TEN-001"], lotNumber: "L2026-002",
      quantityOnHand: "12", expiresAt: dateOnly("2028-06-30"),
      notes: "Distribuidor Omron Venezuela — Factura 9954-2026", createdBy: USER_ID,
    },
  });
  console.log(`  ✅ Lote L2026-001 — OXI-001 (20 unid, vence 2027-03-31)`);
  console.log(`  ✅ Lote L2026-002 — TEN-001 (12 unid, vence 2028-06-30)`);
  void lotOxi; void lotTen;

  // ── 9c. Seriales (LAP-001 × 5 + SWT-001 × 4) ─────────────────────────────
  console.log("\n🔢 Números de serie...");
  const laptopSerials = ["SN-L14-2026-001", "SN-L14-2026-002", "SN-L14-2026-003", "SN-L14-2026-004", "SN-L14-2026-005"];
  const watchSerials  = ["SN-GW6-2026-001", "SN-GW6-2026-002", "SN-GW6-2026-003", "SN-GW6-2026-004"];

  for (const sn of laptopSerials) {
    const exists = await prisma.inventorySerial.findUnique({ where: { companyId_itemId_serialNumber: { companyId: cId, itemId: items["LAP-001"], serialNumber: sn } } });
    if (!exists) {
      await prisma.inventorySerial.create({ data: { companyId: cId, itemId: items["LAP-001"], serialNumber: sn, status: "AVAILABLE", createdBy: USER_ID } });
    }
    process.stdout.write(`  ✅ ${sn}\n`);
  }
  for (const sn of watchSerials) {
    const exists = await prisma.inventorySerial.findUnique({ where: { companyId_itemId_serialNumber: { companyId: cId, itemId: items["SWT-001"], serialNumber: sn } } });
    if (!exists) {
      await prisma.inventorySerial.create({ data: { companyId: cId, itemId: items["SWT-001"], serialNumber: sn, status: "AVAILABLE", createdBy: USER_ID } });
    }
    process.stdout.write(`  ✅ ${sn}\n`);
  }

  // ── 10. Activos Fijos ─────────────────────────────────────────────────────
  console.log("\n🖥️  Activos fijos...");
  // Servidor HPE — adquirido ene 2025 a USD 4,500 × 430 Bs = Bs. 1,935,000 — vida útil 60 meses
  const existingServer = await prisma.fixedAsset.findFirst({ where: { companyId: cId, name: "Servidor HPE ProLiant ML350 Gen11" } });
  if (!existingServer) {
    await prisma.fixedAsset.create({
      data: {
        companyId: cId, name: "Servidor HPE ProLiant ML350 Gen11",
        description: "Servidor principal sede Caracas — host app interna + NAS",
        assetAccountId: accounts["1505"], depreciationAccountId: accounts["5115"], accDepreciationAccountId: accounts["1510"],
        acquisitionDate: dateOnly("2025-01-15"), acquisitionCost: "1935000.00",
        residualValue: "193500.00", usefulLifeMonths: 60,
        depreciationMethod: "LINEA_RECTA" as DepreciationMethod, status: "ACTIVE" as FixedAssetStatus, createdBy: USER_ID,
      },
    });
    console.log("  ✅ Servidor HPE ProLiant ML350 — Bs. 1,935,000 / 60 meses");
  } else {
    console.log("  ⏭️  Servidor ya existe");
  }
  // Camioneta Toyota — adquirida mar 2024 a USD 35,000 × 410 Bs = Bs. 14,350,000 — vida útil 60 meses — residual 30%
  const existingTruck = await prisma.fixedAsset.findFirst({ where: { companyId: cId, name: "Camioneta Toyota Hilux DC 4x4 2024" } });
  if (!existingTruck) {
    await prisma.fixedAsset.create({
      data: {
        companyId: cId, name: "Camioneta Toyota Hilux DC 4x4 2024",
        description: "Vehículo de carga y distribución — placa AA-1234-BC",
        assetAccountId: accounts["1520"], depreciationAccountId: accounts["5115"], accDepreciationAccountId: accounts["1521"],
        acquisitionDate: dateOnly("2024-03-20"), acquisitionCost: "14350000.00",
        residualValue: "4305000.00", usefulLifeMonths: 60,
        depreciationMethod: "LINEA_RECTA" as DepreciationMethod, status: "ACTIVE" as FixedAssetStatus, createdBy: USER_ID,
      },
    });
    console.log("  ✅ Toyota Hilux DC — Bs. 14,350,000 / 60 meses (residual 30%)");
  } else {
    console.log("  ⏭️  Camioneta ya existe");
  }

  // ── 11. Empleados ─────────────────────────────────────────────────────────
  console.log("\n👤 Empleados TESA...");
  const employeeDefs = [
    { firstName: "Alejandro", lastName: "Blanco",    cedulaType: "V", cedulaNumber: "15445236", position: "Gerente Comercial",    department: "Comercial",       email: "a.blanco@tesa.com.ve",    salary: "2500.00",   salaryCurrency: "USD" as PayrollPaymentCurrency, hireDate: "2021-05-10", regime: "POST_2012" as LottRegime },
    { firstName: "Sofía",     lastName: "Hernández", cedulaType: "V", cedulaNumber: "18762341", position: "Contadora",            department: "Administración",  email: "s.hernandez@tesa.com.ve", salary: "1800.00",   salaryCurrency: "USD" as PayrollPaymentCurrency, hireDate: "2022-02-01", regime: "POST_2012" as LottRegime },
    { firstName: "Miguel",    lastName: "Torres",    cedulaType: "V", cedulaNumber: "21345678", position: "Técnico de Soporte",   department: "Tecnología",      email: "m.torres@tesa.com.ve",    salary: "1200.00",   salaryCurrency: "USD" as PayrollPaymentCurrency, hireDate: "2023-07-15", regime: "POST_2012" as LottRegime },
    { firstName: "Carmen",    lastName: "Díaz",      cedulaType: "V", cedulaNumber: "24789012", position: "Asistente de Ventas",  department: "Comercial",       email: "c.diaz@tesa.com.ve",      salary: "900.00",    salaryCurrency: "USD" as PayrollPaymentCurrency, hireDate: "2024-01-08", regime: "POST_2012" as LottRegime },
    { firstName: "Ramón",     lastName: "Flores",    cedulaType: "V", cedulaNumber: "27234567", position: "Almacenista",          department: "Logística",       email: "r.flores@tesa.com.ve",    salary: "390.00",    salaryCurrency: "VES" as PayrollPaymentCurrency, hireDate: "2023-03-20", regime: "POST_2012" as LottRegime },
    { firstName: "Isabella",  lastName: "Martínez",  cedulaType: "V", cedulaNumber: "29876543", position: "Diseñadora Gráfica",   department: "Marketing",       email: "i.martinez@tesa.com.ve",  salary: "1100.00",   salaryCurrency: "USD" as PayrollPaymentCurrency, hireDate: "2024-06-03", regime: "POST_2012" as LottRegime },
    { firstName: "José",      lastName: "Rodríguez", cedulaType: "V", cedulaNumber: "12345670", position: "Chofer",               department: "Logística",       email: "j.rodriguez@tesa.com.ve", salary: "260.00",    salaryCurrency: "VES" as PayrollPaymentCurrency, hireDate: "2022-09-01", regime: "POST_2012" as LottRegime },
    { firstName: "Patricia",  lastName: "López",     cedulaType: "V", cedulaNumber: "16789012", position: "Recepcionista",        department: "Administración",  email: "p.lopez@tesa.com.ve",     salary: "700.00",    salaryCurrency: "USD" as PayrollPaymentCurrency, hireDate: "2023-11-14", regime: "POST_2012" as LottRegime },
  ];

  const empIds: Record<string, string> = {};
  for (const emp of employeeDefs) {
    const { salary, salaryCurrency, hireDate, regime, ...empData } = emp;
    const employee = await prisma.employee.upsert({
      where: { companyId_cedulaType_cedulaNumber: { companyId: cId, cedulaType: empData.cedulaType, cedulaNumber: empData.cedulaNumber } },
      update: {},
      create: {
        companyId: cId, status: "ACTIVE" as EmployeeStatus,
        contractType: "INDEFINIDO" as ContractType, employeeRegime: regime,
        hireDate: dateOnly(hireDate), ...empData,
      },
    });
    const existingSalary = await prisma.salaryHistory.findFirst({ where: { employeeId: employee.id, effectiveFrom: dateOnly("2026-01-01") } });
    if (!existingSalary) {
      await prisma.salaryHistory.create({
        data: { companyId: cId, employeeId: employee.id, effectiveFrom: dateOnly("2026-01-01"), amount: salary, currency: salaryCurrency, createdByUserId: USER_ID },
      });
    }
    empIds[emp.lastName] = employee.id;
    console.log(`  ✅ ${emp.firstName} ${emp.lastName} — ${emp.position} (${salaryCurrency} ${salary})`);
  }

  // ── 12. PayrollConfig + Conceptos ─────────────────────────────────────────
  console.log("\n⚙️  Nómina config...");
  const existingPayrollConfig = await prisma.payrollConfig.findUnique({ where: { companyId: cId } });
  const payrollConfigData = {
    companyId: cId, frequency: "MONTHLY" as PayrollFrequency, lottRegime: "POST_2012" as LottRegime,
    sizeRange: "SMALL" as PayrollSizeRange, paymentCurrency: "USD" as PayrollPaymentCurrency,
    ivssEnabled: true, incesEnabled: true, banavihEnabled: true, rpeEnabled: true,
    cestaTicketType: "CARD" as CestaTicketType, fideicomiso: "INTERNAL" as FideicomisoType,
    salaryMinimumVes: "130.00", utValue: "43.00",
    profitDays: 30, vacationBonusDays: 7,
    expenseAccountId:              accounts["5105"],
    payableAccountId:              accounts["2210"],
    ivssPayableAccountId:          accounts["2215"],
    incesPayableAccountId:         accounts["2220"],
    faovPayableAccountId:          accounts["2215"],
    rpePayableAccountId:           accounts["2210"],
    benefitsExpenseAccountId:      accounts["5107"],
    benefitsPayableAccountId:      accounts["2230"],
    vacationPayableAccountId:      accounts["2225"],
    profitSharingPayableAccountId: accounts["2225"],
    loanReceivableAccountId:       accounts["1315"],
    disbursementBankAccountId:     accounts["1110"],
  };
  if (!existingPayrollConfig) {
    await prisma.payrollConfig.create({ data: payrollConfigData });
    console.log("  ✅ PayrollConfig creada");
  } else {
    await prisma.payrollConfig.update({
      where: { companyId: cId },
      data: { loanReceivableAccountId: accounts["1315"], disbursementBankAccountId: accounts["1110"] },
    });
    console.log("  ✅ PayrollConfig actualizada (cuentas préstamo)");
  }

  // Conceptos de nómina
  const conceptDefs = [
    { code: "SAL_BASE",      name: "Salario Base",                    type: "EARNING"   as ConceptType, isSystem: false, affectsSalaryIntegral: true  },
    { code: "BGE",           name: "Bono Guerra Económica",           type: "EARNING"   as ConceptType, isSystem: false, affectsSalaryIntegral: false },
    { code: "CESTA_TICKET",  name: "Cestaticket Socialista",          type: "EARNING"   as ConceptType, isSystem: true,  affectsSalaryIntegral: false },
    { code: "BONO_PROD",     name: "Bono de Productividad",           type: "EARNING"   as ConceptType, isSystem: false, affectsSalaryIntegral: false },
    { code: "IVSS_OBR",      name: "IVSS Obrero (4%)",                type: "DEDUCTION" as ConceptType, isSystem: true,  affectsSalaryIntegral: false },
    { code: "RPE_OBR",       name: "Paro Forzoso Obrero (0.5%)",      type: "DEDUCTION" as ConceptType, isSystem: true,  affectsSalaryIntegral: false },
    { code: "BANAVIH_OBR",   name: "BANAVIH Obrero (1%)",             type: "DEDUCTION" as ConceptType, isSystem: true,  affectsSalaryIntegral: false },
  ];
  const conceptIds: Record<string, string> = {};
  for (const c of conceptDefs) {
    const concept = await prisma.payrollConcept.upsert({
      where: { companyId_code: { companyId: cId, code: c.code } },
      update: {},
      create: { companyId: cId, ...c },
    });
    conceptIds[c.code] = concept.id;
    console.log(`  ✅ Concepto ${c.code} — ${c.name}`);
  }

  // ── 13. Tasa BCV para Prestaciones (Art. 143 LOTTT) ─────────────────────
  console.log("\n💰 Tasas BCV prestaciones...");
  for (const r of [
    { year: 2026, month: 1, annualRate: "58.47" },
    { year: 2026, month: 2, annualRate: "59.12" },
    { year: 2026, month: 3, annualRate: "59.75" },
  ]) {
    await prisma.bcvBenefitRate.upsert({
      where: { companyId_year_month: { companyId: cId, year: r.year, month: r.month } },
      update: {},
      create: { companyId: cId, ...r, rateType: "ACTIVA" as BcvRateType, createdByUserId: USER_ID },
    });
    console.log(`  ✅ BCV Activa ${r.year}-${String(r.month).padStart(2, "0")}: ${r.annualRate}% anual`);
  }

  // ── 14. Saldo Prestaciones (Alejandro Blanco — más antiguo) ───────────────
  console.log("\n📋 BenefitBalance (Alejandro Blanco)...");
  const existingBalance = await prisma.benefitBalance.findUnique({ where: { employeeId: empIds["Blanco"] } });
  if (!existingBalance) {
    const bb = await prisma.benefitBalance.create({
      data: {
        companyId: cId, employeeId: empIds["Blanco"],
        currentBalance: "8450.00",   // acumulado ~5 años × trimestres
        interestBalance: "312.80",
      },
    });
    // Línea de acumulación Q1 2026 — snapshot salario integral
    // Alejandro: $2500 USD × 480.20 Bs = 1,200,500 / 30 días = 40,016.67 diario
    // Alícuota utilidades: 30 días / 360 = 0.0833; Alícuota bono vacacional: 7/365 = 0.0192
    // Salario integral diario ≈ 40,016.67 × (1 + 0.0833 + 0.0192) = 43,114.98
    await prisma.benefitAccrualLine.create({
      data: {
        companyId: cId, benefitBalanceId: bb.id,
        type: "QUARTERLY_ACCRUAL" as BenefitAccrualType,
        year: 2026, quarter: 1, month: null,
        dailyNormalWage: "40016.67",
        profitDaysAliquot: "3334.70",
        vacationBonusDaysAliquot: "768.32",
        integralDailyWage: "44119.69",
        accrualDays: 5, additionalDays: "10",
        accrualAmount: "662.00",    // 5 días × 132.40 (en VES base — simbólico)
        runningBalance: "8450.00",
      },
    });
    console.log("  ✅ BenefitBalance Alejandro Blanco — saldo Bs. 8,450.00 + intereses Bs. 312.80");
  } else {
    console.log("  ⏭️  BenefitBalance ya existe");
  }

  // ── 14B. Préstamo a Empleado (Alejandro Blanco) ───────────────────────────
  console.log("\n🤝 Préstamo empleado...");
  const existingLoan = await prisma.employeeLoan.findFirst({
    where: { companyId: cId, employeeId: empIds["Blanco"] },
  });
  if (!existingLoan) {
    // $3,000 USD en 12 cuotas de $250. Ya pagó Feb + Mar 2026 (2 cuotas).
    await prisma.employeeLoan.create({
      data: {
        companyId: cId,
        employeeId: empIds["Blanco"],
        totalAmount:        "3000.0000",
        currency:           "USD",
        installments:       12,
        installmentAmount:  "250.0000",
        paidInstallments:   2,
        remainingBalance:   "2500.0000",
        status:             "ACTIVE" as LoanStatus,
        description:        "Préstamo personal — adquisición de equipo médico familiar",
      },
    });
    console.log("  ✅ EmployeeLoan — Alejandro Blanco — $3,000 USD / 12 cuotas ($250/mes) — 2 pagadas");
  } else {
    console.log("  ⏭️  EmployeeLoan ya existe");
  }

  // ── 15. PayrollRun DRAFT — Abril 2026 ─────────────────────────────────────
  console.log("\n💼 Nómina Abril 2026 (DRAFT)...");
  // Resumen nómina simplificado:
  // 6 USD employees × promedio $1,550 × 480.20 = 744,310 Bs c/u × 6 = 4,465,860
  // 2 VES employees (390 + 260 = 650 Bs)
  // Total bruto aprox ≈ 4,466,510 Bs
  // Deducciones IVSS obrero × 8 = 8 × (4% × 130) = 8 × 5.20 = Bs. 41.60
  // Net aprox: 4,466,468 Bs
  const existingRun = await prisma.payrollRun.findFirst({ where: { companyId: cId, periodStart: dateOnly("2026-04-01") } });
  if (!existingRun) {
    const run = await prisma.payrollRun.create({
      data: {
        companyId: cId, periodStart: dateOnly("2026-04-01"), periodEnd: dateOnly("2026-04-30"),
        status: "DRAFT" as PayrollRunStatus,
        totalEarnings: "4466510.40", totalDeductions: "41.60", totalNet: "4466468.80",
        employeeCount: 8, createdByUserId: USER_ID, idempotencyKey: "tesa-payroll-2026-04",
      },
    });
    // Líneas representativas (solo SAL_BASE + IVSS para 3 empleados — el resto es igual)
    const runLines = [
      // Alejandro Blanco — $2,500 × 480.20 = 1,200,500 Bs base; IVSS 4% × 130 = 5.20
      { empKey: "Blanco",    conceptKey: "SAL_BASE",  amount: "1200500.00", basis: "1200500.00", rate: null },
      { empKey: "Blanco",    conceptKey: "BGE",       amount: "96040.00",   basis: "200.00",     rate: null },
      { empKey: "Blanco",    conceptKey: "CESTA_TICKET", amount: "19208.00", basis: "40.00",     rate: null },
      { empKey: "Blanco",    conceptKey: "IVSS_OBR",  amount: "5.20",       basis: "130.00",     rate: "0.0400" },
      // Sofía Hernández — $1,800 × 480.20 = 864,360 Bs
      { empKey: "Hernández", conceptKey: "SAL_BASE",  amount: "864360.00",  basis: "864360.00",  rate: null },
      { empKey: "Hernández", conceptKey: "BGE",       amount: "96040.00",   basis: "200.00",     rate: null },
      { empKey: "Hernández", conceptKey: "CESTA_TICKET", amount: "19208.00", basis: "40.00",    rate: null },
      { empKey: "Hernández", conceptKey: "IVSS_OBR",  amount: "5.20",       basis: "130.00",     rate: "0.0400" },
      // Ramón Flores — Bs. 390 VES; IVSS 4% × 390 = 15.60 (< 1300)
      { empKey: "Flores",    conceptKey: "SAL_BASE",  amount: "390.00",     basis: "390.00",     rate: null },
      { empKey: "Flores",    conceptKey: "IVSS_OBR",  amount: "15.60",      basis: "390.00",     rate: "0.0400" },
    ];

    const empKeyToId: Record<string, string> = {
      "Blanco":    empIds["Blanco"],
      "Hernández": empIds["Hernández"],
      "Flores":    empIds["Flores"],
    };

    for (const line of runLines) {
      await prisma.payrollRunLine.create({
        data: {
          companyId: cId, payrollRunId: run.id,
          employeeId: empKeyToId[line.empKey],
          conceptId: conceptIds[line.conceptKey],
          conceptCode: line.conceptKey,
          conceptType: conceptDefs.find(c => c.code === line.conceptKey)!.type,
          amount: line.amount,
          basis: line.basis ?? null,
          rate: line.rate ?? null,
        },
      });
    }
    console.log(`  ✅ PayrollRun DRAFT — Bs. 4,466,510 bruto — 8 empleados (líneas representativas)`);
  } else {
    console.log("  ⏭️  PayrollRun ya existe");
  }

  // ── 16. Cuentas Bancarias BNC ─────────────────────────────────────────────
  console.log("\n🏦 Cuentas bancarias BNC...");
  let bankAccountVes = await prisma.bankAccount.findFirst({ where: { companyId: cId, accountNumber: "0105-0059-12-3195509550" } });
  if (!bankAccountVes) {
    bankAccountVes = await prisma.bankAccount.create({
      data: {
        companyId: cId, accountId: accounts["1110"],
        name: "BNC — Cuenta de Ahorro VES ***9550",
        bankName: "Banco Nacional de Crédito (BNC)", accountNumber: "0105-0059-12-3195509550",
        currency: "VES", closingBalance: "0", isActive: true, createdBy: USER_ID,
      },
    });
    console.log(`  ✅ ${bankAccountVes.name}`);
  } else {
    console.log("  ⏭️  Cuenta VES ya existe");
  }

  let bankAccountUsd = await prisma.bankAccount.findFirst({ where: { companyId: cId, accountNumber: "0105-0059-82-0019500001" } });
  if (!bankAccountUsd) {
    bankAccountUsd = await prisma.bankAccount.create({
      data: {
        companyId: cId, accountId: accounts["1112"],
        name: "BNC — Cuenta Corriente USD",
        bankName: "Banco Nacional de Crédito (BNC)", accountNumber: "0105-0059-82-0019500001",
        currency: "USD", closingBalance: "0", isActive: true, createdBy: USER_ID,
      },
    });
    console.log(`  ✅ ${bankAccountUsd.name}`);
  } else {
    console.log("  ⏭️  Cuenta USD ya existe");
  }

  // ── 17. Facturas de Venta ─────────────────────────────────────────────────
  console.log("\n🧾 Facturas de Venta...");

  // FAC-TESA-001: 2 laptops → Distribuidora Orinoco Tech — 16% IVA — pagada (Zelle)
  // Base: 2 × $780 × 474.35 = 2 × 369,993 = 739,986; IVA 16% = 118,398; Total = 858,384
  const saleInvoiceDefs = [
    {
      invoiceNumber: "TESA-001", controlNumber: "00-00000001",
      date: d(3), dueDate: d(18),
      counterpartName: "Distribuidora Orinoco Tech C.A.", counterpartRif: "J-32456789-1",
      customerId: customers["Distribuidora Orinoco Tech C.A."],
      base: "739986.00", taxType: "IVA_GENERAL" as TaxLineType, taxCategory: "GRAVADA" as TaxCategory,
      ivaRate: 16, ivaAmt: "118397.76", total: "858383.76", paymentStatus: "PAID" as InvoicePaymentStatus,
    },
    // FAC-TESA-002: 5 oxímetros + 3 tensiómetros → Clínica Médica — 8% IVA — pagada
    // Oxi: 5 × 13,282 = 66,410; Ten: 3 × 22,769 = 68,307; Base = 134,717; IVA 8% = 10,777; Total = 145,494
    {
      invoiceNumber: "TESA-002", controlNumber: "00-00000002",
      date: d(5), dueDate: d(20),
      counterpartName: "Clínica Médica Caracas, S.A.", counterpartRif: "J-40123456-8",
      customerId: customers["Clínica Médica Caracas, S.A."],
      base: "134717.00", taxType: "IVA_REDUCIDO" as TaxLineType, taxCategory: "GRAVADA" as TaxCategory,
      ivaRate: 8, ivaAmt: "10777.36", total: "145494.36", paymentStatus: "PAID" as InvoicePaymentStatus,
    },
    // FAC-TESA-003: 40 hrs capacitación → UCV — 0% exento — pagada (transferencia)
    // 40 hrs × $10/hr × 480.20 = 192,080 Bs exento
    {
      invoiceNumber: "TESA-003", controlNumber: "00-00000003",
      date: d(7), dueDate: d(22),
      counterpartName: "Universidad Central de Venezuela", counterpartRif: "J-00305299-5",
      customerId: customers["Universidad Central de Venezuela"],
      base: "192080.00", taxType: "EXENTO" as TaxLineType, taxCategory: "EXENTA" as TaxCategory,
      ivaRate: 0, ivaAmt: "0.00", total: "192080.00", paymentStatus: "PAID" as InvoicePaymentStatus,
    },
    // FAC-TESA-004: 2 smartwatches → Smart Solutions — 31% IVA — pagada parcial
    // Base: 2 × $230 × 486.50 = 223,790; IVA 16% = 35,806.40; IVA adicional 15% = 33,568.50; Total = 293,164.90
    {
      invoiceNumber: "TESA-004", controlNumber: "00-00000004",
      date: d(10), dueDate: d(25),
      counterpartName: "Smart Solutions Venezuela C.A.", counterpartRif: "J-29876543-7",
      customerId: customers["Smart Solutions Venezuela C.A."],
      base: "223790.00", taxType: "IVA_GENERAL" as TaxLineType, taxCategory: "GRAVADA" as TaxCategory,
      ivaRate: 16, ivaAmt: "35806.40", total: "293164.90", paymentStatus: "PARTIAL" as InvoicePaymentStatus,
      extraTaxLine: { taxType: "IVA_ADICIONAL" as TaxLineType, base: "223790.00", rate: 15, amount: "33568.50" },
    },
    // FAC-TESA-005: 1 laptop + suministros → Industrias Metálicas — 16% IVA — sin pagar
    // Laptop: 369,993 + Sumin 10 kits × 1,423 = 14,230; Base = 384,223; IVA 16% = 61,475.68; Total = 445,698.68
    {
      invoiceNumber: "TESA-005", controlNumber: "00-00000005",
      date: d(12), dueDate: d(27),
      counterpartName: "Industrias Metálicas del Llano C.A.", counterpartRif: "J-31245678-3",
      customerId: customers["Industrias Metálicas del Llano C.A."],
      base: "384223.00", taxType: "IVA_GENERAL" as TaxLineType, taxCategory: "GRAVADA" as TaxCategory,
      ivaRate: 16, ivaAmt: "61475.68", total: "445698.68", paymentStatus: "UNPAID" as InvoicePaymentStatus,
    },
    // FAC-TESA-006: 1 oxímetro → Carlos Rivas — 8% IVA — pagada
    // 1 × 13,282; IVA 8% = 1,062.56; Total = 14,344.56
    {
      invoiceNumber: "TESA-006", controlNumber: "00-00000006",
      date: d(15), dueDate: d(30),
      counterpartName: "Carlos Eduardo Rivas", counterpartRif: "V-17234567-8",
      customerId: customers["Carlos Eduardo Rivas"],
      base: "13282.00", taxType: "IVA_REDUCIDO" as TaxLineType, taxCategory: "GRAVADA" as TaxCategory,
      ivaRate: 8, ivaAmt: "1062.56", total: "14344.56", paymentStatus: "PAID" as InvoicePaymentStatus,
    },
    // FAC-TESA-007: Venta anticipada vencida (enero 2026 — para anomalías detectadas por IA)
    {
      invoiceNumber: "TESA-007", controlNumber: "00-00000007",
      date: new Date("2026-01-10T12:00:00Z"), dueDate: new Date("2026-01-25T12:00:00Z"),
      counterpartName: "Distribuidora Orinoco Tech C.A.", counterpartRif: "J-32456789-1",
      customerId: customers["Distribuidora Orinoco Tech C.A."],
      base: "468500.00", taxType: "IVA_GENERAL" as TaxLineType, taxCategory: "GRAVADA" as TaxCategory,
      ivaRate: 16, ivaAmt: "74960.00", total: "543460.00", paymentStatus: "UNPAID" as InvoicePaymentStatus,
    },
  ];

  const saleIds: Record<string, string> = {};
  for (const inv of saleInvoiceDefs) {
    const existing = await prisma.invoice.findUnique({
      where: { companyId_invoiceNumber_type: { companyId: cId, invoiceNumber: inv.invoiceNumber, type: "SALE" } },
    });
    if (!existing) {
      const pendingAmt = inv.paymentStatus === "PAID" ? "0.00" : inv.paymentStatus === "PARTIAL" ? "146582.45" : inv.total;
      const taxLines = inv.ivaRate > 0
        ? [{ taxType: inv.taxType, base: inv.base, rate: inv.ivaRate, amount: inv.ivaAmt }]
        : [{ taxType: "EXENTO" as TaxLineType, base: inv.base, rate: 0, amount: "0.00" }];
      if (inv.extraTaxLine) taxLines.push({ taxType: inv.extraTaxLine.taxType, base: inv.extraTaxLine.base, rate: inv.extraTaxLine.rate, amount: inv.extraTaxLine.amount });

      const created = await prisma.invoice.create({
        data: {
          companyId: cId, type: "SALE", docType: "FACTURA",
          taxCategory: inv.taxCategory, invoiceNumber: inv.invoiceNumber, controlNumber: inv.controlNumber,
          date: inv.date, dueDate: inv.dueDate,
          counterpartName: inv.counterpartName, counterpartRif: inv.counterpartRif,
          customerId: inv.customerId, periodId: period.id,
          totalAmountVes: inv.total, pendingAmount: pendingAmt,
          paymentStatus: inv.paymentStatus, createdBy: USER_ID,
          taxLines: { create: taxLines },
        },
      });
      saleIds[inv.invoiceNumber] = created.id;
      console.log(`  ✅ SALE ${inv.invoiceNumber} — ${inv.counterpartName} — Bs. ${inv.total} [${inv.paymentStatus}]`);
    } else {
      saleIds[inv.invoiceNumber] = existing.id;
      console.log(`  ⏭️  SALE ${inv.invoiceNumber} ya existe`);
    }
  }

  // ── 18. Facturas de Compra ────────────────────────────────────────────────
  console.log("\n🛒 Facturas de Compra...");
  const purchaseDefs = [
    // COMP-001: 5 laptops → Global Tech — 16% — pagada
    { invoiceNumber: "TCOMP-001", date: d(2), dueDate: d(17), counterpartName: "Importaciones Global Tech C.A.", counterpartRif: "J-30987654-6",
      vendorId: vendors["Importaciones Global Tech C.A."], base: "1849975.00", ivaRate: 16, ivaAmt: "295996.00", total: "2145971.00", paymentStatus: "PAID" as InvoicePaymentStatus },
    // COMP-002: 30 oxímetros + 20 tensiómetros → Médica Andina — 8% — pendiente
    { invoiceNumber: "TCOMP-002", date: d(4), dueDate: d(19), counterpartName: "Distribuidora Médica Andina C.A.", counterpartRif: "J-41123456-9",
      vendorId: vendors["Distribuidora Médica Andina C.A."], base: "854060.00", ivaRate: 8, ivaAmt: "68324.80", total: "922384.80", paymentStatus: "UNPAID" as InvoicePaymentStatus },
    // COMP-003: hosting/cloud → Cloud Venezuela — 16% — pagada parcial
    { invoiceNumber: "TCOMP-003", date: d(6), dueDate: d(21), counterpartName: "Servicios Cloud Venezuela C.A.", counterpartRif: "J-29345678-5",
      vendorId: vendors["Servicios Cloud Venezuela C.A."], base: "70275.00", ivaRate: 16, ivaAmt: "11244.00", total: "81519.00", paymentStatus: "PARTIAL" as InvoicePaymentStatus },
    // COMP-004: papelería → Papelería Caracas Norte — 16% — pagada
    { invoiceNumber: "TCOMP-004", date: d(9), dueDate: d(24), counterpartName: "Papelería Caracas Norte C.A.", counterpartRif: "J-20456789-2",
      vendorId: vendors["Papelería Caracas Norte C.A."], base: "56220.00", ivaRate: 16, ivaAmt: "8995.20", total: "65215.20", paymentStatus: "PAID" as InvoicePaymentStatus },
    // COMP-005: 4 smartwatches → Samsung — 16% — pendiente (venta tiene IVA adicional al cliente)
    { invoiceNumber: "TCOMP-005", date: d(11), dueDate: d(26), counterpartName: "Samsung Venezuela Representaciones C.A.", counterpartRif: "J-31123456-7",
      vendorId: vendors["Samsung Venezuela Representaciones C.A."], base: "436400.00", ivaRate: 16, ivaAmt: "69824.00", total: "506224.00", paymentStatus: "UNPAID" as InvoicePaymentStatus },
  ];

  const purchaseIds: Record<string, string> = {};
  for (const inv of purchaseDefs) {
    const existing = await prisma.invoice.findUnique({
      where: { companyId_invoiceNumber_type: { companyId: cId, invoiceNumber: inv.invoiceNumber, type: "PURCHASE" } },
    });
    if (!existing) {
      const pendingAmt = inv.paymentStatus === "PAID" ? "0.00" : inv.paymentStatus === "PARTIAL" ? "40759.50" : inv.total;
      const created = await prisma.invoice.create({
        data: {
          companyId: cId, type: "PURCHASE", docType: "FACTURA", taxCategory: "GRAVADA",
          invoiceNumber: inv.invoiceNumber, date: inv.date, dueDate: inv.dueDate,
          counterpartName: inv.counterpartName, counterpartRif: inv.counterpartRif,
          vendorId: inv.vendorId, periodId: period.id,
          totalAmountVes: inv.total, pendingAmount: pendingAmt,
          paymentStatus: inv.paymentStatus, createdBy: USER_ID,
          taxLines: {
            create: [{ taxType: inv.ivaRate === 8 ? "IVA_REDUCIDO" as TaxLineType : "IVA_GENERAL" as TaxLineType, base: inv.base, rate: inv.ivaRate, amount: inv.ivaAmt }],
          },
        },
      });
      purchaseIds[inv.invoiceNumber] = created.id;
      console.log(`  ✅ PURCHASE ${inv.invoiceNumber} — ${inv.counterpartName} — Bs. ${inv.total} [${inv.paymentStatus}]`);
    } else {
      purchaseIds[inv.invoiceNumber] = existing.id;
      console.log(`  ⏭️  PURCHASE ${inv.invoiceNumber} ya existe`);
    }
  }

  // ── 19. Retenciones IVA 75% y ISLR ───────────────────────────────────────
  console.log("\n📋 Retenciones...");
  // TESA es contribuyente especial → retiene 75% IVA en compras gravadas
  const retDefs = [
    // RET IVA 75% sobre TCOMP-001 (Global Tech laptops 16%)
    {
      key: "tesa-ret-iva-001", invoiceNumber: "TCOMP-001", type: "IVA" as RetentionType,
      providerName: "Importaciones Global Tech C.A.", providerRif: "J-30987654-6",
      invoiceDate: d(2), invoiceAmt: "2145971.00", taxBase: "1849975.00",
      ivaAmt: "295996.00", ivaRetention: "221997.00", // 75% de 295,996
      islrAmt: "0.00", islrPct: "0.00", total: "221997.00", voucher: "RIVA-2026-001",
    },
    // RET IVA 75% sobre TCOMP-003 (Cloud Venezuela servicios 16%)
    {
      key: "tesa-ret-iva-002", invoiceNumber: "TCOMP-003", type: "IVA" as RetentionType,
      providerName: "Servicios Cloud Venezuela C.A.", providerRif: "J-29345678-5",
      invoiceDate: d(6), invoiceAmt: "81519.00", taxBase: "70275.00",
      ivaAmt: "11244.00", ivaRetention: "8433.00", // 75% de 11,244
      islrAmt: "0.00", islrPct: "0.00", total: "8433.00", voucher: "RIVA-2026-002",
    },
    // RET ISLR 5% sobre TCOMP-003 (honorarios profesionales servicios cloud)
    {
      key: "tesa-ret-islr-001", invoiceNumber: "TCOMP-003", type: "ISLR" as RetentionType,
      providerName: "Servicios Cloud Venezuela C.A.", providerRif: "J-29345678-5",
      invoiceDate: d(6), invoiceAmt: "81519.00", taxBase: "70275.00",
      ivaAmt: "11244.00", ivaRetention: "0.00",
      islrAmt: "3513.75", islrPct: "5.00", total: "3513.75", voucher: "RISLR-2026-001",
    },
    // RET IVA 75% sobre TCOMP-004 (Papelería Caracas Norte 16%)
    {
      key: "tesa-ret-iva-003", invoiceNumber: "TCOMP-004", type: "IVA" as RetentionType,
      providerName: "Papelería Caracas Norte C.A.", providerRif: "J-20456789-2",
      invoiceDate: d(9), invoiceAmt: "65215.20", taxBase: "56220.00",
      ivaAmt: "8995.20", ivaRetention: "6746.40", // 75% de 8,995.20
      islrAmt: "0.00", islrPct: "0.00", total: "6746.40", voucher: "RIVA-2026-003",
    },
  ];

  for (const ret of retDefs) {
    await prisma.retencion.upsert({
      where: { idempotencyKey: ret.key },
      update: {},
      create: {
        companyId: cId, providerName: ret.providerName, providerRif: ret.providerRif,
        invoiceNumber: ret.invoiceNumber, invoiceDate: ret.invoiceDate,
        invoiceAmount: ret.invoiceAmt, taxBase: ret.taxBase,
        ivaAmount: ret.ivaAmt, ivaRetention: ret.ivaRetention, ivaRetentionPct: ret.type === "IVA" ? "75.00" : "0.00",
        islrAmount: ret.islrAmt, islrRetentionPct: ret.islrPct,
        totalRetention: ret.total, type: ret.type, status: "ISSUED" as RetentionStatus,
        invoiceId: purchaseIds[ret.invoiceNumber],
        voucherNumber: ret.voucher, idempotencyKey: ret.key, createdBy: USER_ID,
      },
    });
    console.log(`  ✅ ${ret.voucher} — ${ret.providerName} — ${ret.type} Bs. ${ret.total}`);
  }

  // ── 20. Pagos recibidos (PaymentRecord) ───────────────────────────────────
  console.log("\n💳 Pagos...");
  // Pago FAC-TESA-001 — Zelle USD desde Distribuidora Orinoco
  // $1,807.42 × 474.35 = 857,395.87 Bs (ligera diferencia de redondeo vs total factura 858,383.76)
  const pr1Exists = await prisma.paymentRecord.findFirst({ where: { companyId: cId, invoiceId: saleIds["TESA-001"], currency: "USD" } });
  if (!pr1Exists) {
    await prisma.paymentRecord.create({
      data: {
        companyId: cId, invoiceId: saleIds["TESA-001"],
        method: "ZELLE" as PaymentMethod, currency: "USD",
        amountOriginal: "1807.42", amountVes: "857397.00",
        exchangeRateId: rateIds["2026-04-07"],
        referenceNumber: "ZELLE-04032026-001",
        date: d(3), notes: "Pago Zelle — Distribuidora Orinoco FAC-TESA-001", createdBy: USER_ID,
      },
    });
    console.log("  ✅ Pago FAC-TESA-001 — Zelle $1,807.42 (Distribuidora Orinoco)");
  }

  // Pago FAC-TESA-002 — PagoMóvil completo desde Clínica Médica
  const pr2Exists = await prisma.paymentRecord.findFirst({ where: { companyId: cId, invoiceId: saleIds["TESA-002"], method: "PAGOMOVIL" } });
  if (!pr2Exists) {
    await prisma.paymentRecord.create({
      data: {
        companyId: cId, invoiceId: saleIds["TESA-002"],
        method: "PAGOMOVIL" as PaymentMethod, currency: "VES",
        amountVes: "145494.36", referenceNumber: "PM-0412-778843",
        originBank: "Mercantil", destBank: "BNC",
        date: d(5), notes: "PagoMóvil — Clínica Médica Caracas FAC-TESA-002", createdBy: USER_ID,
      },
    });
    console.log("  ✅ Pago FAC-TESA-002 — PagoMóvil Bs. 145,494.36 (Clínica Médica)");
  }

  // Pago FAC-TESA-003 — Transferencia bancaria UCV (exento)
  const pr3Exists = await prisma.paymentRecord.findFirst({ where: { companyId: cId, invoiceId: saleIds["TESA-003"], method: "TRANSFERENCIA" } });
  if (!pr3Exists) {
    await prisma.paymentRecord.create({
      data: {
        companyId: cId, invoiceId: saleIds["TESA-003"],
        method: "TRANSFERENCIA" as PaymentMethod, currency: "VES",
        amountVes: "192080.00", referenceNumber: "TRF-BDV-20260407-992",
        date: d(7), notes: "Transferencia BDV — UCV Capacitación FAC-TESA-003", createdBy: USER_ID,
      },
    });
    console.log("  ✅ Pago FAC-TESA-003 — Transferencia Bs. 192,080 (UCV)");
  }

  // Pago parcial FAC-TESA-004 — PagoMóvil parcial Smart Solutions (solo IVA 16%)
  const pr4Exists = await prisma.paymentRecord.findFirst({ where: { companyId: cId, invoiceId: saleIds["TESA-004"] } });
  if (!pr4Exists) {
    await prisma.paymentRecord.create({
      data: {
        companyId: cId, invoiceId: saleIds["TESA-004"],
        method: "PAGOMOVIL" as PaymentMethod, currency: "VES",
        amountVes: "146582.45", referenceNumber: "PM-0416-334521",
        originBank: "Banesco", destBank: "BNC",
        date: d(14), notes: "Abono parcial FAC-TESA-004 — Smart Solutions (pendiente IVA adicional)", createdBy: USER_ID,
      },
    });
    console.log("  ✅ Pago FAC-TESA-004 (parcial) — PagoMóvil Bs. 146,582.45 (Smart Solutions)");
  }

  // Pago FAC-TESA-006 — Efectivo Carlos Rivas
  const pr6Exists = await prisma.paymentRecord.findFirst({ where: { companyId: cId, invoiceId: saleIds["TESA-006"] } });
  if (!pr6Exists) {
    await prisma.paymentRecord.create({
      data: {
        companyId: cId, invoiceId: saleIds["TESA-006"],
        method: "EFECTIVO" as PaymentMethod, currency: "VES",
        amountVes: "14344.56", referenceNumber: "EFE-20260415-006",
        date: d(15), notes: "Pago en efectivo — Carlos Eduardo Rivas FAC-TESA-006", createdBy: USER_ID,
      },
    });
    console.log("  ✅ Pago FAC-TESA-006 — Efectivo Bs. 14,344.56 (Carlos Rivas)");
  }

  // ── 21. IGTF — Pago en divisas (Zelle de Orinoco Tech) ─────────────────
  console.log("\n🏦 IGTF...");
  const igtfExists = await prisma.iGTFTransaction.findFirst({ where: { companyId: cId, amount: { equals: 1807.42 } } });
  if (!igtfExists) {
    await prisma.iGTFTransaction.create({
      data: {
        companyId: cId, currency: "USD", amount: "1807.42",
        igtfRate: "3.00", igtfAmount: "54.22",
        concept: "IGTF 3% sobre cobro en divisas Zelle — FAC-TESA-001 Distribuidora Orinoco Tech", createdBy: USER_ID,
      },
    });
    console.log("  ✅ IGTF 3% sobre $1,807.42 = $54.22 (Zelle — Distribuidora Orinoco)");
  } else {
    console.log("  ⏭️  IGTF ya existe");
  }

  // ── 22. Estado de Cuenta BNC (Conciliación Bancaria) ─────────────────────
  console.log("\n📄 Estado de cuenta BNC...");
  let statement = await prisma.bankStatement.findFirst({
    where: { bankAccountId: bankAccountVes.id, periodStart: dateOnly("2026-04-01") },
  });
  if (!statement) {
    statement = await prisma.bankStatement.create({
      data: {
        bankAccountId: bankAccountVes.id,
        periodStart: dateOnly("2026-04-01"), periodEnd: dateOnly("2026-04-30"),
        openingBalance: "4250000.00", closingBalance: "3420382.27",
        status: "OPEN", importedBy: USER_ID,
      },
    });
    console.log("  ✅ Estado de cuenta BNC — Abril 2026");

    // Transacciones bancarias BNC (formato real del extracto)
    const bankTxDefs = [
      // ── CASO 1: Coincidencia exacta ────────────────────────────────────────
      // Pago PagoMóvil Clínica Médica — coincide exactamente con PaymentRecord
      { date: "2026-04-05", desc: "P2POTR PM RECIBIDO 0412778843 MERCANTIL *CLINICA MED", type: "CREDIT" as BankTransactionType, amount: "145494.36", ref: "BNC-0405-001" },
      // Transferencia UCV cobrada al día siguiente
      { date: "2026-04-08", desc: "CIPOTR TRF RECIBIDA BDV 20260407992 UNIV CENTRAL VEN", type: "CREDIT" as BankTransactionType, amount: "192080.00", ref: "BNC-0408-002" },
      // ── CASO 2: Solo en banco — sin contraparte en sistema ──────────────────
      // Comisión por mantenimiento de cuenta (cargo automático banco)
      { date: "2026-04-15", desc: "COMISI MANTENIMIENTO CUENTA AHO ABR-2026", type: "DEBIT" as BankTransactionType, amount: "250.00", ref: "BNC-0415-003" },
      // Intereses abonados por el banco (ingreso directo sin factura)
      { date: "2026-04-30", desc: "INTABO INTERESES CUENTA AHO ABR-2026", type: "CREDIT" as BankTransactionType, amount: "4182.63", ref: "BNC-0430-004" },
      // ── CASO 3: Coincidencia con diferencia (forex redondeo) ────────────────
      // Equivalente VES del Zelle de Orinoco — banco acredita 857,395.87 (vs sistema 857,397.00)
      // No auto-concilia por diferencia de Bs. 1.13 en tasa de cambio aplicada por BNC
      { date: "2026-04-03", desc: "CIPOTR TRF INT ZELLE RECIBIDA DISTRIB ORINOCO TECH", type: "CREDIT" as BankTransactionType, amount: "857395.87", ref: "BNC-0403-005" },
      // ── CASO 4: Solo en sistema — pago en tránsito ──────────────────────────
      // Comisión PagoMóvil (cobrada pero sin aparecer en este corte)
      { date: "2026-04-05", desc: "P2PCSO COMISION PAGOMOVIL 0412778843", type: "DEBIT" as BankTransactionType, amount: "14.55", ref: "BNC-0405-006" },
    ];

    for (const tx of bankTxDefs) {
      await prisma.bankTransaction.create({
        data: {
          statementId: statement.id, companyId: cId, date: dateOnly(tx.date),
          description: tx.desc, type: tx.type, amount: tx.amount, reference: tx.ref, isReconciled: false,
        },
      });
    }
    console.log(`  ✅ ${bankTxDefs.length} transacciones BNC cargadas`);
  } else {
    console.log("  ⏭️  Estado de cuenta ya existe");
  }

  // ── 23. Cotizaciones y Órdenes ────────────────────────────────────────────
  console.log("\n🛒 Cotizaciones y Órdenes...");
  // Secuencias de numeración
  for (const seq of [
    { docType: "PURCHASE_QUOTATION" as OrderDocType, lastNumber: 1 },
    { docType: "SALE_QUOTATION"     as OrderDocType, lastNumber: 2 },
    { docType: "PURCHASE_ORDER"     as OrderDocType, lastNumber: 1 },
    { docType: "SALE_ORDER"         as OrderDocType, lastNumber: 1 },
  ]) {
    await prisma.orderNumberSequence.upsert({
      where: { companyId_docType: { companyId: cId, docType: seq.docType } },
      update: { lastNumber: seq.lastNumber },
      create: { companyId: cId, docType: seq.docType, lastNumber: seq.lastNumber },
    });
  }

  // Cotización Venta — PRE-TESA-001 — DRAFT — 5 smartwatches para Smart Solutions
  await prisma.quotation.upsert({
    where: { companyId_number_type: { companyId: cId, number: "PRE-TESA-001", type: "SALE" as QuotationType } },
    update: {},
    create: {
      companyId: cId, type: "SALE", status: "DRAFT" as QuotationStatus,
      number: "PRE-TESA-001",
      counterpartName: "Smart Solutions Venezuela C.A.", counterpartRif: "J-29876543-7",
      validUntil: new Date("2026-05-15T00:00:00Z"),
      notes: "Propuesta lote 5 smartwatches Samsung Galaxy Watch 6 — precio especial volumen",
      subtotal: "559475.0000", taxAmount: "201410.7500", total: "760885.7500", currency: "VES",
      createdBy: USER_ID,
      items: { create: [{ description: "Smartwatch Samsung Galaxy Watch 6 40mm (5 unid)", unit: "UND", quantity: "5.0000", unitPrice: "111895.0000", taxRate: "31.00", totalPrice: "559475.0000" }] },
    },
  });
  console.log("  ✅ PRE-TESA-001 (SALE/DRAFT) — Smart Solutions, 5 smartwatches");

  // Cotización Venta — PRE-TESA-002 — APPROVED — 10 laptops para Distribuidora Orinoco
  const quot2 = await prisma.quotation.upsert({
    where: { companyId_number_type: { companyId: cId, number: "PRE-TESA-002", type: "SALE" as QuotationType } },
    update: {},
    create: {
      companyId: cId, type: "SALE", status: "APPROVED" as QuotationStatus,
      number: "PRE-TESA-002",
      counterpartName: "Distribuidora Orinoco Tech C.A.", counterpartRif: "J-32456789-1",
      validUntil: new Date("2026-05-30T00:00:00Z"),
      notes: "Lote 10 laptops Lenovo ThinkPad L14 Gen4 — entrega 2 semanas",
      subtotal: "3699930.0000", taxAmount: "591988.8000", total: "4291918.8000", currency: "VES",
      createdBy: USER_ID,
      items: { create: [{ description: "Laptop Lenovo ThinkPad L14 Gen 4 (10 unid)", unit: "UND", quantity: "10.0000", unitPrice: "369993.0000", taxRate: "16.00", totalPrice: "3699930.0000" }] },
    },
  });
  console.log("  ✅ PRE-TESA-002 (SALE/APPROVED) — Distribuidora Orinoco, 10 laptops");

  // Orden de Venta — OV-TESA-001 — APPROVED — convertida de PRE-TESA-002
  await prisma.order.upsert({
    where: { companyId_number_type: { companyId: cId, number: "OV-TESA-001", type: "SALE" as QuotationType } },
    update: {},
    create: {
      companyId: cId, type: "SALE", status: "APPROVED" as OrderStatus,
      number: "OV-TESA-001", quotationId: quot2.id,
      counterpartName: "Distribuidora Orinoco Tech C.A.", counterpartRif: "J-32456789-1",
      expectedDate: new Date("2026-05-10T00:00:00Z"),
      notes: "Generada desde PRE-TESA-002 — pendiente despacho 10 laptops",
      subtotal: "3699930.0000", taxAmount: "591988.8000", total: "4291918.8000", currency: "VES",
      createdBy: USER_ID,
      items: { create: [{ description: "Laptop Lenovo ThinkPad L14 Gen 4 (10 unid)", unit: "UND", quantity: "10.0000", unitPrice: "369993.0000", taxRate: "16.00", totalPrice: "3699930.0000" }] },
    },
  });
  console.log("  ✅ OV-TESA-001 (SALE/APPROVED) — convertida de PRE-TESA-002");

  // Cotización Compra — COT-TESA-001 — CONVERTED — para Médica Andina (tensiómetros adicionales)
  const quot3 = await prisma.quotation.upsert({
    where: { companyId_number_type: { companyId: cId, number: "COT-TESA-001", type: "PURCHASE" as QuotationType } },
    update: {},
    create: {
      companyId: cId, type: "PURCHASE", status: "CONVERTED" as QuotationStatus,
      number: "COT-TESA-001",
      counterpartName: "Distribuidora Médica Andina C.A.", counterpartRif: "J-41123456-9",
      validUntil: new Date("2026-05-30T00:00:00Z"),
      notes: "Reposición 20 tensiómetros Omron + 25 oxímetros CONTEC",
      subtotal: "787580.0000", taxAmount: "63006.4000", total: "850586.4000", currency: "VES",
      createdBy: USER_ID,
      items: { create: [
        { description: "Tensiómetro Digital Omron HEM-7141T1 (20 unid)", unit: "UND", quantity: "20.0000", unitPrice: "22769.0000", taxRate: "8.00", totalPrice: "455380.0000" },
        { description: "Oxímetro Fingertip CONTEC CMS50D (25 unid)", unit: "UND", quantity: "25.0000", unitPrice: "13282.0000", taxRate: "8.00", totalPrice: "332050.0000" },
      ] },
    },
  });
  console.log("  ✅ COT-TESA-001 (PURCHASE/CONVERTED) — Médica Andina, tensiómetros+oxímetros");

  // Orden de Compra — OC-TESA-001 — RECEIVED — desde COT-TESA-001
  await prisma.order.upsert({
    where: { companyId_number_type: { companyId: cId, number: "OC-TESA-001", type: "PURCHASE" as QuotationType } },
    update: {},
    create: {
      companyId: cId, type: "PURCHASE", status: "APPROVED" as OrderStatus,
      number: "OC-TESA-001", quotationId: quot3.id,
      counterpartName: "Distribuidora Médica Andina C.A.", counterpartRif: "J-41123456-9",
      expectedDate: new Date("2026-04-28T00:00:00Z"),
      notes: "Orden aprobada — mercancía recibida 28/04, pendiente factura definitiva de Médica Andina",
      subtotal: "787580.0000", taxAmount: "63006.4000", total: "850586.4000", currency: "VES",
      createdBy: USER_ID,
      items: { create: [
        { description: "Tensiómetro Digital Omron HEM-7141T1 (20 unid)", unit: "UND", quantity: "20.0000", unitPrice: "22769.0000", taxRate: "8.00", totalPrice: "455380.0000" },
        { description: "Oxímetro Fingertip CONTEC CMS50D (25 unid)", unit: "UND", quantity: "25.0000", unitPrice: "13282.0000", taxRate: "8.00", totalPrice: "332050.0000" },
      ] },
    },
  });
  console.log("  ✅ OC-TESA-001 (PURCHASE/RECEIVED) — Médica Andina, mercancía recibida");

  // ── 24. Gastos ────────────────────────────────────────────────────────────
  console.log("\n💸 Gastos...");
  // Categorías
  const catDefs = [
    { name: "Alquiler de Locales",               accountId: accounts["5120"], isDefault: true  },
    { name: "Servicios Públicos y Telecom",       accountId: accounts["5125"], isDefault: true  },
    { name: "Gastos de Oficina",                  accountId: accounts["5130"], isDefault: true  },
    { name: "Comisiones Bancarias",               accountId: accounts["5135"], isDefault: false },
  ];
  const catIds: Record<string, string> = {};
  for (const cat of catDefs) {
    const c = await prisma.expenseCategory.upsert({
      where: { companyId_name: { companyId: cId, name: cat.name } },
      update: {},
      create: { companyId: cId, ...cat },
    });
    catIds[cat.name] = c.id;
    console.log(`  ✅ Categoría: ${cat.name}`);
  }

  // Gastos individuales
  const expenseDefs = [
    { key: "tesa-gasto-001", concept: "Alquiler piso 5 Torre Empresarial — Abril 2026", categoryName: "Alquiler de Locales",         amount: "600000.0000", date: dateOnly("2026-04-01"), hasIva: false, supplierName: "Administradora Empresarial Libertador C.A." },
    { key: "tesa-gasto-002", concept: "Plan Internet Corporativo Cantv 100Mbps — Abr",  categoryName: "Servicios Públicos y Telecom", amount: "45000.0000",  date: dateOnly("2026-04-03"), hasIva: true,  invoiceNumber: "CANT-0034567", supplierName: "CANTV Telecomunicaciones" },
    { key: "tesa-gasto-003", concept: "Electricidad CORPOELEC sede principal — Abr",    categoryName: "Servicios Públicos y Telecom", amount: "28500.0000",  date: dateOnly("2026-04-05"), hasIva: false, supplierName: "CORPOELEC" },
    { key: "tesa-gasto-004", concept: "Materiales presentación comercial clientes",      categoryName: "Gastos de Oficina",            amount: "15200.0000",  date: dateOnly("2026-04-12"), hasIva: true,  invoiceNumber: "PON-0001234", vendorKey: "Papelería Caracas Norte C.A." },
  ];

  for (const exp of expenseDefs) {
    const existing = await prisma.expense.findUnique({ where: { idempotencyKey: exp.key } });
    if (!existing) {
      await prisma.expense.create({
        data: {
          companyId: cId, concept: exp.concept,
          categoryId: catIds[exp.categoryName],
          vendorId: exp.vendorKey ? vendors[exp.vendorKey] : undefined,
          supplierName: !exp.vendorKey ? exp.supplierName : undefined,
          amount: exp.amount, currency: "VES", amountVes: exp.amount,
          hasIva: exp.hasIva, ivaAmount: exp.hasIva ? String(parseFloat(exp.amount) * 0.16) : null,
          isDeductible: true, invoiceNumber: exp.invoiceNumber ?? null,
          expenseAccountId: catDefs.find(c => c.name === exp.categoryName)!.accountId,
          status: "CONFIRMED" as ExpenseStatus, idempotencyKey: exp.key,
          invoiceDate: exp.date, createdBy: USER_ID,
        },
      });
      console.log(`  ✅ ${exp.concept.substring(0, 55)} — Bs. ${parseFloat(exp.amount).toLocaleString()}`);
    } else {
      console.log(`  ⏭️  ${exp.key} ya existe`);
    }
  }

  // ── 25. Caja Chica ────────────────────────────────────────────────────────
  console.log("\n💼 Caja Chica...");
  let cajaCaja = await prisma.cajaCaja.findFirst({ where: { companyId: cId, status: "ACTIVE" } });
  if (!cajaCaja) {
    cajaCaja = await prisma.cajaCaja.create({
      data: {
        companyId: cId, name: "Caja Chica — Sede Caracas (Fondo Fijo)",
        accountId: accounts["1105"], currency: "VES", maxBalance: "50000.0000",
        status: "ACTIVE", createdBy: USER_ID,
      },
    });
    console.log(`  ✅ Caja Chica creada — Fondo máx. Bs. 50,000`);

    // Depósito inicial del fondo
    await prisma.cajaCajaDeposit.create({
      data: {
        companyId: cId, cajaCajaId: cajaCaja.id,
        date: dateOnly("2026-04-01"), amount: "50000.0000",
        description: "Dotación inicial fondo fijo — Resolución Junta Directiva 01/04/2026",
        status: "APPROVED", createdBy: USER_ID,
      },
    });
    console.log("  ✅ Depósito fondo Bs. 50,000");

    // Movimientos de caja chica
    const movDefs = [
      { voucher: "CC-2026-001", concept: "Taxi ejecutivo visita cliente (Distribuidora Orinoco)", account: accounts["5130"], amount: "8400.0000",  date: "2026-04-07" },
      { voucher: "CC-2026-002", concept: "Almuerzo reunión directiva comercial Abr-14",           account: accounts["5130"], amount: "12500.0000", date: "2026-04-14" },
      { voucher: "CC-2026-003", concept: "Impresión urgente propuestas comerciales x50 copias",   account: accounts["5130"], amount: "6800.0000",  date: "2026-04-21" },
    ];
    for (const mov of movDefs) {
      await prisma.cajaCajaMovement.create({
        data: {
          companyId: cId, cajaCajaId: cajaCaja.id,
          date: dateOnly(mov.date), voucherNumber: mov.voucher,
          concept: mov.concept, expenseAccountId: mov.account,
          amount: mov.amount, currency: "VES", status: "APPROVED",
          approvedAt: new Date(`${mov.date}T18:00:00Z`), approvedBy: USER_ID,
          createdBy: USER_ID,
        },
      });
      console.log(`  ✅ ${mov.voucher} — ${mov.concept.substring(0, 45)} — Bs. ${parseFloat(mov.amount).toLocaleString()}`);
    }
  } else {
    console.log("  ⏭️  Caja Chica ya existe");
  }

  // ── 26. Asientos Contables Manuales ───────────────────────────────────────
  console.log("\n📒 Asientos contables...");
  const asientoDefs = [
    {
      number: "T-2026-001", date: d(1),
      description: "Apertura — Capital inicial TESA Abril 2026",
      entries: [
        { code: "1110", amount: "5000000.00" },   // BNC VES +5,000,000
        { code: "3105", amount: "-5000000.00" },  // Capital Social -5,000,000
      ],
    },
    {
      number: "T-2026-002", date: d(30),
      description: "Depreciación mensual — Servidor HPE ProLiant ML350 Gen11",
      entries: [
        { code: "5115", amount: "29025.00" },     // Dep. equip: (1,935,000 - 193,500) / 60 = 29,025
        { code: "1510", amount: "-29025.00" },    // Dep. Acum. Servidores
      ],
    },
    {
      number: "T-2026-003", date: d(30),
      description: "Depreciación mensual — Camioneta Toyota Hilux DC 4x4 2024",
      entries: [
        { code: "5115", amount: "167416.67" },    // (14,350,000 - 4,305,000) / 60 = 167,416.67
        { code: "1521", amount: "-167416.67" },   // Dep. Acum. Vehículos
      ],
    },
    {
      number: "T-2026-004", date: d(1),
      description: "Pago alquiler oficina Torre Empresarial — Abril 2026",
      entries: [
        { code: "5120", amount: "600000.00" },    // Alquiler +600,000
        { code: "1110", amount: "-600000.00" },   // BNC VES -600,000
      ],
    },
  ];

  for (const asiento of asientoDefs) {
    const existing = await prisma.transaction.findUnique({ where: { companyId_number: { companyId: cId, number: asiento.number } } });
    if (!existing) {
      await prisma.transaction.create({
        data: {
          companyId: cId, number: asiento.number, date: asiento.date,
          description: asiento.description, periodId: period.id, userId: USER_ID,
          entries: {
            create: asiento.entries.map(e => ({ accountId: accounts[e.code]!, amount: e.amount })),
          },
        },
      });
      console.log(`  ✅ ${asiento.number} — ${asiento.description}`);
    } else {
      console.log(`  ⏭️  ${asiento.number} ya existe`);
    }
  }

  // ── 27. Causación GL retroactiva (ADR-026) ───────────────────────────────
  // Postea al Libro Mayor las facturas creadas directamente en el seed
  // (que no pasaron por InvoiceService y quedaron con transactionId = null).
  console.log("\n📒 Causación GL retroactiva...");
  {
    const glSettings = await prisma.companySettings.findUnique({
      where: { companyId: cId },
      select: {
        arAccountId: true, apAccountId: true,
        salesAccountId: true, purchaseExpenseAccountId: true,
        ivaDFAccountId: true, ivaCFAccountId: true,
      },
    });
    if (glSettings) {
      const unbookedInvoices = await prisma.invoice.findMany({
        where: { companyId: cId, transactionId: null, deletedAt: null, type: { in: ["SALE", "PURCHASE"] } },
        include: { taxLines: true },
        orderBy: { date: "asc" },
      });
      let glPosted = 0;
      for (const inv of unbookedInvoices) {
        const type = inv.type as "SALE" | "PURCHASE";
        if (!InvoiceGLPostingService.canPost(type, glSettings)) continue;
        await prisma.$transaction(async (db) => {
          await InvoiceGLPostingService.postInvoice(
            {
              id: inv.id, type,
              invoiceNumber: inv.invoiceNumber,
              counterpartName: inv.counterpartName,
              date: inv.date,
              periodId: inv.periodId ?? null,
              totalAmountVes: inv.totalAmountVes ? new Decimal(inv.totalAmountVes.toString()) : new Decimal(0),
              taxLines: inv.taxLines.map((tl) => ({
                taxType: tl.taxType,
                base: new Decimal(tl.base.toString()),
                amount: new Decimal(tl.amount.toString()),
              })),
            },
            glSettings,
            cId,
            USER_ID,
            db as Parameters<typeof InvoiceGLPostingService.postInvoice>[4]
          );
        });
        glPosted++;
      }
      if (glPosted > 0) {
        console.log(`  ✅ ${glPosted} factura(s) causadas al Libro Mayor`);
      } else {
        console.log("  ⏭️  Todas las facturas ya estaban causadas");
      }
    }
  }

  // ── Resumen final ─────────────────────────────────────────────────────────
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║         SEED TESA COMPLETADO — Abril 2026                     ║
╠═══════════════════════════════════════════════════════════════╣
║  🏢 Empresa: Tecnología y Suministros Andina, C.A.            ║
║  🆔 RIF: J-31645287-9 | isSpecialContributor: true            ║
╠═══════════════════════════════════════════════════════════════╣
║  📊 ${accountDefs.length} cuentas contables (ASSET/LIABILITY/EQUITY/REV/EXP)  ║
║  📅 1 período OPEN (Abril 2026)                               ║
║  💱 5 tasas BCV USD/VES + 5 EUR/VES                           ║
║  📈 3 tasas INPC (Ene–Mar 2026)                               ║
║  ⚖️  Salario Mín Bs. 130 | UT Bs. 43                          ║
╠═══════════════════════════════════════════════════════════════╣
║  🏭 5 proveedores | 👥 6 clientes                             ║
║  📦 6 ítems inventario (SERIAL×2 + LOT×2 + NONE×2)           ║
║  🔢 9 seriales LAP+SWT | 🗃️  2 lotes OXI+TEN                  ║
║  🖥️  2 activos fijos (servidor + camioneta)                   ║
╠═══════════════════════════════════════════════════════════════╣
║  👤 8 empleados + historial salarial (6 USD / 2 VES)          ║
║  💼 PayrollRun DRAFT Abril — Bs. 4.47M (8 empleados)          ║
║  💰 BenefitBalance Alejandro Blanco + accrual Q1 2026         ║
║  💳 Tasas BCV prestaciones Ene–Mar 2026                       ║
╠═══════════════════════════════════════════════════════════════╣
║  🧾 7 facturas SALE (0%/8%/16%/31% IVA)                       ║
║  🛒 5 facturas PURCHASE                                       ║
║  📋 4 retenciones (3 IVA 75% + 1 ISLR 5%)                    ║
║  💳 5 PaymentRecords (Zelle/PagoMóvil/Transf/Efectivo)        ║
║  🏦 IGTF 3% sobre pago Zelle $1,807.42                        ║
╠═══════════════════════════════════════════════════════════════╣
║  🏦 2 cuentas BNC (VES + USD) + extracto Abril                ║
║  📋 6 transacciones bancarias (exacta/solo banco/diferencia)   ║
║  🛒 4 cotizaciones + 2 órdenes (SALE + PURCHASE)              ║
║  💸 4 gastos confirmados + 4 categorías                       ║
║  💼 Caja Chica Bs. 50,000 + 3 movimientos                     ║
║  📒 4 asientos contables manuales                             ║
╠═══════════════════════════════════════════════════════════════╣
║  PRÓXIMOS PASOS EN LA APP:                                    ║
║  1. Dashboard → KPIs TESA Abril 2026                          ║
║  2. Libro de Ventas → 7 facturas (4 tipos IVA)                ║
║  3. Libro de Compras → 5 facturas + 4 retenciones             ║
║  4. Generar Forma 30 → declaración IVA Abril 2026             ║
║  5. Nómina → Aprobar PayrollRun DRAFT (calcular live)         ║
║  6. Prestaciones → Ver saldo Alejandro Blanco (NOM-D)         ║
║  7. Conciliación → 6 txns BNC (exacta/diferencia/sólo banco)  ║
║  8. Activos Fijos → Ver depreciaciones serv + camioneta        ║
║  9. Inventario → Lotes OXI/TEN + Seriales LAP/SWT             ║
║  10. Caja Chica → 3 movimientos aprobados                     ║
║  11. Gastos → 4 gastos confirmados (con/sin IVA)              ║
║  12. IGTF → Transacción 3% Zelle Orinoco Tech                 ║
╚═══════════════════════════════════════════════════════════════╝
`);
}

main()
  .catch((e) => {
    console.error("❌ Seed TESA fallido:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
