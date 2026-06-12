// src/lib/prisma-rls.ts
// Función canónica para RLS por transacción — ADR-007
// CONTRATO: solo invocar dentro de un prisma.$transaction activo.
// SET LOCAL (is_local=true) — se limpia automáticamente en COMMIT/ROLLBACK.
// Compatible con PgBouncer transaction mode (Neon serverless).

import type { Prisma } from "@prisma/client";

export type PrismaTransactionClient = Prisma.TransactionClient;

/**
 * Establece el contexto de tenant para la transacción activa:
 * 1. SET LOCAL ROLE authenticated — neutraliza BYPASSRLS de neondb_owner.
 *    authenticated no tiene BYPASSRLS → RLS se aplica sin excepción.
 * 2. set_config('app.current_company_id', ..., true) — habilita policies company_isolation.
 * Ambas operaciones son SET LOCAL: se revierten en COMMIT/ROLLBACK.
 *
 * Prerequisito: `GRANT authenticated TO neondb_owner` (migración 20260611_rls_force_with_check).
 *
 * @param companyId  - ID del tenant activo. Debe provenir de auth verificada.
 * @param tx         - Cliente de transacción Prisma (`$transaction` callback param).
 * @param fn         - Función que ejecuta las queries bajo el contexto RLS.
 *                     Recibe `tx` explícitamente para evitar bugs de closure.
 *
 * @throws Si `companyId` está vacío — previene set_config con string vacío
 *         que dejaría el contexto en '' (no NULL) — comportamiento ambiguo.
 */
export async function withCompanyContext<T>(
  companyId: string,
  tx: PrismaTransactionClient,
  fn: (tx: PrismaTransactionClient) => Promise<T>
): Promise<T> {
  if (!companyId) {
    throw new Error("withCompanyContext: companyId no puede estar vacío");
  }
  // SET LOCAL ROLE: neutraliza BYPASSRLS de neondb_owner — Fix A1 (ADR-007 addendum)
  await tx.$executeRaw`SET LOCAL ROLE authenticated`;
  // set_config is_local=true: equivalente a SET LOCAL, se limpia en fin de tx
  await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
  return fn(tx);
}
