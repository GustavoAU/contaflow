// src/modules/cajachica/services/account-type.guard.ts
// HC-09 (ADR-036 D-3): guard de tipo de cuenta en el servidor.
// Defensa server-side — el filtro de UI es complemento, NO sustituto (ADR-006:
// nunca confiar en el cliente). Un POST directo a la action saltaría el filtro de UI.
import type { Prisma, AccountType } from "@prisma/client";

const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  ASSET: "Activo",
  CONTRA_ASSET: "Activo de contrapartida",
  LIABILITY: "Pasivo",
  EQUITY: "Patrimonio",
  REVENUE: "Ingreso",
  EXPENSE: "Gasto",
};

/**
 * Valida, dentro del $transaction, que la cuenta:
 *  - existe,
 *  - pertenece a la empresa (companyId — ADR-004 cross-tenant),
 *  - no está borrada (deletedAt = null),
 *  - es del tipo esperado.
 *
 * Lanza un Error con mensaje de negocio si falla. Retorna la cuenta (id + type)
 * para que el call site pueda reusarla sin re-consultar.
 *
 * @param tx     cliente transaccional de Prisma (consistencia con la mutación).
 * @param params accountId, companyId, expected (AccountType), label (texto de negocio).
 */
export async function assertAccountOfType(
  tx: Prisma.TransactionClient,
  params: { accountId: string; companyId: string; expected: AccountType; label: string },
): Promise<{ id: string; type: AccountType }> {
  const account = await tx.account.findFirst({
    where: { id: params.accountId, companyId: params.companyId, deletedAt: null },
    select: { id: true, type: true },
  });
  if (!account) {
    throw new Error(`${params.label}: cuenta no encontrada o no pertenece a esta empresa.`);
  }
  if (account.type !== params.expected) {
    throw new Error(
      `${params.label} debe ser de tipo ${ACCOUNT_TYPE_LABEL[params.expected]}.`,
    );
  }
  return account;
}
