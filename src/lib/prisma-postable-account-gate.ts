// src/lib/prisma-postable-account-gate.ts
// Gate central: ninguna cuenta de "título" (Account.isPostable = false) puede recibir un
// JournalEntry directo. Un JournalEntry NUNCA se crea suelto en todo el repo (transactionId es
// obligatorio) — SIEMPRE se crea anidado dentro de `prisma.transaction.create/update/upsert`
// (`entries: { create: [...] }`, confirmado en 15+ servicios). Por eso basta con interceptar
// esa única operación, sin tocar ninguno de esos servicios — mismo patrón que
// prisma-billing-gate.ts (aplicado en src/lib/prisma.ts vía $extends).
import { Prisma, type PrismaClient } from "@prisma/client";

export function notPostableMessage(code: string, name: string): string {
  return `La cuenta ${code} — ${name} es una cuenta de título (agrupa otras cuentas) y no admite movimientos directos. Usa una cuenta de detalle.`;
}

/** Bloqueo real e intencional (cuenta de título) — distinto de un fallo de infraestructura, para
 * que el catch fail-open de abajo nunca se trague por error el rechazo que sí debe propagarse. */
export class NotPostableAccountError extends Error {}

const RELEVANT_MODEL = "Transaction";
const RELEVANT_OPERATIONS = new Set(["create", "update", "upsert"]);

export function isRelevantOperation(model: string | undefined, operation: string): boolean {
  return model === RELEVANT_MODEL && RELEVANT_OPERATIONS.has(operation);
}

type EntriesNode = {
  create?: unknown;
  createMany?: { data?: unknown };
  upsert?: unknown;
};

function pushAccountId(row: unknown, ids: Set<string>): void {
  if (row && typeof row === "object" && typeof (row as { accountId?: unknown }).accountId === "string") {
    ids.add((row as { accountId: string }).accountId);
  }
}

function collectFromEntriesNode(entriesNode: unknown, ids: Set<string>): void {
  if (!entriesNode || typeof entriesNode !== "object") return;
  const node = entriesNode as EntriesNode;

  if (Array.isArray(node.create)) node.create.forEach((row) => pushAccountId(row, ids));
  else if (node.create) pushAccountId(node.create, ids);

  if (Array.isArray(node.createMany?.data)) node.createMany.data.forEach((row) => pushAccountId(row, ids));

  if (Array.isArray(node.upsert)) {
    node.upsert.forEach((u) => {
      if (u && typeof u === "object" && "create" in u) pushAccountId((u as { create?: unknown }).create, ids);
    });
  }
}

function collectFromDataNode(d: unknown, ids: Set<string>): void {
  if (!d || typeof d !== "object") return;
  collectFromEntriesNode((d as { entries?: unknown }).entries, ids);
}

/** Extrae los accountId de cualquier forma en que `entries` (relación JournalEntry[]) pueda
 * anidar una escritura dentro de los args de Transaction.create/update/upsert. Nunca lanza. */
export function extractAccountIds(args: unknown): string[] {
  const ids = new Set<string>();
  if (!args || typeof args !== "object") return [];

  const data = (args as { data?: unknown }).data;
  if (Array.isArray(data)) data.forEach((row) => collectFromDataNode(row, ids));
  else if (data) collectFromDataNode(data, ids);

  // transaction.upsert: { where, create: {...}, update: {...} } — sin `data` en el nivel raíz.
  const upsertArgs = args as { create?: unknown; update?: unknown };
  collectFromDataNode(upsertArgs.create, ids);
  collectFromDataNode(upsertArgs.update, ids);

  return [...ids];
}

export function createPostableAccountGateExtension(base: PrismaClient) {
  return Prisma.defineExtension({
    name: "postable-account-gate",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (isRelevantOperation(model, operation)) {
            const accountIds = extractAccountIds(args);
            if (accountIds.length > 0) {
              // Fail-open: un fallo transitorio de esta consulta (cold start Neon, blip de red —
              // mismo escenario que motivó withDbRetry en prisma.ts) NUNCA debe bloquear el 100%
              // de los asientos de la app. Mismo criterio que prisma-billing-gate.ts.
              try {
                const blocked = await base.account.findMany({
                  where: { id: { in: accountIds }, isPostable: false },
                  select: { code: true, name: true },
                });
                if (blocked.length > 0) {
                  throw new NotPostableAccountError(notPostableMessage(blocked[0].code, blocked[0].name));
                }
              } catch (err) {
                if (err instanceof NotPostableAccountError) throw err;
                console.error("[postable-account-gate] verificación falló — permitiendo (fail-open):", err);
              }
            }
          }
          return query(args);
        },
      },
    },
  });
}
