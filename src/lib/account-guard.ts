// src/lib/account-guard.ts
//
// Ningún campo `*AccountId` de configuración (PayrollConfig, CompanySettings,
// Company, FixedAsset, InventoryItem, ExpenseCategory...) verificaba que la
// cuenta perteneciera a la empresa antes de guardarla. La relación Prisma
// (`Account? @relation(fields: [xAccountId], references: [id])`) sólo
// garantiza que el id EXISTA en `Account` — no que sea DE ESTA empresa.
//
// Un ADMIN que arme el payload a mano (saltándose el `<select>` que sí filtra
// por companyId al listar cuentas en la UI) podía persistir el id de una
// cuenta de OTRA empresa. Hallazgo MEDIUM del security-agent, 2026-09-05
// (auditoría de `feat/nomina-pension-especial`): patrón preexistente en ~41
// campos de ~20 modelos, mapeado exhaustivamente y corregido de una vez
// (regla del proyecto: "bug encontrado = clase de bug").
//
// Dos tablas distintas necesitan el mismo guard: `Account` (plan de cuentas
// contable) y `BankAccount` (cuentas bancarias, un modelo separado — algunos
// campos se llaman "bankAccountId" pero SÍ apuntan a `Account`, ver
// RetentionService; verificar el modelo real antes de elegir la función).
//
// ADR-004: la RLS es fail-OPEN y no cubre esto — el aislamiento es 100%
// aplicativo. Este guard es la aplicación.

import type { Prisma, PrismaClient } from "@prisma/client";

// Los delegados reales de Prisma (AccountDelegate/BankAccountDelegate) tienen
// firmas de `findMany` incompatibles entre sí en el tipo del argumento; este
// helper solo necesita `where.id.in`/`where.companyId`/`select.id`, que ambos
// aceptan.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Delegate = { findMany: (args: any) => Promise<Array<{ id: string }>> };

async function assertBelongToCompany(
  delegate: Delegate,
  companyId: string,
  candidates: Array<string | null | undefined>,
  mensajeUno: string,
  mensajeVarios: string,
): Promise<void> {
  const ids = [...new Set(candidates.filter((id): id is string => !!id))];
  if (ids.length === 0) return;

  const found = await delegate.findMany({
    where: { id: { in: ids }, companyId },
    select: { id: true },
  });
  if (found.length === ids.length) return;

  const foundIds = new Set(found.map((a) => a.id));
  const faltantes = ids.filter((id) => !foundIds.has(id));
  throw new Error(faltantes.length === 1 ? mensajeUno : mensajeVarios);
}

/**
 * Verifica que TODOS los `accountId` no nulos de `candidates` (contra el plan
 * de cuentas, `Account`) pertenezcan a `companyId`. Lanza un error de negocio
 * (mensaje en español, pasa tal cual por `mapPrismaError`) si alguno no existe
 * o es de otra empresa. No hace nada si `candidates` no trae ningún id (todos
 * null/undefined) — un campo de cuenta sin asignar no es un error.
 *
 * Llamar SIEMPRE con `companyId` fijado por el propio servidor (el de
 * `requireCompanyAction`), nunca uno que también venga del cliente en el
 * mismo payload — de lo contrario el guard no protege nada. Excepción
 * deliberada: `IncomeDistributionService` valida cada línea contra el
 * `recipientCompanyId` de ESA línea, porque el feature es, por diseño,
 * multi-empresa (una distribución de resultados entre socios).
 *
 * Uso dentro de un `$transaction`: pasar `tx` como `db` para que la
 * verificación y la escritura vean el mismo snapshot (mismo patrón que el
 * resto de guards de ADR-041/044).
 */
export async function assertAccountsBelongToCompany(
  db: Pick<PrismaClient, "account"> | Prisma.TransactionClient,
  companyId: string,
  candidates: Array<string | null | undefined>,
): Promise<void> {
  return assertBelongToCompany(
    db.account, companyId, candidates,
    "La cuenta seleccionada no existe o no pertenece a esta empresa.",
    "Una o más cuentas seleccionadas no existen o no pertenecen a esta empresa.",
  );
}

/**
 * Igual que `assertAccountsBelongToCompany`, pero contra `BankAccount` (un
 * modelo distinto de `Account` — ver comentario de arriba del archivo).
 */
export async function assertBankAccountsBelongToCompany(
  db: Pick<PrismaClient, "bankAccount"> | Prisma.TransactionClient,
  companyId: string,
  candidates: Array<string | null | undefined>,
): Promise<void> {
  return assertBelongToCompany(
    db.bankAccount, companyId, candidates,
    "La cuenta bancaria seleccionada no existe o no pertenece a esta empresa.",
    "Una o más cuentas bancarias seleccionadas no existen o no pertenecen a esta empresa.",
  );
}
