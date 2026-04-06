// src/lib/prisma-rls.ts
// Función canónica para RLS por transacción — ADR-007
// CONTRATO: solo invocar dentro de un prisma.$transaction activo.
// SET LOCAL (is_local=true) — se limpia automáticamente en COMMIT/ROLLBACK.
// Compatible con PgBouncer transaction mode (Neon serverless).

import type { Prisma } from "@prisma/client";

export type PrismaTransactionClient = Prisma.TransactionClient;

/**
 * Establece `app.current_company_id` como parámetro de sesión local para la
 * transacción activa, habilitando las RLS policies de `company_isolation`.
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
  // set_config(key, value, is_local=true) — equivalente a SET LOCAL
  // is_local=true: el valor se limpia al finalizar la transacción
  await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
  return fn(tx);
}
