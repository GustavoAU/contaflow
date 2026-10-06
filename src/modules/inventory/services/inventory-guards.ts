// src/modules/inventory/services/inventory-guards.ts
//
// Guardas de negocio compartidas por InventoryOperationsService (crea el borrador) e
// InventoryAccountingService (lo contabiliza). Viven en un archivo aparte porque los dos servicios
// tienen prohibido importarse entre sí, y para que cada regla exista en UN solo lugar (DRY): si el
// borrador y la contabilización validaran distinto, el usuario vería un DRAFT que nunca se puede
// contabilizar.

import type { AccountType, Prisma, PrismaClient } from "@prisma/client";
import { assertAccountsBelongToCompany } from "@/lib/account-guard";
import { notPostableMessage } from "@/lib/prisma-postable-account-gate";

// ─── Contrapartida de una ENTRADA sin factura (SPEC-007) ──────────────────────

export const MSG_ENTRADA_SIN_CONTRAPARTIDA =
  "La entrada de inventario requiere una cuenta de contrapartida: Banco o Caja si fue de contado, o Capital si es aporte de socios. Una compra a crédito se registra con su factura de compra.";
export const MSG_CONTRAPARTIDA_NO_EXISTE =
  "La cuenta de contrapartida no existe o no pertenece a esta empresa.";
export const MSG_CONTRAPARTIDA_ES_INVENTARIO =
  "La contrapartida no puede ser la misma cuenta de inventario del producto: el asiento quedaría Dr y Cr sobre la misma cuenta.";
export function contrapartidaExigeTerceroMessage(code: string, name: string): string {
  return `La cuenta ${code} — ${name} exige indicar un tercero (proveedor, socio, cliente o empleado) y las entradas de inventario sin factura todavía no lo registran. Para una compra a crédito, regístrela con su factura de compra; para una entrada sin factura elija Banco, Caja o Capital.`;
}
const MSG_CONTRAPARTIDA_TIPO_GENERICO =
  "El tipo de cuenta elegido no es válido como contrapartida de una entrada de inventario. Elija Banco, Caja o Capital.";

// PA-1 (contadora, 2026-10-04): la mercancía entra contra Activo (Banco o Caja, de contado), Pasivo
// (Cuentas por pagar), Patrimonio (Capital, aporte de socios) o Costo/Gasto. Lista PERMITIDA, no
// prohibida: un tipo de cuenta nuevo no puede colarse como contrapartida sin una decisión explícita.
const TIPOS_CONTRAPARTIDA_PERMITIDOS: ReadonlySet<AccountType> = new Set<AccountType>([
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "EXPENSE",
]);

const MSG_CONTRAPARTIDA_TIPO_RECHAZADO: Partial<Record<AccountType, string>> = {
  REVENUE:
    "Una cuenta de Ingresos no puede ser la contrapartida de una entrada de inventario. Elija Banco, Caja o Capital.",
  CONTRA_ASSET:
    "Una cuenta regularizadora (contra-activo) no puede ser la contrapartida de una entrada de inventario. Elija Banco, Caja o Capital.",
};

/**
 * Valida la contrapartida de una ENTRADA de inventario SIN factura y devuelve su id ya verificado.
 *
 * Reglas: es obligatoria (RN-1), pertenece a la empresa (RN-3, ADR-004), no está dada de baja, es
 * de detalle (una cuenta de título no admite movimientos), su tipo es Activo, Pasivo, Patrimonio o
 * Gasto (PA-1) y no es la propia cuenta de inventario del producto.
 *
 * Con factura NO se llama: la entrada se enlaza al asiento de la factura (RN-4).
 *
 * `db` es `tx` dentro de un `$transaction` (la validación y la escritura ven el mismo snapshot) o
 * `prisma` al crear el borrador. `inventoryAccountId` es la cuenta de inventario del producto; si
 * el producto aún no la tiene, la comparación se omite (contabilizar exige configurarla).
 */
export async function assertEntradaCounterpart(
  db: Pick<PrismaClient, "account"> | Prisma.TransactionClient,
  params: {
    companyId: string;
    accountId: string | null | undefined;
    inventoryAccountId: string | null | undefined;
  }
): Promise<string> {
  const { companyId, accountId, inventoryAccountId } = params;

  if (!accountId) throw new Error(MSG_ENTRADA_SIN_CONTRAPARTIDA);

  // Guard central de cuentas ajenas: una cuenta de otra empresa se rechaza con su mensaje estándar.
  await assertAccountsBelongToCompany(db, companyId, [accountId]);

  // Segunda defensa y única fuente del tipo: la consulta también va acotada por companyId, así que
  // nunca devuelve una cuenta ajena aunque el guard de arriba se omitiera o cambiara.
  const account = await db.account.findFirst({
    where: { id: accountId, companyId, deletedAt: null },
    select: {
      id: true,
      type: true,
      code: true,
      name: true,
      isPostable: true,
      requiresThirdParty: true,
    },
  });
  if (!account) throw new Error(MSG_CONTRAPARTIDA_NO_EXISTE);

  if (inventoryAccountId && account.id === inventoryAccountId) {
    throw new Error(MSG_CONTRAPARTIDA_ES_INVENTARIO);
  }

  if (!TIPOS_CONTRAPARTIDA_PERMITIDOS.has(account.type)) {
    throw new Error(
      MSG_CONTRAPARTIDA_TIPO_RECHAZADO[account.type] ?? MSG_CONTRAPARTIDA_TIPO_GENERICO
    );
  }

  // El gate de Prisma (prisma-postable-account-gate) ya rechazaría el asiento, pero recién al
  // contabilizar: aquí se avisa al crear el borrador, para no dejar un DRAFT imposible de contabilizar.
  if (account.isPostable === false) {
    throw new Error(notPostableMessage(account.code, account.name));
  }

  // ADR-054: una cuenta con `requiresThirdParty` (Cuentas por pagar a proveedores, por ejemplo)
  // exige el tercero en cada línea del asiento, y el movimiento de inventario no lo registra. El
  // gate de Prisma (prisma-tercero-required-gate) lo rechazaría recién al contabilizar, sin que el
  // contador pudiera arreglarlo: se corta aquí, antes de dejar un borrador imposible de contabilizar.
  // Una compra a crédito se registra con su factura de compra (que lleva al proveedor).
  if (account.requiresThirdParty) {
    throw new Error(contrapartidaExigeTerceroMessage(account.code, account.name));
  }

  return account.id;
}

// ─── Período contable (R-3, R-09, PA-7) ───────────────────────────────────────

/**
 * Rechaza el movimiento si el período contable de su fecha está CERRADO. Se usa al crear el
 * borrador y otra vez al contabilizarlo: un borrador creado con el período abierto puede
 * contabilizarse después de cerrarlo.
 */
export async function assertMovementPeriodOpen(
  db: Pick<PrismaClient, "accountingPeriod"> | Prisma.TransactionClient,
  companyId: string,
  date: Date
): Promise<void> {
  // Fecha de NEGOCIO: getters UTC — resuelve el período contable (R-3).
  const closedPeriod = await db.accountingPeriod.findFirst({
    where: {
      companyId,
      status: "CLOSED",
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1, // getUTCMonth() es 0-based
    },
    select: { year: true, month: true },
  });
  if (closedPeriod) {
    throw new Error(
      `No se pueden registrar movimientos en el período ${String(closedPeriod.month).padStart(2, "0")}/${closedPeriod.year} porque está CERRADO. Use una fecha en el período activo.`
    );
  }
}
