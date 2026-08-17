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

/**
 * Fila única por clave única — D-3-bis.
 *
 * La versión original de D-3 EXIMÍA estas cinco, con este argumento: «operan sobre
 * una clave única (un CUID no es adivinable)». **La premisa era falsa**, y el
 * contraejemplo apareció en la auditoría siguiente: `Expense.idempotencyKey` era
 * `@unique` y `ExpenseService` hacía `findUnique({ where: { idempotencyKey } })`
 * devolviendo la fila entera — pero ese valor **lo elegía el cliente**
 * (`z.string().uuid()`). La empresa B recibía el gasto de A.
 *
 * El salto lógico del ADR era éste: el paréntesis justificaba «clave PRIMARIA CUID»
 * y la conclusión se aplicaba a «cualquier clave única». La redacción correcta no
 * habla del formato sino de la PROCEDENCIA: *la PK es un CUID **generado por el
 * servidor***. Este bug no ocurrió porque un UUID fuera adivinable; ocurrió porque
 * lo eligió quien atacaba.
 *
 * Así que se vigilan, y la exención sobrevive sólo en el caso que la premisa de
 * verdad justificaba: `where: { id }` a secas. Ver `uniqueWhereIsScoped`.
 */
export const UNIQUE_ROW_OPERATIONS = new Set<string>([
  "findUnique",
  "findUniqueOrThrow",
  "update",
  "delete",
  "upsert",
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

/**
 * Mapa efectivo del schema actual: 88 modelos, los mismos que tienen RLS.
 *
 * El `?? []` no es defensivo por costumbre: esto se construye en el top level, así
 * que un `Prisma.dmmf` ausente en algún runtime tumbaría el import de
 * `src/lib/prisma.ts` — o sea, la app entera. Degradar a "sin vigilancia" y avisar
 * es infinitamente mejor que un outage. Hoy no puede pasar (generator
 * `prisma-client-js`, cero rutas edge), pero el coste de blindarlo es una línea.
 */
export const SCOPE_MAP: Map<string, ScopeSpec> = buildScopeMap(
  (Prisma.dmmf?.datamodel?.models ?? []) as unknown as readonly DmmfModel[],
);

if (SCOPE_MAP.size === 0) {
  Sentry.captureMessage("tenant-assert: SCOPE_MAP vacío — el DMMF no está disponible", {
    level: "error",
  });
}

// ─── Detección de acotamiento ─────────────────────────────────────────────────

const MAX_DEPTH = 8;

/**
 * ¿Este valor, puesto en `where.companyId`, RESTRINGE de verdad a una empresa?
 *
 * HIGH-1 (auditoría ADR-044): la versión anterior aceptaba la mera PRESENCIA de la
 * clave, y eso es un falso negativo de la única capa que hoy cubre las lecturas.
 * Todos estos pasaban por «acotado» y ninguno acota:
 *
 *   { companyId: { not: X } }         → todas las empresas MENOS una
 *   { companyId: { notIn: [...] } }   → ídem
 *   { companyId: { startsWith: "c" } }→ todos los CUID empiezan por "c" → todas
 *   { companyId: { in: undefined } }  → Prisma ELIMINA el predicado → todas
 *   { companyId: { equals: undefined } } → ídem
 *
 * Los dos últimos son los peligrosos: son el fallo silencioso, no el intencional.
 * Por eso la comprobación es por FORMA y en lista blanca — sólo `equals` e `in`
 * con operando definido —, no por lista negra de operadores: un operador nuevo de
 * Prisma entra como «no acota» (ruido en `report`), nunca como «acota» (fuga).
 */
export function keyIsScoping(value: unknown): boolean {
  if (typeof value === "string") return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const filter = value as Record<string, unknown>;
  const ops = Object.keys(filter);
  if (ops.length === 0) return false;

  return ops.every((op) => {
    const operand = filter[op];
    if (operand === undefined) return false; // Prisma borra el predicado entero
    if (op === "equals") return typeof operand === "string";
    // `in: []` se acepta a propósito: devuelve vacío, que no es una fuga.
    if (op === "in") return Array.isArray(operand);
    return false;
  });
}

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

    if (spec.scalars.has(key) && keyIsScoping(value)) return true;

    const parentModel = spec.relations.get(key);
    if (parentModel) {
      const parentSpec = lookup(parentModel);
      if (!parentSpec) continue;
      // Prisma admite dos sintaxis para filtrar por una relación to-one: el atajo
      // `{ invoice: { companyId } }` y la explícita `{ invoice: { is: { … } } }`.
      // `isNot` NO se desenvuelve: niega, no restringe (misma lógica que `NOT`).
      const inner =
        typeof value === "object" && value !== null && "is" in (value as object)
          ? (value as Record<string, unknown>).is
          : value;
      if (whereIsScoped(inner, parentSpec, lookup, depth + 1)) return true;
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
    // En `createMany` el tenant es un valor literal: no hay filtros ni `connect`
    // anidado. Se exige string no vacío — `""` pasaría el chequeo de presencia y
    // no acota nada (mismo razonamiento que HIGH-1).
    return [...spec.scalars].some((k) => typeof obj[k] === "string" && obj[k] !== "");
  });
}

/**
 * ¿El `where` de una operación de FILA ÚNICA acota al tenant? — D-3-bis.
 *
 * Se acepta en tres casos, y sólo en tres:
 *
 *  1. **`id` presente como string.** La PK la genera el servidor (CUID), nadie de
 *     fuera la propone. Es lo único que la premisa original justificaba de verdad.
 *
 *     Las claves ADICIONALES no rompen la exención, y conviene explicar por qué,
 *     porque la primera versión de esto exigía que `id` fuera la ÚNICA clave
 *     «porque Prisma resolvería por cualquiera de las dos». **Eso es falso.**
 *     Desde `extendedWhereUnique`, el selector único identifica la fila y los
 *     campos extra son FILTROS que se conjugan con AND — o sea que sólo pueden
 *     restringir más, nunca alcanzar otra fila. Verificado en el cliente generado,
 *     no deducido: `WhereUniqueInput` es `AtLeast<{…}, "id"|"companyId_idempotencyKey">`
 *     y el resto de campos aparecen tipados como `StringFilter`, no como selector.
 *
 *     Exigir `id` a secas habría reportado `update({ where: { id, deletedAt: null } })`
 *     — el patrón de soft-delete de medio repo — llenando de falsos positivos justo
 *     el inventario que D-7 necesita limpio.
 *  2. El escalar de tenant aparece directamente (`{ id, companyId }`).
 *  3. Va dentro de un **selector compuesto**, que es la forma canónica tras la
 *     migración a `@@unique([companyId, …])`:
 *     `{ companyId_idempotencyKey: { companyId, idempotencyKey } }`, o el
 *     `{ companyId_year_month: { … } }` de los correlativos. Ahí el `companyId`
 *     forma parte de la clave, así que la fila ajena es inalcanzable por
 *     construcción.
 *
 * Todo lo demás se reporta. Sí, eso incluye lookups por una FK única generada por
 * el servidor (`{ glTransactionId }`), que son seguros: en modo `report` eso es
 * ruido barato, y el inventario que produce es justo lo que D-7 necesita para
 * decidir. Preferimos afinar la lista con datos antes de `enforce` que volver a
 * razonar por analogía — que es exactamente como nació este agujero.
 */
export function uniqueWhereIsScoped(
  where: unknown,
  spec: ScopeSpec,
  lookup: (model: string) => ScopeSpec | undefined = (m) => SCOPE_MAP.get(m),
): boolean {
  if (!where || typeof where !== "object" || Array.isArray(where)) return false;
  const obj = where as Record<string, unknown>;

  // (1) PK generada por el servidor. Se exige `string` NO VACÍO: un `{ id: {...} }`
  // sería un filtro y no pinta una sola fila, y `""` no identifica nada (mismo
  // criterio que `createDataIsScoped`, que ya rechazaba la cadena vacía).
  if (typeof obj.id === "string" && obj.id !== "") return true;

  // (2) escalar de tenant directo
  if (whereIsScoped(where, spec, lookup)) return true;

  // (3) selector compuesto: el tenant vive un nivel más adentro
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if (whereIsScoped(value, spec, lookup)) return true;
  }

  return false;
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

  if (UNIQUE_ROW_OPERATIONS.has(operation)) {
    if (uniqueWhereIsScoped(argsObj.where, spec)) return null;
    // `Company` se acota por su propia PK, así que aquí `expected` YA es "id":
    // sin esto el mensaje salía "sin id ni id", que invita a buscar el bug en la
    // extensión en vez de en el call-site.
    const falta = spec.scalars.has("id") ? "id" : `${expected} ni id`;
    return `${model}.${operation} por clave única sin ${falta}`;
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
  // M-2 (auditoría): sin deduplicar, `report` emite un evento de Sentry POR CONSULTA
  // violatoria. Hay violaciones en la ruta caliente (la resolución de empresas del
  // usuario corre en cada carga de página), así que serían ≥1 evento de cuota por
  // page-load: se agota el plan y los errores de verdad quedan sepultados bajo ruido
  // conocido. Para el inventario de D-7 interesa el CONJUNTO de violaciones, no su
  // volumetría — con la primera de cada `modelo.operación` basta.
  const reported = new Set<string>();

  return Prisma.defineExtension({
    name: "tenant-assert",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (mode === "off") return query(args);

          // M-1 (auditoría): TODA la instrumentación va dentro de un try/catch. El
          // ADR prometía que `report` "no puede romper nada" y era falso: una
          // excepción del SDK de Sentry, o un `where` patológico, se propagaba y
          // tumbaba la CONSULTA, no sólo la telemetría. La violación se calcula
          // aquí dentro; el `throw` de `enforce` se hace FUERA, para no tragárselo.
          let violation: string | null = null;
          try {
            const reason = currentUnscopedReason();
            if (reason) {
              // Declarado no-tenant a propósito. Rastro para el inventario de D-7,
              // no señal de problema.
              Sentry.addBreadcrumb({
                category: "tenant-assert",
                level: "info",
                message: `unscoped: ${model}.${operation}`,
                data: { unscoped_reason: reason },
              });
              return query(args);
            }

            violation = assertViolation(model, operation, args);

            if (violation && mode === "report") {
              const key = `${model}.${operation}`;
              if (!reported.has(key)) {
                reported.add(key);
                // Sólo el modelo y la operación: nunca valores de datos, ni
                // companyId, ni PII, ni secretos.
                Sentry.captureMessage(`tenant-assert: ${violation}`, {
                  level: "warning",
                  tags: { tenant_assert_violation: key },
                });
              }
              if (process.env.NODE_ENV !== "production") {
                console.warn(`[tenant-assert] ${violation}`);
              }
            }
          } catch {
            // La telemetría jamás rompe la consulta.
          }

          if (violation && mode === "enforce") {
            throw new Error(TENANT_ASSERT_MESSAGE);
          }

          return query(args);
        },
      },
    },
  });
}
