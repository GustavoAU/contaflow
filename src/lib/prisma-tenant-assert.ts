// src/lib/prisma-tenant-assert.ts
// Aserción de aislamiento multi-tenant a nivel de cliente Prisma — ADR-044 D-3.
//
// POR QUÉ EXISTE: la RLS de Postgres (ADR-007) sólo se evalúa dentro de los ~30
// call-sites de `withCompanyContext`. Fuera de ellos la app corre como
// `neondb_owner`, que tiene BYPASSRLS, así que las policies NI SE EVALÚAN —
// olvidar el wrapper es fail-OPEN, no fail-closed (ADR-044 §2). Las lecturas, que
// no viven dentro de `$transaction`, no están cubiertas en absoluto.
//
// Esta extensión cierra ese hueco por el lado de la aplicación: exige que toda
// operación MULTI-FILA sobre un modelo tenant acote por `companyId`. No filtra y
// no inyecta nada — sólo AFIRMA. Inyectar reimplementaría las policies en
// TypeScript y sería la misma capa que ADR-004, no defensa en profundidad
// (ADR-044 §7, alternativa 4).
//
// Coste: 0 round-trips, 0 latencia de red. Cobertura: 100% de las lecturas.
// Modo de fallo: RUIDOSO (ADR-044 §6) — nunca una lista vacía en silencio.
//
// LÍMITE CONOCIDO: no ve `$queryRaw`/`$executeRaw` (no hay `model` que inspeccionar).
// Ese inventario es la tarea D-8.2 del ADR.
import { Prisma } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";
import * as Sentry from "@sentry/nextjs";

// ─── Modo de operación ────────────────────────────────────────────────────────

/**
 * `report`  — sólo instrumenta (Sentry + consola). No rompe nada. Es el modo de
 *             despliegue inicial: produce el inventario de violaciones y de
 *             `unscoped()` que D-7 necesita para saber qué flujos requieren rol
 *             admin. Mismo patrón que el CSP Report-Only que ya usa el proyecto.
 * `enforce` — lanza. Se activa tras una ventana en producción sin falsos positivos.
 * `off`     — desactivada por completo (válvula de emergencia).
 */
export type TenantAssertMode = "report" | "enforce" | "off";

export function resolveMode(raw: string | undefined): TenantAssertMode {
  if (raw === "enforce" || raw === "off" || raw === "report") return raw;
  return "report";
}

// ─── Vía de escape explícita ──────────────────────────────────────────────────

/**
 * Flujos legítimamente NO tenant-scoped (ADR-044 D-5). La lista es cerrada a
 * propósito: añadir un motivo obliga a tocar este archivo, que es donde mira la
 * auditoría. Un `unscoped()` sin motivo válido no compila.
 */
export type UnscopedReason =
  | "auth-bootstrap"        // resolver a qué empresas pertenece el usuario
  | "company-create"        // alta de empresa: aún no existe companyId
  | "cron:billing-lifecycle" // barrido de todas las empresas (ADR-040 D-5)
  | "cron:plan-change"      // ídem — aplicar cambios de plan vencidos
  | "webhook:nowpayments"   // el pago llega identificado por su propio ID
  | "webhook:qstash"        // reintentos SENIAT
  | "health"                // /api/health
  | "seed"                  // scripts de datos iniciales
  | "despacho:managed-clients"; // un despacho consulta sus RIFs gestionados

const unscopedStore = new AsyncLocalStorage<UnscopedReason>();

/**
 * Declara que el bloque no puede acotarse por empresa, y por qué.
 *
 * Es la ÚNICA vía de escape, y es greppable: `unscoped(` en el repo devuelve el
 * inventario completo de consultas sin tenant. Ese inventario es el insumo de
 * ADR-044 D-7 (qué flujos van contra el cliente admin cuando el rol de login
 * pierda BYPASSRLS).
 */
export function unscoped<T>(reason: UnscopedReason, fn: () => Promise<T>): Promise<T> {
  return unscopedStore.run(reason, fn);
}

export function currentUnscopedReason(): UnscopedReason | undefined {
  return unscopedStore.getStore();
}

// ─── Operaciones vigiladas ────────────────────────────────────────────────────

/**
 * Multi-fila: un `where` incompleto devuelve/afecta filas de OTRAS empresas.
 *
 * `findUnique`/`update`/`delete`/`upsert` NO entran: operan sobre una clave única
 * (un CUID no es adivinable y no hay barrido cross-tenant). Ése es el criterio de
 * ADR-044 D-3, y coincide con el que ya usa `company-isolation.test.ts`.
 */
export const SCOPED_OPERATIONS = new Set<string>([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
]);

/** Operaciones donde el tenant viaja en `data`, no en `where`. */
export const CREATE_MANY_OPERATIONS = new Set<string>(["createMany", "createManyAndReturn"]);

// ─── Mapa de modelos tenant ───────────────────────────────────────────────────

/**
 * Cómo se acota un modelo concreto.
 *
 * - `scalars`   — claves escalares que, presentes en el `where`, ya lo acotan.
 * - `relations` — relación → modelo padre, para validar `where: { invoice: { companyId } }`
 *                 comprobando RECURSIVAMENTE que el filtro anidado sí acota. Aceptar
 *                 la mera presencia de la relación sería un falso negativo:
 *                 `where: { invoice: { status: "X" } }` no acota nada.
 */
export type ScopeSpec = {
  scalars: Set<string>;
  relations: Map<string, string>;
};

/**
 * Casos que no se pueden derivar: su columna de tenant no se llama `companyId` ni
 * llega por una relación a un modelo que la tenga. Son exactamente los mismos
 * casos especiales que las policies de `20260706_rls_a1bis`.
 */
const SCOPE_OVERRIDES: Record<string, ScopeSpec> = {
  // policy self-id: la propia PK ES el tenant
  Company: { scalars: new Set(["id"]), relations: new Map() },
  // policy sobre despachoCompanyId
  ManagedClient: {
    scalars: new Set(["despachoCompanyId"]),
    relations: new Map([["despachoCompany", "Company"]]),
  },
};

/** Modelos globales por diseño — no tienen ni pueden tener tenant. */
const NON_TENANT_MODELS = new Set<string>(["User"]);

type DmmfModel = {
  name: string;
  fields: readonly { name: string; kind: string; type: string }[];
};

/**
 * Construye, desde el DMMF de Prisma, el mapa `modelo → cómo se acota`.
 *
 * Se DERIVA en vez de hardcodearse: un modelo tenant nuevo queda cubierto sin que
 * nadie tenga que acordarse de darlo de alta. Ésa es justamente la clase de olvido
 * que produjo este ADR.
 *
 * OJO con el DMMF que Prisma 7 embebe en el cliente: viene RECORTADO. `isList` y
 * `relationFromFields` son `undefined`, así que no sirven para distinguir una
 * relación de lista de una relación a padre, ni para saber el nombre de la FK.
 * La derivación se apoya en cambio en la convención `<relación>Id`, VERIFICADA
 * contra los escalares reales del modelo. Eso resuelve las dos cosas a la vez:
 * da el nombre de la FK y descarta las relaciones de lista, que no tienen FK
 * local (`BankStatement.transactions` → no existe `transactionsId`).
 * Verificado: la convención se cumple en los 13 modelos hijo del schema.
 */
export function buildScopeMap(models: readonly DmmfModel[]): Map<string, ScopeSpec> {
  const ownsCompanyId = new Set(
    models
      .filter((m) => m.fields.some((f) => f.name === "companyId" && f.kind === "scalar"))
      .map((m) => m.name),
  );

  const map = new Map<string, ScopeSpec>();

  for (const model of models) {
    if (NON_TENANT_MODELS.has(model.name)) continue;

    const override = SCOPE_OVERRIDES[model.name];
    if (override) {
      map.set(model.name, override);
      continue;
    }

    if (ownsCompanyId.has(model.name)) {
      map.set(model.name, { scalars: new Set(["companyId"]), relations: new Map() });
      continue;
    }

    // Hijo: acotarlo por el padre equivale a acotarlo por empresa, porque el padre
    // sí tiene companyId y su FK es un CUID no adivinable.
    const scalarNames = new Set(
      model.fields.filter((f) => f.kind === "scalar").map((f) => f.name),
    );
    const spec: ScopeSpec = { scalars: new Set(), relations: new Map() };
    for (const field of model.fields) {
      if (field.kind !== "object" || !ownsCompanyId.has(field.type)) continue;
      const fk = `${field.name}Id`;
      if (!scalarNames.has(fk)) continue; // relación de lista, o FK no convencional
      spec.scalars.add(fk);
      spec.relations.set(field.name, field.type);
    }
    if (spec.scalars.size > 0) map.set(model.name, spec);
  }

  return map;
}

/** Mapa efectivo del schema actual: 88 modelos, los mismos que tienen RLS. */
export const SCOPE_MAP: Map<string, ScopeSpec> = buildScopeMap(
  Prisma.dmmf.datamodel.models as unknown as readonly DmmfModel[],
);

// ─── Detección de acotamiento ─────────────────────────────────────────────────

const MAX_DEPTH = 8;

/**
 * ¿Este `where` acota por alguna de las claves de tenant del modelo?
 *
 * Semántica de los combinadores, que es donde está la sutileza:
 *   - `AND`: basta con que UNA rama acote — restringe el conjunto entero.
 *   - `OR` : deben acotar TODAS las ramas; si una no acota, la unión se escapa
 *            de la empresa. Éste es el caso que una comprobación ingenua deja pasar.
 *   - `NOT`: no acota nunca (niega, no restringe al tenant).
 */
export function whereIsScoped(
  where: unknown,
  spec: ScopeSpec,
  lookup: (model: string) => ScopeSpec | undefined = (m) => SCOPE_MAP.get(m),
  depth = 0,
): boolean {
  if (!where || typeof where !== "object" || depth > MAX_DEPTH) return false;

  if (Array.isArray(where)) {
    return where.length > 0 && where.every((w) => whereIsScoped(w, spec, lookup, depth + 1));
  }

  const obj = where as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value === null || value === undefined) continue;

    // `companyId: { in: [] }` no acota nada útil, pero tampoco filtra de más:
    // devuelve vacío. Se acepta como acotado — no es una fuga.
    if (spec.scalars.has(key)) return true;

    const parentModel = spec.relations.get(key);
    if (parentModel) {
      const parentSpec = lookup(parentModel);
      if (parentSpec && whereIsScoped(value, parentSpec, lookup, depth + 1)) return true;
    }
  }

  const and = obj.AND;
  if (and !== undefined) {
    const branches = Array.isArray(and) ? and : [and];
    if (branches.some((b) => whereIsScoped(b, spec, lookup, depth + 1))) return true;
  }

  const or = obj.OR;
  if (Array.isArray(or) && or.length > 0) {
    if (or.every((b) => whereIsScoped(b, spec, lookup, depth + 1))) return true;
  }

  return false;
}

/** ¿Las filas de un `createMany` traen todas su tenant? */
export function createDataIsScoped(data: unknown, spec: ScopeSpec): boolean {
  const rows = Array.isArray(data) ? data : [data];
  if (rows.length === 0) return true;
  return rows.every((row) => {
    if (!row || typeof row !== "object") return false;
    const obj = row as Record<string, unknown>;
    return [...spec.scalars].some((k) => obj[k] !== null && obj[k] !== undefined);
  });
}

/**
 * Decide si una operación concreta viola el aislamiento. Función pura: es la que
 * se testea, sin necesidad de base de datos ni de cliente Prisma.
 *
 * Devuelve `null` si está bien, o el motivo de la violación.
 */
export function assertViolation(
  model: string | undefined,
  operation: string,
  args: unknown,
): string | null {
  if (!model) return null;

  const spec = SCOPE_MAP.get(model);
  if (!spec) return null; // modelo global o sin tenant derivable

  const argsObj = (args ?? {}) as { where?: unknown; data?: unknown };
  const expected = [...spec.scalars].join("/");

  if (CREATE_MANY_OPERATIONS.has(operation)) {
    if (createDataIsScoped(argsObj.data, spec)) return null;
    return `${model}.${operation} sin ${expected} en data`;
  }

  if (!SCOPED_OPERATIONS.has(operation)) return null;

  if (whereIsScoped(argsObj.where, spec)) return null;
  return `${model}.${operation} sin ${expected} en where`;
}

// ─── Extensión ────────────────────────────────────────────────────────────────

export const TENANT_ASSERT_MESSAGE =
  "Consulta sin ámbito de empresa — bloqueada por seguridad multi-tenant.";

/**
 * Crea la extensión. Ver `resolveMode` para los modos.
 *
 * En `report` NO lanza: registra en Sentry con tag `tenant_assert_violation` y en
 * consola durante el desarrollo. La petición sigue exactamente igual que hoy, así
 * que desplegarlo no puede romper nada.
 */
export function createTenantAssertExtension(mode: TenantAssertMode) {
  return Prisma.defineExtension({
    name: "tenant-assert",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (mode === "off") return query(args);

          const reason = currentUnscopedReason();
          if (reason) {
            // Declarado no-tenant a propósito. Se deja rastro para el inventario
            // de D-7, no para señalar un problema.
            Sentry.addBreadcrumb({
              category: "tenant-assert",
              level: "info",
              message: `unscoped: ${model}.${operation}`,
              data: { unscoped_reason: reason },
            });
            return query(args);
          }

          const violation = assertViolation(model, operation, args);
          if (violation) {
            if (mode === "enforce") {
              throw new Error(TENANT_ASSERT_MESSAGE);
            }
            Sentry.captureMessage(`tenant-assert: ${violation}`, {
              level: "warning",
              tags: { tenant_assert_violation: `${model}.${operation}` },
            });
            if (process.env.NODE_ENV !== "production") {
              console.warn(`[tenant-assert] ${violation}`);
            }
          }

          return query(args);
        },
      },
    },
  });
}
