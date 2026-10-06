import { Prisma } from "@prisma/client";

const CONNECTION_KEYWORDS = ["timeout", "terminated", "econnreset", "econnrefused", "connection"];

// Señales de errores técnicos de Postgres/BD que NUNCA deben llegar crudos al usuario
// (information disclosure) ni en inglés — p.ej. "permission denied for schema public" del
// SET LOCAL ROLE / set_config de RLS. Los errores de negocio se lanzan en español y no
// contienen estas cadenas, así que esta lista no los oculta por error.
const TECHNICAL_DB_KEYWORDS = [
  "permission denied",
  "schema public",
  "set local",
  "set role",
  "set_config",
  "syntax error",
  "pg_",
  "prisma",
];

// Señales de límites de infraestructura/plataforma que llegan en inglés y exponen al
// proveedor (p.ej. Neon: "Your account or project has exceeded the compute time quota.
// Upgrade your plan to increase limits."). Los mensajes de negocio están en español y no
// contienen estas cadenas, así que no se ocultan por error.
const INFRA_LIMIT_KEYWORDS = ["quota", "compute time", "exceeded", "upgrade your plan"];

const GENERIC_DB_ERROR =
  "No se pudo completar la operación por un problema de base de datos. Intenta de nuevo; si el problema persiste, contacta al administrador.";

function isConnectionError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return CONNECTION_KEYWORDS.some((kw) => msg.includes(kw));
}

function isTechnicalDbError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return (
    TECHNICAL_DB_KEYWORDS.some((kw) => msg.includes(kw)) ||
    INFRA_LIMIT_KEYWORDS.some((kw) => msg.includes(kw))
  );
}

/**
 * Maps a caught Prisma error to a user-friendly message.
 * P2002 (unique constraint) and P2003 (foreign key) are mapped to Spanish messages.
 * Connection/timeout errors show a retry prompt instead of leaking raw DB messages.
 */
// B1 (auditoría 2026-06): reemplaza detección frágil por substring (includes("P2002"))
export function isPrismaError(
  error: unknown,
  code: string
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

/**
 * ¿Este P2002 concierne a la columna indicada?
 *
 * Fuente única para no repetir la forma de `meta.target`, que NO es estable:
 * el adaptador de Neon la parsea del DETAIL de Postgres (`Key (a, b)=(...)`), así
 * que con un `@@unique` compuesto llega como ARRAY de columnas —tras la migración
 * 20260816 pasó de `["idempotencyKey"]` a `["companyId","idempotencyKey"]`— y en
 * otros drivers puede llegar como string. Se cubren ambas formas.
 *
 * Sirve para distinguir QUÉ constraint chocó cuando un modelo tiene varios: sin
 * esto, PayrollRun mapeaba cualquier P2002 al mensaje del período aunque el choque
 * fuese de `idempotencyKey` (doble submit), mintiendo al usuario.
 *
 * REGRESIÓN 2026-10-01 (barrido tras ADR-056): con Prisma 7.8.0 + el adaptador de
 * Neon, `error.meta.target` YA NO EXISTE — las columnas viven anidadas en
 * `error.meta.driverAdapterError.cause.constraint.fields`. `error.meta` llega `{}`
 * a secas. Confirmado en vivo contra producción (índice parcial de ADR-056):
 * `p2002TargetIncludes` devolvía `false` SIEMPRE, para CUALQUIER columna, en TODOS
 * los ~13 módulos que lo usan (correlativos Z-1, retenciones, idempotencia de
 * pagos, PayrollRun, inventario) — cada uno caía silenciosamente a su rama
 * genérica/menos específica sin que ningún test lo detectara, porque los tests
 * mockean `meta: { target }` directo (la forma vieja, nunca la real). `fields`
 * puede traer cada columna con comillas literales (`"companyId"`) o sin ellas
 * (`name`) según si Postgres necesitó citar el identificador — se despojan antes
 * de comparar. Se prueba esta forma PRIMERO y se cae a `meta.target` como
 * compatibilidad hacia atrás (otros drivers, o un Prisma más viejo).
 */
/**
 * Violación de una restricción de EXCLUSIÓN de Postgres (SQLSTATE 23P01).
 *
 * Prisma no la tiene en su mapa de errores conocidos —sólo cubre unique (P2002),
 * FK (P2003) y compañía—, así que no llega como `PrismaClientKnownRequestError`
 * con un código estable: llega con el texto de Postgres. Por eso se busca el
 * NOMBRE de la restricción en el mensaje, que es lo único fiable.
 *
 * Sin esto, una carrera contra `PayrollRun_no_overlap_active` le devolvería al
 * usuario el error crudo del motor.
 */
export function isExclusionViolation(error: unknown, constraintName: string): boolean {
  if (!error || typeof error !== "object") return false;
  const partes = [
    (error as { message?: unknown }).message,
    (error as { meta?: { message?: unknown } }).meta?.message,
    (error as { code?: unknown }).code,
  ];
  const texto = partes.filter((v) => typeof v === "string").join(" ");
  // Se exige el nombre de la restricción, no sólo el SQLSTATE: otra restricción
  // de exclusión futura no debe heredar este mensaje.
  return texto.includes(constraintName);
}

/** SQLSTATE propio del trigger de cuadre de la BD (migración `trigger_cuadre_partida_doble`, ADR-060). */
const UNBALANCED_ENTRY_SQLSTATE = "CF001";

/** Mensaje de negocio cuando la BD rechaza un asiento descuadrado (SPEC-001, RN-4). */
export const UNBALANCED_ENTRY_MESSAGE =
  "El asiento no cuadra: débitos y créditos deben ser iguales. No se guardó ningún cambio.";

/**
 * ¿La BD rechazó la transacción porque un asiento no cuadra? (SPEC-001, trigger de cuadre).
 *
 * El trigger se dispara al COMMIT (constraint trigger diferido) y lanza SQLSTATE `CF001`, un código
 * propio que Prisma no conoce: no llega como un error conocido ni con una forma estable. Con adapter-pg
 * el código de Postgres viene en `code`/`cause`; con el adaptador de Neon (producción) viene anidado en
 * `meta.driverAdapterError.cause` (misma lección que LL-014 con el P2002). Por eso se recorre el error
 * —sus propiedades, `meta` y `cause`, hasta 5 niveles y con protección contra ciclos— buscando el
 * marcador `CF001`, que el trigger pone TAMBIÉN al inicio de su mensaje: es lo único fiable.
 *
 * Sin esto, el usuario recibiría el error crudo del motor o el mensaje genérico de base de datos.
 */
export function isUnbalancedEntryError(error: unknown): boolean {
  const visited = new Set<object>();
  const walk = (value: unknown, depth: number): boolean => {
    // Un string suelto solo cuenta si ES el marcador (empieza por "CF001:"): el código de una cuenta
    // contable "CF001" dentro de un mensaje de negocio no debe confundirse con el error del trigger.
    if (typeof value === "string") return value.startsWith(`${UNBALANCED_ENTRY_SQLSTATE}:`);
    if (!value || typeof value !== "object" || depth > 5 || visited.has(value)) return false;
    visited.add(value);
    const record = value as Record<string, unknown>;
    // `message` y `cause` de un Error no son propiedades enumerables: se leen a mano.
    const codes = [record.code, record.originalCode, record.sqlState];
    if (codes.some((v) => v === UNBALANCED_ENTRY_SQLSTATE)) return true;
    const messages = [record.message, record.originalMessage, record.detail];
    if (
      messages.some((v) => typeof v === "string" && v.includes(`${UNBALANCED_ENTRY_SQLSTATE}:`))
    ) {
      return true;
    }
    const children = [record.cause, record.meta, ...Object.values(record)];
    return children.some((child) => child !== value && walk(child, depth + 1));
  };
  return walk(error, 0);
}

export function p2002TargetIncludes(error: unknown, column: string): boolean {
  if (!isPrismaError(error, "P2002")) return false;
  const meta = error.meta as Record<string, unknown> | undefined;

  // Forma real con Prisma 7.8.0 + adaptador de Neon (ver comentario arriba) —
  // probar ESTA primero: cuando aplica, `meta.target` llega vacío (`meta: {}`).
  const driverFields = (
    meta?.driverAdapterError as { cause?: { constraint?: { fields?: unknown } } } | undefined
  )?.cause?.constraint?.fields;
  if (Array.isArray(driverFields)) {
    return driverFields.some((c) => String(c).replace(/^"|"$/g, "") === column);
  }

  const target = meta?.target;
  if (Array.isArray(target)) return target.some((c) => String(c) === column);
  // Se parte por coma y se recorta, en vez de usar una clase de regex: el
  // DETAIL de Postgres llega como `Key (companyId, idempotencyKey)=(...)`.
  // (La versión con regex se escribió mal: la clase quedó como "coma o la letra
  // s" en vez de "coma o espacio", y ningún tipo ni test lo veía. Sin escape no
  // hay trampa: ni siquiera al escribir ESTE comentario, donde la barra invertida
  // volvió a desaparecer en el primer intento.)
  if (typeof target === "string") {
    return target
      .split(",")
      .map((c) => c.trim())
      .includes(column);
  }
  // Sin `target` no se puede afirmar que sea esa columna: se responde NO.
  // Fail-closed hacia el mensaje genérico, que es correcto aunque menos preciso.
  return false;
}

export function mapPrismaError(error: unknown): string {
  // SPEC-001: el trigger de cuadre rechaza al COMMIT un asiento descuadrado. Se mira ANTES que el
  // resto: llega como P2010 o como Error plano según el driver, y ambos caerían al mensaje genérico
  // o crudo. Tiene su propio texto de negocio (RN-4): nunca el error del motor.
  if (isUnbalancedEntryError(error)) return UNBALANCED_ENTRY_MESSAGE;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return "Ya existe un registro con esos datos";
    if (error.code === "P2003") return "Datos de referencia inválidos";
    // L-4: P2034 (write conflict / deadlock en Serializable) NO estaba mapeado.
    // Su mensaje no contiene ninguna keyword técnica ni "prisma", así que caía
    // al `return error.message` final y llegaba crudo al toast, en inglés. Los 8
    // módulos que reintentan P2034 dependen de esta traducción cuando agotan los
    // reintentos — por eso va aquí, en la fuente única, y no en cada uno.
    if (error.code === "P2034") return "Error transitorio — intenta de nuevo.";
    // P2010: raw query failed (p.ej. SET LOCAL ROLE / set_config sin permisos RLS).
    // El mensaje crudo de Postgres viene en inglés — nunca exponerlo al usuario.
    if (error.code === "P2010") return GENERIC_DB_ERROR;
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return "La base de datos tardó en responder. Intenta de nuevo en unos segundos.";
  }
  // Errores de validación de Prisma ("Invalid `prisma.model.method()` invocation…") — técnicos.
  if (error instanceof Prisma.PrismaClientValidationError) {
    return GENERIC_DB_ERROR;
  }
  if (error instanceof Error) {
    if (isConnectionError(error)) {
      return "La base de datos tardó en responder. Intenta de nuevo en unos segundos.";
    }
    // Errores técnicos de BD (permisos, schema, sintaxis…) → mensaje genérico en español.
    // Evita fugar mensajes internos de Postgres como "permission denied for schema public".
    if (isTechnicalDbError(error)) return GENERIC_DB_ERROR;
    return error.message;
  }
  return "Error inesperado";
}
