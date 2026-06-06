// src/app/(dashboard)/company/[companyId]/inventory/page.tsx
// Módulo de Inventario — navegación por pestañas (URL search params).
//
//  Tabs visibles según rol:
//    ADMINISTRATIVE:     Catálogo · Movimientos
//    ACCOUNTANT:         Catálogo · Movimientos · Valoración · Reportes
//    OWNER / ADMIN:      todos los tabs anteriores
//
//  Fetch selectivo: cada pestaña carga solo los datos que necesita.

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
import { SearchParamTabs } from "@/components/ui/SearchParamTabs";

type TabId = "catalogo" | "movimientos" | "valoracion" | "reportes";

type Props = {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ tab?: string }>;
};

export default async function InventoryPage({ params, searchParams }: Props) {
  const { companyId }   = await params;
  const { tab: tabParam } = await searchParams;

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    include: { company: true },
  });
  if (!member) redirect("/");

  const role        = member.role;
  const isOperations = canAccess(role, ROLES.OPERATIONS);  // OWNER, ADMIN, ADMINISTRATIVE
  const isAccounting = canAccess(role, ROLES.ACCOUNTING);  // OWNER, ADMIN, ACCOUNTANT
  const isAdminOnly  = canAccess(role, ROLES.ADMIN_ONLY);  // OWNER, ADMIN

  // Resolver pestaña válida para este rol
  function resolveTab(req: string | undefined): TabId {
    if (req === "movimientos")                  return "movimientos";
    if (req === "valoracion" && isAccounting)   return "valoracion";
    if (req === "reportes"   && isAccounting)   return "reportes";
    return "catalogo";
  }
  const currentTab = resolveTab(tabParam);

  // Badge ligero de pendientes — siempre (solo ACCOUNTING)
  const pendingCount = isAccounting
    ? await prisma.inventoryMovement.count({ where: { companyId, status: "DRAFT" } })
    : 0;

  // ── Fetch selectivo por pestaña ──────────────────────────────────────────────

  const needsItems    = currentTab === "catalogo" || currentTab === "movimientos" || currentTab === "reportes";
  const needsAccounts = currentTab === "catalogo" || currentTab === "movimientos";

  const [rawItems, accounts] = await Promise.all([
    needsItems
      ? getInventoryItems(companyId)
      : Promise.resolve([] as Awaited<ReturnType<typeof getInventoryItems>>),
    needsAccounts
      ? prisma.account.findMany({
          where: { companyId, deletedAt: null, type: { in: ["ASSET", "EXPENSE", "LIABILITY"] } },
          select: { id: true, code: true, name: true, type: true },
          orderBy: [{ code: "asc" }],
        })
      : Promise.resolve([] as { id: string; code: string; name: string; type: string }[]),
  ]);

  const [rawPending, usdRateMovimientos] =
    currentTab === "movimientos"
      ? await Promise.all([
          isAccounting ? getDraftMovements(companyId) : Promise.resolve([] as Awaited<ReturnType<typeof getDraftMovements>>),
          ExchangeRateService.getLatestRate(companyId, "USD"),
        ])
      : [[] as Awaited<ReturnType<typeof getDraftMovements>>, null];

  const [valuation, usdRateValoracion] =
    currentTab === "valoracion" && isAccounting
      ? await Promise.all([
          getInventoryValuation(companyId),
          ExchangeRateService.getLatestRate(companyId, "USD"),
        ])
      : [null, null];

  const stockSummary =
    currentTab === "reportes" && isAccounting
      ? await InventoryReportService.getStockSummary(companyId)
      : null;

  // ── Serializaciones ──────────────────────────────────────────────────────────

  const serializedItems: InventoryItemRow[] = rawItems.map((item) => ({
    id:             item.id,
    sku:            item.sku,
    name:           item.name,
    description:    item.description,
    unit:           item.baseUnitName,
    stockQuantity:  item.stockQuantity.toString(),
    averageCost:    item.averageCost.toString(),
    itemType:       item.itemType,
    defaultTaxRate: item.defaultTaxRate,
    minimumStock:   item.minimumStock ? item.minimumStock.toString() : null,
    accountId:      item.accountId,
    cogsAccountId:  item.cogsAccountId,
    accountCode:    item.account?.code ?? null,
    accountName:    item.account?.name ?? null,
  }));

  const itemsForMovement = serializedItems.map((i) => ({
    id: i.id, sku: i.sku, name: i.name, unit: i.unit,
    stockQuantity: i.stockQuantity, averageCost: i.averageCost, itemType: i.itemType,
  }));

  const serializedPending: PendingMovement[] = rawPending.map((mov) => ({
    id:        mov.id,
    type:      mov.type,
    quantity:  mov.quantity.toString(),
    unitCost:  mov.unitCost.toString(),
    totalCost: mov.totalCost.toString(),
    date:      mov.date.toISOString(),
    reference: mov.reference,
    notes:     mov.notes,
    createdAt: mov.createdAt.toISOString(),
    item: {
      id:            mov.item.id,
      sku:           mov.item.sku,
      name:          mov.item.name,
      unit:          mov.item.baseUnitName,
      stockQuantity: mov.item.stockQuantity.toString(),
      averageCost:   mov.item.averageCost.toString(),
      accountId:     mov.item.accountId,
      cogsAccountId: mov.item.cogsAccountId,
      trackingType:  mov.item.trackingType as "NONE" | "LOT" | "SERIAL",
    },
  }));

  const accountOptions = accounts.map((a) => ({
    id: a.id, code: a.code, name: a.name, type: a.type,
  }));

  const currentBcvRate = (usdRateMovimientos ?? usdRateValoracion)?.rate?.toString();

  // ── Definición de tabs ────────────────────────────────────────────────────────

  const tabs = [
    { value: "catalogo",   label: "Catálogo",           show: true },
    { value: "movimientos", label: "Movimientos",        badge: pendingCount, show: isOperations || isAccounting },
    { value: "valoracion", label: "Valoración CPP",      show: isAccounting },
    { value: "reportes",   label: "Reportes",            show: isAccounting },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Inventario</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {member.company.name} — Gestión de productos y movimientos físicos
        </p>
      </div>

      {/* Tabs de navegación */}
      <SearchParamTabs
        tabs={tabs}
        currentValue={currentTab}
        color="blue"
      />

      {/* ── Pestaña: Catálogo ──────────────────────────────────────────────────── */}
      {currentTab === "catalogo" && (
        <div className="space-y-6">
          {isOperations && (
            <section className="rounded-lg border bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-base font-semibold text-zinc-800">Agregar producto</h2>
              {/* H-03: accountOptions incluye type para filtrar ASSET/EXPENSE */}
              <InventoryItemForm companyId={companyId} accounts={accountOptions} />
            </section>
          )}

          <section className="rounded-lg border bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-zinc-800">
              Catálogo de productos
              <span className="ml-2 text-sm font-normal text-zinc-500">
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
        </div>
      )}

      {/* ── Pestaña: Movimientos ──────────────────────────────────────────────── */}
      {currentTab === "movimientos" && (
        <div className="space-y-6">
          {/* Registrar movimiento — OPERATIONS */}
          {isOperations && (
            <section className="rounded-lg border bg-white p-6 shadow-sm">
              <h2 className="mb-1 text-base font-semibold text-zinc-800">Registrar movimiento</h2>
              <p className="mb-4 text-xs text-zinc-500">
                Los movimientos quedan en <strong>Borrador</strong> hasta que el Contador los
                contabilice y genere el asiento automático.
              </p>
              {serializedItems.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  Primero registra al menos un producto en el Catálogo.
                </p>
              ) : (
                // R-02: currentBcvRate | R-04: counterpartAccounts | R-06: itemType
                <MovementForm
                  companyId={companyId}
                  items={itemsForMovement}
                  counterpartAccounts={accountOptions}
                  currentBcvRate={currentBcvRate}
                />
              )}
            </section>
          )}

          {/* Movimientos pendientes de contabilización — ACCOUNTING */}
          {isAccounting && (
            <section className="rounded-lg border bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center gap-3">
                <h2 className="text-base font-semibold text-zinc-800">
                  Pendientes de contabilización
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
          )}
        </div>
      )}

      {/* ── Pestaña: Valoración CPP ───────────────────────────────────────────── */}
      {currentTab === "valoracion" && isAccounting && (
        <section className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-zinc-800">
            Valoración del inventario
            <span className="ml-2 text-sm font-normal text-zinc-500">
              (CPP — Costo Promedio Ponderado)
            </span>
          </h2>
          <InventoryValuation
            items={(valuation?.items ?? []).map((i) => ({
              id:            i.id,
              sku:           i.sku,
              name:          i.name,
              unit:          i.baseUnitName,
              trackingType:  i.trackingType,
              stockQuantity: i.stockQuantity.toString(),
              averageCost:   i.averageCost.toString(),
            }))}
            totalValue={valuation?.totalValue.toString() ?? "0"}
            usdRate={usdRateValoracion?.rate ?? undefined}
          />
        </section>
      )}

      {/* ── Pestaña: Reportes ─────────────────────────────────────────────────── */}
      {currentTab === "reportes" && isAccounting && stockSummary && (
        <section className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-zinc-800">
            Reportes de inventario
          </h2>
          <InventoryReportsView
            companyId={companyId}
            initialStock={stockSummary}
            itemOptions={serializedItems.map((i) => ({
              id: i.id, sku: i.sku, name: i.name,
            }))}
          />
        </section>
      )}
    </div>
  );
}
