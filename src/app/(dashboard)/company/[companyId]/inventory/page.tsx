// src/app/(dashboard)/company/[companyId]/inventory/page.tsx
// Módulo de Inventario — vista diferenciada por rol:
//   ADMINISTRATIVE: registrar movimientos + ver lista de productos (cantidades físicas)
//   ACCOUNTANT:     valoración CPP + movimientos pendientes de contabilización
//   OWNER / ADMIN:  todo lo anterior

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { getInventoryItems, getDraftMovements } from "@/modules/inventory/services/InventoryOperationsService";
import { getInventoryValuation } from "@/modules/inventory/services/InventoryAccountingService";
import { InventoryReportService } from "@/modules/inventory/services/InventoryReportService";
import { ExchangeRateService } from "@/modules/exchange-rates/services/ExchangeRateService";
import { InventoryItemList, type InventoryItemRow } from "@/modules/inventory/components/InventoryItemList";
import { InventoryItemForm } from "@/modules/inventory/components/InventoryItemForm";
import { MovementForm } from "@/modules/inventory/components/MovementForm";
import { PendingMovementsList, type PendingMovement } from "@/modules/inventory/components/PendingMovementsList";
import { InventoryValuation } from "@/modules/inventory/components/InventoryValuation";
import { InventoryReportsView } from "@/modules/inventory/components/InventoryReportsView";

type Props = { params: Promise<{ companyId: string }> };

export default async function InventoryPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    include: { company: true },
  });
  if (!member) redirect("/");

  const role = member.role;
  const isOperations = canAccess(role, ROLES.OPERATIONS);   // OWNER, ADMIN, ADMINISTRATIVE
  const isAccounting = canAccess(role, ROLES.ACCOUNTING);   // OWNER, ADMIN, ACCOUNTANT
  const isAdminOnly = canAccess(role, ROLES.ADMIN_ONLY);    // OWNER, ADMIN

  // Carga de datos según rol — accounts incluye type para filtrar en formularios
  const [items, accounts] = await Promise.all([
    getInventoryItems(companyId),
    prisma.account.findMany({
      where: { companyId, deletedAt: null, type: { in: ["ASSET", "EXPENSE", "LIABILITY"] } },
      select: { id: true, code: true, name: true, type: true },
      orderBy: [{ code: "asc" }],
    }),
  ]);

  // Para ACCOUNTANT / OWNER / ADMIN: también cargar valoración, pendientes y reporte de stock
  const [valuation, pending, stockSummary, usdRate] = await Promise.all([
    isAccounting ? getInventoryValuation(companyId) : null,
    isAccounting ? getDraftMovements(companyId) : null,
    isAccounting ? InventoryReportService.getStockSummary(companyId) : null,
    ExchangeRateService.getLatestRate(companyId, "USD"),  // BCV rate para R-02
  ]);

  // Serializar Decimals → string para los componentes cliente
  const serializedItems: InventoryItemRow[] = items.map((item) => ({
    id: item.id,
    sku: item.sku,
    name: item.name,
    description: item.description,
    unit: item.baseUnitName,
    stockQuantity: item.stockQuantity.toString(),
    averageCost: item.averageCost.toString(),
    itemType: item.itemType,          // R-06: tipo para badge y bloqueo SERVICE
    minimumStock: item.minimumStock ? item.minimumStock.toString() : null,  // R-10
    accountId: item.accountId,
    cogsAccountId: item.cogsAccountId,
    accountCode: item.account?.code ?? null,
    accountName: item.account?.name ?? null,
  }));

  // R-06: pasar itemType al form de movimientos para bloqueo SERVICE
  const itemsForMovement = serializedItems.map((i) => ({
    id: i.id,
    sku: i.sku,
    name: i.name,
    unit: i.unit,
    stockQuantity: i.stockQuantity,
    averageCost: i.averageCost,
    itemType: i.itemType,
  }));

  const serializedPending: PendingMovement[] = (pending ?? []).map((mov) => ({
    id: mov.id,
    type: mov.type,
    quantity: mov.quantity.toString(),
    unitCost: mov.unitCost.toString(),
    totalCost: mov.totalCost.toString(),
    date: mov.date.toISOString(),
    reference: mov.reference,
    notes: mov.notes,
    createdAt: mov.createdAt.toISOString(),
    item: {
      id: mov.item.id,
      sku: mov.item.sku,
      name: mov.item.name,
      unit: mov.item.baseUnitName,
      stockQuantity: mov.item.stockQuantity.toString(),
      averageCost: mov.item.averageCost.toString(),
      accountId: mov.item.accountId,
      cogsAccountId: mov.item.cogsAccountId,
      trackingType: mov.item.trackingType as "NONE" | "LOT" | "SERIAL",
    },
  }));

  // H-03: cuentas con type para que los formularios filtren por naturaleza contable
  const accountOptions = accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
  }));

  // R-04: cuentas contrapartida para MovementForm (LIABILITY + ASSET + EXPENSE)
  const counterpartAccounts = accountOptions;

  // R-02: tasa BCV actual para autocompletar en MovementForm
  const currentBcvRate = usdRate?.rate ? usdRate.rate.toString() : undefined;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Inventario</h1>
        <p className="mt-1 text-sm text-gray-500">
          {member.company.name} — Gestión de productos y movimientos físicos
        </p>
      </div>

      {/* ── Vista ACCOUNTANT: Valoración + Pendientes ─────────────────────────── */}
      {isAccounting && (
        <>
          {/* Valoración CPP */}
          <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-gray-800">
              Valoración del inventario
              <span className="ml-2 text-sm font-normal text-gray-500">
                (CPP — Costo Promedio Ponderado)
              </span>
            </h2>
            <InventoryValuation
              items={(valuation?.items ?? []).map((i) => ({
                id: i.id,
                sku: i.sku,
                name: i.name,
                unit: i.baseUnitName,
                trackingType: i.trackingType,
                stockQuantity: i.stockQuantity.toString(),
                averageCost: i.averageCost.toString(),
              }))}
              totalValue={valuation?.totalValue.toString() ?? "0"}
              usdRate={usdRate?.rate ?? undefined}
            />
          </section>

          {/* Movimientos pendientes de contabilización */}
          <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <h2 className="text-base font-semibold text-gray-800">
                Movimientos pendientes de contabilización
              </h2>
              {serializedPending.length > 0 && (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                  {serializedPending.length}
                </span>
              )}
            </div>
            <PendingMovementsList
              movements={serializedPending}
              companyId={companyId}
              canPost={isAccounting}
            />
          </section>
        </>
      )}

      {/* ── Vista ADMINISTRATIVE: Registrar movimientos ───────────────────────── */}
      {isOperations && (
        <>
          {/* Nuevo producto */}
          <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-gray-800">Agregar producto</h2>
            {/* H-03: accountOptions incluye type para filtrar ASSET/EXPENSE en el form */}
            <InventoryItemForm companyId={companyId} accounts={accountOptions} />
          </section>

          {/* Registrar movimiento */}
          <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-1 text-base font-semibold text-gray-800">
              Registrar movimiento
            </h2>
            <p className="mb-4 text-xs text-gray-500">
              Los movimientos quedan en <strong>Borrador</strong> hasta que el Contador los
              contabilice y genere el asiento automático.
            </p>
            {serializedItems.length === 0 ? (
              <p className="text-sm text-gray-500">
                Primero registra al menos un producto antes de registrar movimientos.
              </p>
            ) : (
              // R-02: currentBcvRate | R-04: counterpartAccounts | R-06: itemType en items
              <MovementForm
                companyId={companyId}
                items={itemsForMovement}
                counterpartAccounts={counterpartAccounts}
                currentBcvRate={currentBcvRate}
              />
            )}
          </section>
        </>
      )}

      {/* ── Catálogo de productos (todos los roles con acceso) ────────────────── */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-gray-800">
          Catálogo de productos
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({serializedItems.length})
          </span>
        </h2>
        {/* H-03: accountOptions con type para filtrar en InventoryItemForm inline */}
        <InventoryItemList
          items={serializedItems}
          companyId={companyId}
          accounts={accountOptions}
          canEdit={isOperations}
          canDelete={isAdminOnly}
          canManageUom={isAccounting}
        />
      </section>

      {/* ── Reportes — solo ACCOUNTANT / OWNER / ADMIN ───────────────────────── */}
      {isAccounting && stockSummary && (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-800">
            Reportes de inventario
          </h2>
          <InventoryReportsView
            companyId={companyId}
            initialStock={stockSummary}
            itemOptions={serializedItems.map((i) => ({
              id: i.id,
              sku: i.sku,
              name: i.name,
            }))}
          />
        </section>
      )}
    </div>
  );
}
