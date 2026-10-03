// src/lib/prisma-tercero-required-gate.ts
// Gate central: ninguna línea de asiento (JournalEntry) contra una cuenta con
// Account.requiresThirdParty = true puede quedar sin tercero (Customer/Vendor/Partner/
// Employee). Mismo patrón que prisma-postable-account-gate.ts (JournalEntry nunca se crea
// suelto — siempre anidado en Transaction.create/update/upsert vía `entries: {...}`) — ver
// ADR-054. A diferencia del gate de cuentas de título, aquí la granularidad es POR LÍNEA, no
// por cuenta deduplicada: PaymentGLService.postPaymentBatchGL arma un único asiento que paga a
// varios proveedores distintos en sus distintas líneas — dos líneas contra la misma cuenta, una
// con tercero y otra sin, no pueden colapsarse en un solo estado.
import { Prisma, type PrismaClient } from "@prisma/client";

export function notEnoughThirdPartyMessage(code: string, name: string): string {
  return `La cuenta ${code} — ${name} exige indicar el tercero (cliente, proveedor, socio o empleado) en cada línea del asiento.`;
}

/** Bloqueo real e intencional (falta el tercero obligatorio) — distinto de un fallo de
 * infraestructura, para que el catch fail-open de abajo nunca se trague por error el rechazo
 * que sí debe propagarse. */
export class MissingThirdPartyError extends Error {}

const RELEVANT_MODEL = "Transaction";
const RELEVANT_OPERATIONS = new Set(["create", "update", "upsert"]);

export function isRelevantOperation(model: string | undefined, operation: string): boolean {
  return model === RELEVANT_MODEL && RELEVANT_OPERATIONS.has(operation);
}

export function hasThirdParty(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const r = row as {
    customerId?: unknown;
    vendorId?: unknown;
    partnerId?: unknown;
    employeeId?: unknown;
  };
  return (
    (typeof r.customerId === "string" && r.customerId !== "") ||
    (typeof r.vendorId === "string" && r.vendorId !== "") ||
    (typeof r.partnerId === "string" && r.partnerId !== "") ||
    (typeof r.employeeId === "string" && r.employeeId !== "")
  );
}

export type EntryPartyPair = { accountId: string; hasThirdParty: boolean };

type EntriesNode = {
  create?: unknown;
  createMany?: { data?: unknown };
};

function pushPair(row: unknown, pairs: EntryPartyPair[]): void {
  if (
    row &&
    typeof row === "object" &&
    typeof (row as { accountId?: unknown }).accountId === "string"
  ) {
    pairs.push({
      accountId: (row as { accountId: string }).accountId,
      hasThirdParty: hasThirdParty(row),
    });
  }
}

function collectFromEntriesNode(entriesNode: unknown, pairs: EntryPartyPair[]): void {
  if (!entriesNode || typeof entriesNode !== "object") return;
  const node = entriesNode as EntriesNode;

  if (Array.isArray(node.create)) node.create.forEach((row) => pushPair(row, pairs));
  else if (node.create) pushPair(node.create, pairs);

  if (Array.isArray(node.createMany?.data))
    node.createMany.data.forEach((row) => pushPair(row, pairs));
}

function collectFromDataNode(d: unknown, pairs: EntryPartyPair[]): void {
  if (!d || typeof d !== "object") return;
  collectFromEntriesNode((d as { entries?: unknown }).entries, pairs);
}

/** Extrae, POR LÍNEA (sin deduplicar — a diferencia de extractAccountIds), el par
 * {accountId, hasThirdParty} de cualquier forma en que Transaction.create/update/upsert pueda
 * anidar una escritura de `entries`. Nunca lanza. */
export function extractEntryPartyPairs(args: unknown): EntryPartyPair[] {
  const pairs: EntryPartyPair[] = [];
  if (!args || typeof args !== "object") return [];

  const data = (args as { data?: unknown }).data;
  if (Array.isArray(data)) data.forEach((row) => collectFromDataNode(row, pairs));
  else if (data) collectFromDataNode(data, pairs);

  // transaction.upsert: { where, create: {...}, update: {...} } — sin `data` en el nivel raíz.
  const upsertArgs = args as { create?: unknown; update?: unknown };
  collectFromDataNode(upsertArgs.create, pairs);
  collectFromDataNode(upsertArgs.update, pairs);

  return pairs;
}

export function createTerceroRequiredGateExtension(base: PrismaClient) {
  return Prisma.defineExtension({
    name: "tercero-required-gate",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (isRelevantOperation(model, operation)) {
            const pairs = extractEntryPartyPairs(args);
            const missingAccountIds = [
              ...new Set(pairs.filter((p) => !p.hasThirdParty).map((p) => p.accountId)),
            ];
            if (missingAccountIds.length > 0) {
              // Fail-open: un fallo transitorio de esta consulta (cold start Neon, blip de red)
              // nunca debe bloquear el 100% de los asientos de la app. Mismo criterio que
              // prisma-postable-account-gate.ts / prisma-billing-gate.ts.
              try {
                const requiring = await base.account.findMany({
                  where: { id: { in: missingAccountIds }, requiresThirdParty: true },
                  select: { code: true, name: true },
                });
                if (requiring.length > 0) {
                  throw new MissingThirdPartyError(
                    notEnoughThirdPartyMessage(requiring[0].code, requiring[0].name)
                  );
                }
              } catch (err) {
                if (err instanceof MissingThirdPartyError) throw err;
                console.error(
                  "[tercero-required-gate] verificación falló — permitiendo (fail-open):",
                  err
                );
              }
            }
          }
          return query(args);
        },
      },
    },
  });
}
