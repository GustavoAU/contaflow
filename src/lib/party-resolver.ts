// src/lib/party-resolver.ts
// ADR-054: resolución de Customer/Vendor por vínculo explícito o, si no hay, por RIF en el
// catálogo de la empresa (decisión del dueño 2026-09-26). Fuente única — antes vivía
// duplicada en InvoiceGLPostingService y PaymentGLService; ExchangeDifferentialService
// (revaluación de diferencial cambiario por tercero) la reutiliza en vez de copiarla una
// tercera vez.
import type { Prisma } from "@prisma/client";
import { normalizeRifOrNull } from "@/lib/tax-config";

export type PartyKind = "customer" | "vendor";

/** Resuelve UN tercero: usa el vínculo explícito si existe; si no, busca por RIF. Nunca
 * lanza — sin vínculo y sin match, devuelve undefined (el gate de
 * prisma-tercero-required-gate.ts bloquea el posting si la cuenta lo exige). */
export async function resolvePartyIdByLinkOrRif(
  db: Prisma.TransactionClient,
  companyId: string,
  kind: PartyKind,
  linkedId: string | null | undefined,
  rif: string | null | undefined
): Promise<string | undefined> {
  if (linkedId) return linkedId;
  const normalized = normalizeRifOrNull(rif);
  if (!normalized) return undefined;
  if (kind === "customer") {
    const found = await db.customer.findFirst({
      where: { companyId, rif: normalized, deletedAt: null },
      select: { id: true },
    });
    return found?.id;
  }
  const found = await db.vendor.findFirst({
    where: { companyId, rif: normalized, deletedAt: null },
    select: { id: true },
  });
  return found?.id;
}

/** Resuelve MUCHOS terceros por RIF en una sola query (evita N+1 — un lote de pagos o una
 * revaluación de diferencial cambiario puede tocar decenas de clientes/proveedores
 * distintos). Devuelve un Map RIF normalizado → id; un RIF sin match simplemente no
 * aparece en el mapa. */
export async function batchResolvePartyIdsByRif(
  db: Prisma.TransactionClient,
  companyId: string,
  kind: PartyKind,
  rifs: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const uniqueRifs = [...new Set(rifs)];
  if (uniqueRifs.length === 0) return result;

  const rows =
    kind === "customer"
      ? await db.customer.findMany({
          where: { companyId, rif: { in: uniqueRifs }, deletedAt: null },
          select: { id: true, rif: true },
        })
      : await db.vendor.findMany({
          where: { companyId, rif: { in: uniqueRifs }, deletedAt: null },
          select: { id: true, rif: true },
        });

  for (const row of rows) if (row.rif) result.set(row.rif, row.id);
  return result;
}
