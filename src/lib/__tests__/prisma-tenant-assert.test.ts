// src/lib/__tests__/prisma-tenant-assert.test.ts
//
// Suite de la aserción multi-tenant de ADR-044 D-3 (+ D-3-bis: las operaciones de
// fila única dejaron de estar exentas — ver sección 4-bis).
//
// Todo lo que se prueba aquí es PURO: sin BD, sin cliente Prisma, sin round-trips.
// El grueso son las funciones donde vive la decisión (`assertViolation`,
// `whereIsScoped`, `buildScopeMap`). La última sección conduce además el handler de
// la extensión extrayéndolo de `Prisma.defineExtension` con un cliente falso, para
// que el camino `enforce` (lanzar y NO llegar a la BD) esté cubierto de verdad.
//
// Por qué importa que estos tests sean severos: esta extensión es hoy la ÚNICA capa
// que cubre el 100 % de las lecturas (ADR-044 §1: la RLS solo se evalúa en ~30
// call-sites; fuera de ellos el rol tiene BYPASSRLS y las policies ni se evalúan).
// Un falso NEGATIVO aquí (dar por acotada una consulta que no lo está) es una fuga
// cross-tenant que nadie más va a atrapar.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import {
  createTenantAssertExtension,
  TENANT_ASSERT_MESSAGE,
  type TenantAssertMode,
  resolveMode,
  buildScopeMap,
  whereIsScoped,
  createDataIsScoped,
  uniqueWhereIsScoped,
  keyIsScoping,
  assertViolation,
  unscoped,
  currentUnscopedReason,
  SCOPE_MAP,
  SCOPED_OPERATIONS,
  UNIQUE_ROW_OPERATIONS,
  CREATE_MANY_OPERATIONS,
  type ScopeSpec,
} from "../prisma-tenant-assert";

// Sentry solo se usa en la extensión (no en las funciones puras). Se mockea para
// que el import del módulo no arrastre el SDK real dentro del runner.
vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function spec(scalars: string[], relations: [string, string][] = []): ScopeSpec {
  return { scalars: new Set(scalars), relations: new Map(relations) };
}

type SynthField = { name: string; kind: string; type: string };
type SynthModel = { name: string; fields: SynthField[] };

const s = (name: string, type = "String"): SynthField => ({ name, kind: "scalar", type });
const rel = (name: string, type: string): SynthField => ({ name, kind: "object", type });
const m = (name: string, fields: SynthField[]): SynthModel => ({ name, fields });

/** Modelo tenant "normal" de referencia para los sintéticos. */
const INVOICE_LIKE = m("Invoice", [s("id"), s("companyId"), s("status")]);

/**
 * Las cinco operaciones de FILA ÚNICA (ADR-044 D-3-bis).
 *
 * Se escriben a mano en vez de derivarse de `UNIQUE_ROW_OPERATIONS`: si alguien
 * vaciara ese Set, un `it.each` alimentado por él generaría CERO casos y la suite
 * seguiría verde habiendo dejado de probar el control entero. Aquí la lista ES la
 * expectativa, y hay un test que la confronta con el catálogo de producción.
 */
const UNIQUE_OPS = ["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"] as const;

// ══════════════════════════════════════════════════════════════════════════════
// 1. resolveMode — seguro por defecto
// ══════════════════════════════════════════════════════════════════════════════

describe("resolveMode", () => {
  it("respeta los tres modos válidos", () => {
    expect(resolveMode("enforce")).toBe("enforce");
    expect(resolveMode("off")).toBe("off");
    expect(resolveMode("report")).toBe("report");
  });

  it("undefined (env sin definir) → report: instrumenta sin romper nada", () => {
    expect(resolveMode(undefined)).toBe("report");
  });

  it.each([
    ["", "cadena vacía"],
    ["ENFORCE", "mayúsculas — no se normaliza a propósito"],
    ["enforce ", "espacio de más en el .env"],
    ["true", "booleano mal tecleado"],
    ["OFF", "off en mayúsculas: NO desactiva"],
    ["silent", "modo inexistente"],
  ])("basura %j (%s) → report, nunca off", (raw) => {
    expect(resolveMode(raw)).toBe("report");
  });

  it("un typo en TENANT_ASSERT_MODE jamás degrada a 'off' (la válvula debe ser explícita)", () => {
    const typos = ["of", "0", "false", "disabled", "none", "no"];
    for (const t of typos) expect(resolveMode(t)).not.toBe("off");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. buildScopeMap — derivación desde el DMMF (sintético)
// ══════════════════════════════════════════════════════════════════════════════

describe("buildScopeMap", () => {
  it("modelo con companyId escalar → scalars = {companyId}, sin relaciones", () => {
    const map = buildScopeMap([INVOICE_LIKE]);

    const invoice = map.get("Invoice");
    expect(invoice).toBeDefined();
    expect([...invoice!.scalars]).toEqual(["companyId"]);
    expect(invoice!.relations.size).toBe(0);
  });

  it("modelo hijo con relación a padre tenant + FK convencional → scalars={invoiceId}, relations={invoice→Invoice}", () => {
    const child = m("InvoiceTaxLine", [
      s("id"),
      s("invoiceId"),
      rel("invoice", "Invoice"),
      s("base", "Decimal"),
    ]);

    const map = buildScopeMap([INVOICE_LIKE, child]);

    const line = map.get("InvoiceTaxLine");
    expect(line).toBeDefined();
    expect([...line!.scalars]).toEqual(["invoiceId"]);
    expect([...line!.relations.entries()]).toEqual([["invoice", "Invoice"]]);
  });

  it("relación de LISTA (sin FK local) NO entra en el mapa — es el mecanismo que las descarta", () => {
    // El DMMF que Prisma 7 embebe viene recortado: `isList` es undefined, así que no
    // se puede distinguir una lista de una relación a padre por ese campo. La
    // derivación se apoya en la convención `<relación>Id` verificada contra los
    // escalares reales: `transactions` (lista) no tiene `transactionsId` → fuera.
    const bankTransaction = m("BankTransaction", [s("id"), s("companyId")]);
    const statement = m("BankStatement", [
      s("id"),
      rel("transactions", "BankTransaction"), // lista: NO hay transactionsId
    ]);

    const map = buildScopeMap([bankTransaction, statement]);

    expect(map.has("BankTransaction")).toBe(true);
    expect(map.has("BankStatement")).toBe(false);
  });

  it("prueba de control: la MISMA relación con su FK presente sí entra (aísla la causa)", () => {
    const bankTransaction = m("BankTransaction", [s("id"), s("companyId")]);
    const statement = m("BankStatement", [
      s("id"),
      s("transactionsId"), // ahora existe la FK convencional
      rel("transactions", "BankTransaction"),
    ]);

    const map = buildScopeMap([bankTransaction, statement]);

    expect(map.get("BankStatement")?.scalars.has("transactionsId")).toBe(true);
  });

  it("`isList` explícito en el DMMF no cambia el resultado (no se usa: llega undefined en runtime)", () => {
    const bankTransaction = m("BankTransaction", [s("id"), s("companyId")]);
    const statement = {
      name: "BankStatement",
      fields: [
        { name: "id", kind: "scalar", type: "String", isList: false },
        { name: "transactions", kind: "object", type: "BankTransaction", isList: true },
      ],
    };

    const map = buildScopeMap([bankTransaction, statement]);

    expect(map.has("BankStatement")).toBe(false);
  });

  it("User se excluye SIEMPRE, incluso si el DMMF le diera companyId", () => {
    const map = buildScopeMap([m("User", [s("id"), s("companyId")])]);

    expect(map.has("User")).toBe(false);
  });

  it("Company → {id} por override, aunque el DMMF diga otra cosa", () => {
    // Override porque la policy de Company es self-id: su propia PK ES el tenant.
    const map = buildScopeMap([m("Company", [s("id"), s("companyId"), s("name")])]);

    const company = map.get("Company");
    expect([...company!.scalars]).toEqual(["id"]);
    expect(company!.relations.size).toBe(0);
  });

  it("ManagedClient → {despachoCompanyId} por override + relación despachoCompany→Company", () => {
    const map = buildScopeMap([
      m("Company", [s("id")]),
      m("ManagedClient", [s("id"), s("companyId"), s("despachoCompanyId")]),
    ]);

    const managed = map.get("ManagedClient");
    expect([...managed!.scalars]).toEqual(["despachoCompanyId"]);
    expect(managed!.relations.get("despachoCompany")).toBe("Company");
  });

  it("hijo con relación a modelo NO tenant → no entra (User no acota nada)", () => {
    const child = m("Session", [s("id"), s("userId"), rel("user", "User")]);

    const map = buildScopeMap([m("User", [s("id")]), child]);

    expect(map.has("Session")).toBe(false);
  });

  it("hijo con VARIAS relaciones a padres tenant → recoge todas las FK", () => {
    const map = buildScopeMap([
      m("Transaction", [s("id"), s("companyId")]),
      m("Account", [s("id"), s("companyId")]),
      m("JournalEntry", [
        s("id"),
        s("transactionId"),
        rel("transaction", "Transaction"),
        s("accountId"),
        rel("account", "Account"),
      ]),
    ]);

    const je = map.get("JournalEntry");
    expect([...je!.scalars].sort()).toEqual(["accountId", "transactionId"]);
    expect([...je!.relations.keys()].sort()).toEqual(["account", "transaction"]);
  });

  it("modelo sin companyId, sin relaciones tenant y sin FK → queda FUERA (no se inventa ámbito)", () => {
    const map = buildScopeMap([m("PublicHolidayGlobal", [s("id"), s("date", "DateTime")])]);

    expect(map.has("PublicHolidayGlobal")).toBe(false);
  });

  it("un campo llamado companyId pero de tipo relación (kind=object) no convierte al modelo en tenant", () => {
    const map = buildScopeMap([m("Weird", [s("id"), rel("companyId", "Company")])]);

    expect(map.has("Weird")).toBe(false);
  });

  it("mapa vacío para una lista de modelos vacía", () => {
    expect(buildScopeMap([]).size).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. whereIsScoped — la función con más miga
// ══════════════════════════════════════════════════════════════════════════════

describe("whereIsScoped — escalares", () => {
  const invoice = spec(["companyId"]);

  it("{ companyId: 'x' } → acotado", () => {
    expect(whereIsScoped({ companyId: "x" }, invoice)).toBe(true);
  });

  it("{} → NO acotado", () => {
    expect(whereIsScoped({}, invoice)).toBe(false);
  });

  it("undefined / null → NO acotado (findMany sin where es el caso típico de fuga)", () => {
    expect(whereIsScoped(undefined, invoice)).toBe(false);
    expect(whereIsScoped(null, invoice)).toBe(false);
  });

  it("valor primitivo o función en lugar de objeto → NO acotado", () => {
    expect(whereIsScoped("companyId", invoice)).toBe(false);
    expect(whereIsScoped(42, invoice)).toBe(false);
    expect(whereIsScoped(true, invoice)).toBe(false);
  });

  it("companyId: null o undefined → NO acotado (presente pero sin valor no acota)", () => {
    expect(whereIsScoped({ companyId: null }, invoice)).toBe(false);
    expect(whereIsScoped({ companyId: undefined }, invoice)).toBe(false);
    expect(whereIsScoped({ companyId: undefined, status: "PAID" }, invoice)).toBe(false);
  });

  it("{ companyId: { in: [] } } → acotado: devuelve vacío, no es fuga (documentado)", () => {
    expect(whereIsScoped({ companyId: { in: [] } }, invoice)).toBe(true);
  });

  it("{ companyId: { in: ['a','b'] } } → acotado", () => {
    expect(whereIsScoped({ companyId: { in: ["a", "b"] } }, invoice)).toBe(true);
  });

  it("otras claves sin companyId → NO acotado por muchas que sean", () => {
    expect(whereIsScoped({ status: "PAID", deletedAt: null, total: { gt: 0 } }, invoice)).toBe(false);
  });

  it("clave de tenant distinta a companyId (Company → id) se respeta", () => {
    const company = spec(["id"]);
    expect(whereIsScoped({ id: "cmp-1" }, company)).toBe(true);
    expect(whereIsScoped({ companyId: "cmp-1" }, company)).toBe(false); // Company no tiene companyId
  });

  it("basta UNA de las claves del spec (JournalEntry: transactionId o accountId)", () => {
    const je = spec(["transactionId", "accountId"]);
    expect(whereIsScoped({ transactionId: "t1" }, je)).toBe(true);
    expect(whereIsScoped({ accountId: "a1" }, je)).toBe(true);
    expect(whereIsScoped({ description: "x" }, je)).toBe(false);
  });

  it("HIGH-1: { companyId: { not: 'x' } } NO acota — es TODAS las empresas menos una", () => {
    // Regresión de la auditoría ADR-044: la versión previa aceptaba la mera presencia
    // de la clave. Un filtro negado es lo contrario de acotar.
    expect(whereIsScoped({ companyId: { not: "x" } }, invoice)).toBe(false);
  });

  it("HIGH-1: notIn / startsWith / contains tampoco acotan", () => {
    expect(whereIsScoped({ companyId: { notIn: ["x"] } }, invoice)).toBe(false);
    // todos los CUID empiezan por "c": startsWith devuelve el sistema entero
    expect(whereIsScoped({ companyId: { startsWith: "c" } }, invoice)).toBe(false);
    expect(whereIsScoped({ companyId: { contains: "c1" } }, invoice)).toBe(false);
  });

  it("HIGH-1 (el caso silencioso): in/equals con undefined NO acotan — Prisma borra el predicado", () => {
    // Éste es el peligroso: no es intencional, es `where: { companyId: { in: ids } }`
    // con `ids` undefined por un bug aguas arriba. Prisma elimina el predicado y
    // devuelve TODAS las empresas, con toda la pinta de una consulta correcta.
    expect(whereIsScoped({ companyId: { in: undefined } }, invoice)).toBe(false);
    expect(whereIsScoped({ companyId: { equals: undefined } }, invoice)).toBe(false);
  });

  it("las formas que SÍ restringen siguen pasando (no se rompió la vía feliz)", () => {
    expect(whereIsScoped({ companyId: { equals: "c1" } }, invoice)).toBe(true);
    expect(whereIsScoped({ companyId: { in: ["c1", "c2"] } }, invoice)).toBe(true);
  });

  it("una clave de tenant que no acota no bloquea la evaluación del resto del where", () => {
    // `companyId: { not }` no acota, pero el AND hermano sí: el resultado es acotado.
    expect(
      whereIsScoped({ companyId: { not: "x" }, AND: [{ companyId: "c1" }] }, invoice),
    ).toBe(true);
  });

  it("companyId: '' (cadena vacía) cuenta como acotado — no filtra de más, devuelve vacío", () => {
    expect(whereIsScoped({ companyId: "" }, invoice)).toBe(true);
  });
});

describe("keyIsScoping — lista BLANCA de formas que restringen", () => {
  it("string literal → restringe", () => {
    expect(keyIsScoping("c1")).toBe(true);
  });

  it("string vacío → restringe (devuelve vacío, no es fuga)", () => {
    expect(keyIsScoping("")).toBe(true);
  });

  it.each<[string, unknown]>([
    ["equals con string", { equals: "c1" }],
    ["in con array", { in: ["c1"] }],
    ["in vacío — devuelve vacío, aceptado a propósito", { in: [] }],
    ["todos los operadores en lista blanca", { equals: "c1", in: ["c1"] }],
  ])("%s → restringe", (_caso, value) => {
    expect(keyIsScoping(value)).toBe(true);
  });

  it.each<[string, unknown]>([
    ["negación { not }", { not: "c1" }],
    ["negación de conjunto { notIn }", { notIn: ["c1"] }],
    ["prefijo { startsWith }: todos los CUID lo cumplen", { startsWith: "c" }],
    ["subcadena { contains }", { contains: "c1" }],
    ["sufijo { endsWith }", { endsWith: "1" }],
    ["comparador de rango { gt }", { gt: "a" }],
    ["operador que no filtra por sí solo { mode }", { mode: "insensitive" }],
    ["equals sin operando: Prisma borra el predicado", { equals: undefined }],
    ["in sin operando: ídem", { in: undefined }],
    ["equals con no-string", { equals: 42 }],
    ["mezcla: una sola forma no-blanca lo invalida", { equals: "c1", not: "c2" }],
    ["objeto de filtro vacío", {}],
  ])("%s → NO restringe", (_caso, value) => {
    expect(keyIsScoping(value)).toBe(false);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["undefined", undefined],
    ["número", 42],
    ["booleano", true],
    ["array suelto", ["c1"]],
  ])("%s → NO restringe", (_caso, value) => {
    expect(keyIsScoping(value)).toBe(false);
  });

  it("un operador FUTURO desconocido entra como 'no acota' (ruido), nunca como fuga", () => {
    // La política es lista blanca por forma: si Prisma añade `search`, `matches`…
    // el comportamiento por defecto debe ser el conservador.
    expect(keyIsScoping({ search: "c1" })).toBe(false);
    expect(keyIsScoping({ operadorInventado2030: "c1" })).toBe(false);
  });
});

describe("whereIsScoped — AND", () => {
  const invoice = spec(["companyId"]);

  it("array: basta UNA rama acotada", () => {
    expect(whereIsScoped({ AND: [{ status: "PAID" }, { companyId: "x" }] }, invoice)).toBe(true);
  });

  it("array: ninguna rama acotada → NO acotado", () => {
    expect(whereIsScoped({ AND: [{ status: "PAID" }, { total: { gt: 0 } }] }, invoice)).toBe(false);
  });

  it("objeto suelto (AND no-array) también se evalúa", () => {
    expect(whereIsScoped({ AND: { companyId: "x" } }, invoice)).toBe(true);
    expect(whereIsScoped({ AND: { status: "PAID" } }, invoice)).toBe(false);
  });

  it("AND vacío → NO acotado", () => {
    expect(whereIsScoped({ AND: [] }, invoice)).toBe(false);
  });

  it("AND anidado dentro de AND", () => {
    expect(
      whereIsScoped({ AND: [{ AND: [{ status: "X" }, { companyId: "c1" }] }] }, invoice),
    ).toBe(true);
  });

  it("companyId en el nivel raíz junto a un AND no acotado → acotado", () => {
    expect(whereIsScoped({ companyId: "c1", AND: [{ status: "X" }] }, invoice)).toBe(true);
  });
});

describe("whereIsScoped — OR (deben acotar TODAS las ramas)", () => {
  const invoice = spec(["companyId"]);

  it("OR con una rama sin companyId → NO acotado (la unión se escapa de la empresa)", () => {
    expect(whereIsScoped({ OR: [{ companyId: "a" }, { status: "X" }] }, invoice)).toBe(false);
  });

  it("OR con todas las ramas acotadas → acotado", () => {
    expect(whereIsScoped({ OR: [{ companyId: "a" }, { companyId: "b" }] }, invoice)).toBe(true);
  });

  it("OR vacío → NO acotado", () => {
    expect(whereIsScoped({ OR: [] }, invoice)).toBe(false);
  });

  it("OR no-array → NO acotado (forma inválida, no se asume nada)", () => {
    expect(whereIsScoped({ OR: { companyId: "a" } }, invoice)).toBe(false);
  });

  it("OR de 3 ramas con la última sin acotar → NO acotado", () => {
    expect(
      whereIsScoped(
        { OR: [{ companyId: "a" }, { companyId: "b" }, { status: "DRAFT" }] },
        invoice,
      ),
    ).toBe(false);
  });

  it("AND que contiene un OR con una rama libre: el OR no salva, pero otra rama del AND sí", () => {
    expect(
      whereIsScoped(
        { AND: [{ OR: [{ companyId: "a" }, { status: "X" }] }, { companyId: "a" }] },
        invoice,
      ),
    ).toBe(true);
  });

  it("solo un OR mal formado dentro de AND → NO acotado", () => {
    expect(
      whereIsScoped({ AND: [{ OR: [{ companyId: "a" }, { status: "X" }] }] }, invoice),
    ).toBe(false);
  });
});

describe("whereIsScoped — NOT", () => {
  const invoice = spec(["companyId"]);

  it("NOT nunca acota, ni siquiera si menciona companyId", () => {
    expect(whereIsScoped({ NOT: { companyId: "x" } }, invoice)).toBe(false);
    expect(whereIsScoped({ NOT: [{ companyId: "x" }] }, invoice)).toBe(false);
    expect(whereIsScoped({ NOT: { status: "VOID" } }, invoice)).toBe(false);
  });

  it("NOT junto a un companyId real sí acota (lo acota el companyId, no el NOT)", () => {
    expect(whereIsScoped({ companyId: "x", NOT: { status: "VOID" } }, invoice)).toBe(true);
  });
});

describe("whereIsScoped — relaciones anidadas", () => {
  const invoiceSpec = spec(["companyId"]);
  const childSpec = spec(["invoiceId"], [["invoice", "Invoice"]]);
  // lookup propio: estos tests no dependen del SCOPE_MAP real
  const lookup = (model: string): ScopeSpec | undefined =>
    model === "Invoice" ? invoiceSpec : undefined;

  it("where: { invoice: { companyId: 'x' } } → acotado", () => {
    expect(whereIsScoped({ invoice: { companyId: "x" } }, childSpec, lookup)).toBe(true);
  });

  it("where: { invoice: { status: 'PAID' } } → NO acotado (la mera presencia de la relación no basta)", () => {
    expect(whereIsScoped({ invoice: { status: "PAID" } }, childSpec, lookup)).toBe(false);
  });

  it("where: { invoiceId: 'inv-1' } → acotado por la FK directa", () => {
    expect(whereIsScoped({ invoiceId: "inv-1" }, childSpec, lookup)).toBe(true);
  });

  it("relación con AND/OR anidados dentro se evalúa recursivamente", () => {
    expect(
      whereIsScoped({ invoice: { AND: [{ companyId: "x" }] } }, childSpec, lookup),
    ).toBe(true);
    expect(
      whereIsScoped(
        { invoice: { OR: [{ companyId: "x" }, { status: "X" }] } },
        childSpec,
        lookup,
      ),
    ).toBe(false);
  });

  it("sintaxis explícita { invoice: { is: { companyId } } } → acotado", () => {
    expect(whereIsScoped({ invoice: { is: { companyId: "x" } } }, childSpec, lookup)).toBe(true);
  });

  it("{ invoice: { is: { status } } } → NO acotado (el is no salva un filtro que no acota)", () => {
    expect(whereIsScoped({ invoice: { is: { status: "PAID" } } }, childSpec, lookup)).toBe(false);
  });

  it("{ invoice: { isNot: { companyId } } } → NO acotado (niega, no restringe)", () => {
    expect(whereIsScoped({ invoice: { isNot: { companyId: "x" } } }, childSpec, lookup)).toBe(
      false,
    );
  });

  it("relación cuyo padre no resuelve en el lookup → NO acotado (no se asume)", () => {
    const orphan = spec([], [["invoice", "Desconocido"]]);
    expect(whereIsScoped({ invoice: { companyId: "x" } }, orphan, lookup)).toBe(false);
  });

  it("relación con valor null → NO acotado", () => {
    expect(whereIsScoped({ invoice: null }, childSpec, lookup)).toBe(false);
  });

  it("cadena de dos saltos: nieto → hijo → padre con companyId", () => {
    const grandChild = spec(["lineId"], [["line", "InvoiceLine"]]);
    const lineSpec = spec(["invoiceId"], [["invoice", "Invoice"]]);
    const deepLookup = (model: string): ScopeSpec | undefined =>
      model === "InvoiceLine" ? lineSpec : model === "Invoice" ? invoiceSpec : undefined;

    expect(
      whereIsScoped({ line: { invoice: { companyId: "x" } } }, grandChild, deepLookup),
    ).toBe(true);
    expect(
      whereIsScoped({ line: { invoice: { status: "X" } } }, grandChild, deepLookup),
    ).toBe(false);
  });

  it("usa el SCOPE_MAP real cuando no se pasa lookup (InvoiceTaxLine → Invoice)", () => {
    const real = SCOPE_MAP.get("InvoiceTaxLine")!;
    expect(whereIsScoped({ invoice: { companyId: "c1" } }, real)).toBe(true);
    expect(whereIsScoped({ invoice: { status: "PAID" } }, real)).toBe(false);
  });
});

describe("whereIsScoped — arrays y profundidad", () => {
  const invoice = spec(["companyId"]);

  it("array de wheres: acotado solo si TODOS los elementos acotan", () => {
    expect(whereIsScoped([{ companyId: "a" }, { companyId: "b" }], invoice)).toBe(true);
    expect(whereIsScoped([{ companyId: "a" }, { status: "X" }], invoice)).toBe(false);
    expect(whereIsScoped([], invoice)).toBe(false);
  });

  it("anidamiento absurdo (>8 niveles) no se cuelga ni lanza", () => {
    let deep: unknown = { companyId: "x" };
    for (let i = 0; i < 200; i++) deep = { AND: [deep] };

    const start = Date.now();
    let result: boolean | undefined;
    expect(() => {
      result = whereIsScoped(deep, invoice);
    }).not.toThrow();
    expect(typeof result).toBe("boolean");
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("corta en MAX_DEPTH: 8 niveles acotan, 9 ya no (fail-closed al pasarse de hondo)", () => {
    const nest = (levels: number): unknown => {
      let w: unknown = { companyId: "x" };
      for (let i = 0; i < levels; i++) w = { AND: [w] };
      return w;
    };

    expect(whereIsScoped(nest(8), invoice)).toBe(true);
    expect(whereIsScoped(nest(9), invoice)).toBe(false);
  });

  it("estructura con ciclo no provoca desbordamiento de pila (corta por profundidad)", () => {
    const cyclic: Record<string, unknown> = { status: "X" };
    cyclic.AND = [cyclic];

    expect(() => whereIsScoped(cyclic, invoice)).not.toThrow();
    expect(whereIsScoped(cyclic, invoice)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. createDataIsScoped
// ══════════════════════════════════════════════════════════════════════════════

describe("createDataIsScoped", () => {
  const invoice = spec(["companyId"]);

  it("todas las filas con companyId → acotado", () => {
    expect(
      createDataIsScoped([{ companyId: "c1", total: 1 }, { companyId: "c1", total: 2 }], invoice),
    ).toBe(true);
  });

  it("una sola fila sin companyId invalida el lote entero", () => {
    expect(
      createDataIsScoped(
        [{ companyId: "c1" }, { total: 2 }, { companyId: "c1" }],
        invoice,
      ),
    ).toBe(false);
  });

  it("array vacío → acotado (no crea nada, no hay fuga posible)", () => {
    expect(createDataIsScoped([], invoice)).toBe(true);
  });

  it("fila que no es objeto → NO acotado", () => {
    expect(createDataIsScoped(["fila"], invoice)).toBe(false);
    expect(createDataIsScoped([null], invoice)).toBe(false);
    expect(createDataIsScoped([undefined], invoice)).toBe(false);
    expect(createDataIsScoped([42], invoice)).toBe(false);
  });

  it("objeto suelto (no array) se trata como una fila", () => {
    expect(createDataIsScoped({ companyId: "c1" }, invoice)).toBe(true);
    expect(createDataIsScoped({ total: 5 }, invoice)).toBe(false);
  });

  it("data undefined/null → NO acotado (createMany sin data es sospechoso, no benigno)", () => {
    expect(createDataIsScoped(undefined, invoice)).toBe(false);
    expect(createDataIsScoped(null, invoice)).toBe(false);
  });

  it("companyId presente pero null/undefined → NO acotado", () => {
    expect(createDataIsScoped([{ companyId: null }], invoice)).toBe(false);
    expect(createDataIsScoped([{ companyId: undefined }], invoice)).toBe(false);
  });

  it("basta UNA de las claves del spec por fila (JournalEntry)", () => {
    const je = spec(["transactionId", "accountId"]);
    expect(createDataIsScoped([{ transactionId: "t1" }], je)).toBe(true);
    expect(createDataIsScoped([{ accountId: "a1" }], je)).toBe(true);
    expect(createDataIsScoped([{ amount: 10 }], je)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4-bis. uniqueWhereIsScoped — D-3-bis: se ESTRECHA la exención de fila única
// ══════════════════════════════════════════════════════════════════════════════
//
// Esta función nació de un incidente, no de un diseño, y conviene que el próximo
// que la lea sepa de cuál.
//
// D-3 eximía en bloque a findUnique/findUniqueOrThrow/update/delete/upsert con este
// argumento: «operan sobre una clave única (un CUID no es adivinable)». La premisa
// era falsa. `Expense.idempotencyKey` era `@unique` GLOBAL y `ExpenseService` hacía
// `findUnique({ where: { idempotencyKey } })` devolviendo la fila entera — pero ese
// valor lo elige el CLIENTE (`z.string().uuid()`). La empresa B recibía el gasto de A.
//
// El salto lógico estaba en el paréntesis: justificaba «clave PRIMARIA CUID» y la
// conclusión se aplicaba a «cualquier clave única». La redacción correcta no habla
// del formato del valor sino de su PROCEDENCIA: la PK la genera el SERVIDOR. El bug
// no ocurrió porque un UUID fuera adivinable; ocurrió porque lo eligió quien atacaba.
//
// Un falso POSITIVO aquí (dar por acotado lo que no lo está) reabre ese mismo IDOR,
// y esta extensión es la única capa que cubre el 100 % de las lecturas. De ahí que
// la tabla de abajo sea exhaustiva hasta el aburrimiento.

describe("uniqueWhereIsScoped — (1) la exención superviviente: `id` string en el where", () => {
  const invoice = spec(["companyId"]);

  it("{ id: 'inv-1' } → acotado: la PK es un CUID que emite el servidor, nadie la propone", () => {
    expect(uniqueWhereIsScoped({ id: "inv-1" }, invoice)).toBe(true);
  });

  // ── REGLA REVISADA el 2026-08-16 — los dos tests que siguen están INVERTIDOS ──
  //
  // Se conservan en su sitio, con su nombre anterior escrito, porque el valor de
  // esta pareja no es lo que afirma hoy sino que la regla CAMBIÓ y por qué. Hasta
  // esa fecha decían:
  //
  //   "{ id, idempotencyKey } → NO acotado: la exención exige que `id` sea la ÚNICA clave"
  //   "{ id, deletedAt: null } → NO acotado: mismo límite, aunque la 2.ª clave sea inocua"
  //
  // y se apoyaban en esta premisa: «Prisma podría resolver un where-unique de varias
  // claves por CUALQUIERA de ellas, así que una segunda clave elegida por el cliente
  // reabriría el IDOR». Esa premisa estaba DEDUCIDA, que es exactamente el vicio que
  // parió D-3-bis (allí se dedujo que «un CUID no es adivinable» eximía a cualquier
  // clave única). Ahora está VERIFICADA en el cliente generado — `.prisma/client/index.d.ts`
  // de @prisma/client 7.8.0, el de FECHA MÁS RECIENTE: hay dos clientes generados en
  // node_modules y el viejo es anterior a la migración, así que responde lo contrario:
  //
  //   ExpenseWhereUniqueInput = Prisma.AtLeast<{
  //     id?: string                                       ← selector
  //     transactionId?: string                            ← selector
  //     companyId_idempotencyKey?: …CompoundUniqueInput    ← selector
  //     AND?/OR?/NOT?: ExpenseWhereInput | …              ← FILTRO
  //     companyId?: StringFilter<"Expense"> | string      ← FILTRO
  //     …
  //   }, "id" | "transactionId" | "companyId_idempotencyKey">
  //
  // `AtLeast<O, K>` exige ≥1 de los selectores K; todo lo demás entra tipado como
  // `XFilter` y se conjuga con AND sobre la fila que el selector YA eligió. O sea:
  // las claves extra sólo pueden RESTRINGIR más, nunca alcanzar otra fila. Con un
  // `id` string presente, la fila está fijada por una PK que emite el servidor y
  // ninguna clave adicional puede moverla.
  //
  // El coste de la regla vieja tampoco era teórico: `{ id, deletedAt: null }` es el
  // patrón de soft-delete de medio repo, y reportarlo llenaba de falsos positivos
  // justo el inventario que D-7 necesita limpio. Un control que reporta lo correcto
  // acaba desactivado, y entonces no cubre nada.

  it("{ id, idempotencyKey } → ACOTADO: la 2.ª clave es un FILTRO conjugado con AND, no un selector alternativo", () => {
    expect(uniqueWhereIsScoped({ id: "inv-1", idempotencyKey: "k" }, invoice)).toBe(true);

    // El límite no se ha movido de sitio, sólo la premisa falsa: SIN el `id`, esa
    // misma clave elegida por el cliente sigue siendo el IDOR de D-3-bis.
    expect(uniqueWhereIsScoped({ idempotencyKey: "k" }, invoice)).toBe(false);
  });

  it("{ id, deletedAt: null } → ACOTADO: el soft-delete deja de ser un falso positivo del inventario D-7", () => {
    expect(uniqueWhereIsScoped({ id: "inv-1", deletedAt: null }, invoice)).toBe(true);
    // Mismo patrón, extremo a extremo por la vía de fila única.
    expect(
      assertViolation("Invoice", "update", { where: { id: "inv-1", deletedAt: null } }),
    ).toBeNull();
  });

  it("EL LÍMITE QUE SÍ QUEDA: `id` tiene que ser un string LITERAL — un filtro en `id` no pinta una sola fila", () => {
    // Aquí es donde la exención (1) se gana el sitio. Lo que la justifica es que el
    // valor lo emite el servidor y designa UNA fila; en cuanto `id` deja de ser un
    // string literal ya no designa una fila, sino un CONJUNTO, y el razonamiento de
    // arriba (la fila está fijada, los demás campos sólo restringen) se cae entero:
    //
    //   { id: { in: [...] } }  → tantas filas como el atacante quiera enumerar
    //   { id: 123 }            → ni siquiera es la forma del selector
    //
    // Es también el mutante más apetecible de `uniqueWhereIsScoped`: cambiar
    // `typeof obj.id === "string"` por `"id" in obj` parece equivalente y aceptaría
    // las dos primeras. Estas aserciones son las que lo matan.
    expect(uniqueWhereIsScoped({ id: { in: ["a", "b"] } }, invoice)).toBe(false);
    expect(uniqueWhereIsScoped({ id: { notIn: ["a"] } }, invoice)).toBe(false);
    expect(uniqueWhereIsScoped({ id: { equals: "inv-1" } }, invoice)).toBe(false);
    expect(uniqueWhereIsScoped({ id: { not: "inv-1" } }, invoice)).toBe(false);
    expect(uniqueWhereIsScoped({ id: ["a", "b"] }, invoice)).toBe(false);
    expect(uniqueWhereIsScoped({ id: 123 }, invoice)).toBe(false);
    expect(uniqueWhereIsScoped({ id: true }, invoice)).toBe(false);
    expect(uniqueWhereIsScoped({ id: null }, invoice)).toBe(false);
    expect(uniqueWhereIsScoped({ id: undefined }, invoice)).toBe(false);
    // (`{ id: "" }` sí pasa por (1). No se ancla aquí a propósito: no es una fuga
    // —no existe fila con PK vacía— y anclarlo pondría rojo un endurecimiento sano.)

    // Y no se cuela por la puerta de al lado: con un `id` que es filtro, el veredicto
    // depende de que haya un tenant DE VERDAD en el where, no del `id`.
    expect(uniqueWhereIsScoped({ id: { in: ["a"] }, companyId: "c1" }, invoice)).toBe(true);
    expect(uniqueWhereIsScoped({ id: { in: ["a"] }, deletedAt: null }, invoice)).toBe(false);

    // Extremo a extremo: un findUnique con `id` filtrado es VIOLACIÓN.
    expect(assertViolation("Invoice", "findUnique", { where: { id: { in: ["a"] } } })).toBe(
      "Invoice.findUnique por clave única sin companyId ni id",
    );
  });

  it("OJO con la asimetría de Company: ahí `id` ES el escalar de tenant, así que { id: { in } } sí acota", () => {
    // No es una excepción a la regla de arriba: no entra por la vía (1) —donde `id`
    // vale como PK del servidor— sino por la (2), donde `id` es la COLUMNA de tenant
    // (override self-id) y por tanto se juzga con keyIsScoping, que sí admite
    // `in`/`equals`. Filtrar por un conjunto de empresas propias acota; enumerar
    // PKs de facturas ajenas, no.
    const company = spec(["id"]);
    expect(uniqueWhereIsScoped({ id: { in: ["cmp-1", "cmp-2"] } }, company)).toBe(true);
    expect(uniqueWhereIsScoped({ id: { not: "cmp-1" } }, company)).toBe(false);
  });

  it("las claves con valor undefined no cuentan: { id, foo: undefined } → acotado", () => {
    // Prisma elimina los predicados `undefined`, así que el where EFECTIVO es { id }.
    expect(uniqueWhereIsScoped({ id: "inv-1", foo: undefined }, invoice)).toBe(true);
    expect(uniqueWhereIsScoped({ id: "inv-1", idempotencyKey: undefined }, invoice)).toBe(true);

    // NOTA DE MUTACIÓN (2026-08-16): borrar el `.filter((k) => obj[k] !== undefined)`
    // de `uniqueWhereIsScoped` NO pone roja esta suite. No es un hueco de cobertura:
    // el mutante es EQUIVALENTE. `keys` sólo se lee en el barrido (3), que ya descarta
    // los valores falsy con `if (!value || typeof value !== "object" …) continue`, así
    // que el filtro documenta la intención sin cambiar ningún veredicto. Se ancla aquí
    // el comportamiento observable, por si algún día esa guarda del bucle se toca.
    expect(
      uniqueWhereIsScoped(
        { nada: undefined, companyId_idempotencyKey: { companyId: "c1", idempotencyKey: "k" } },
        invoice,
      ),
    ).toBe(true);
    expect(uniqueWhereIsScoped({ nada: undefined, otro: { status: "PAID" } }, invoice)).toBe(false);
  });

  it("{} / undefined / null / array / primitivos → NO acotado", () => {
    expect(uniqueWhereIsScoped({}, invoice)).toBe(false);
    expect(uniqueWhereIsScoped(undefined, invoice)).toBe(false);
    expect(uniqueWhereIsScoped(null, invoice)).toBe(false);
    expect(uniqueWhereIsScoped([{ companyId: "c1" }], invoice)).toBe(false);
    expect(uniqueWhereIsScoped("inv-1", invoice)).toBe(false);
    expect(uniqueWhereIsScoped(42, invoice)).toBe(false);
  });
});

describe("uniqueWhereIsScoped — (2) el escalar de tenant en el where", () => {
  const invoice = spec(["companyId"]);

  it("{ companyId } → acotado", () => {
    expect(uniqueWhereIsScoped({ companyId: "c1" }, invoice)).toBe(true);
  });

  it("{ id, companyId } → acotado: son dos claves, pero una de ellas ES el tenant", () => {
    expect(uniqueWhereIsScoped({ id: "inv-1", companyId: "c1" }, invoice)).toBe(true);
  });

  it("HEREDA la lista blanca de keyIsScoping: { companyId: { not } } NO acota", () => {
    expect(uniqueWhereIsScoped({ companyId: { not: "c1" } }, invoice)).toBe(false);
    expect(uniqueWhereIsScoped({ companyId: { notIn: ["c1"] } }, invoice)).toBe(false);
    expect(uniqueWhereIsScoped({ companyId: { startsWith: "c" } }, invoice)).toBe(false);
  });

  it("HEREDA la lista blanca: { in: [...] } y { equals: str } acotan; con undefined, no", () => {
    expect(uniqueWhereIsScoped({ companyId: { in: ["c1"] } }, invoice)).toBe(true);
    expect(uniqueWhereIsScoped({ companyId: { equals: "c1" } }, invoice)).toBe(true);
    // El caso silencioso de HIGH-1: Prisma borra el predicado → todas las empresas.
    expect(uniqueWhereIsScoped({ companyId: { in: undefined } }, invoice)).toBe(false);
    expect(uniqueWhereIsScoped({ companyId: { equals: undefined } }, invoice)).toBe(false);
  });

  it("Company se acota por su propia PK: ahí `id` vale como tenant aunque no vaya solo", () => {
    const company = spec(["id"]);
    expect(uniqueWhereIsScoped({ id: "cmp-1", rif: "J-123" }, company)).toBe(true);
  });

  it("modelo hijo: la relación al padre acota igual que en whereIsScoped", () => {
    const childSpec = spec(["invoiceId"], [["invoice", "Invoice"]]);
    const lookup = (model: string): ScopeSpec | undefined =>
      model === "Invoice" ? invoice : undefined;

    expect(uniqueWhereIsScoped({ invoice: { companyId: "c1" } }, childSpec, lookup)).toBe(true);
    expect(uniqueWhereIsScoped({ invoiceId: "inv-1" }, childSpec, lookup)).toBe(true);
    expect(uniqueWhereIsScoped({ invoice: { status: "PAID" } }, childSpec, lookup)).toBe(false);
  });

  it("con el SCOPE_MAP real (sin lookup): InvoiceTaxLine → Invoice", () => {
    const real = SCOPE_MAP.get("InvoiceTaxLine")!;
    expect(uniqueWhereIsScoped({ invoice: { companyId: "c1" } }, real)).toBe(true);
    expect(uniqueWhereIsScoped({ invoice: { status: "PAID" } }, real)).toBe(false);
  });
});

describe("uniqueWhereIsScoped — (3) selector compuesto @@unique([companyId, …])", () => {
  const expense = spec(["companyId"]);

  it("{ companyId_idempotencyKey: { companyId, idempotencyKey } } → acotado", () => {
    // Forma canónica tras la migración 20260816_idempotency_key_company_scoped: el
    // companyId forma parte de la CLAVE, así que la fila ajena es inalcanzable por
    // construcción — no por la disciplina de quien escribe la query.
    expect(
      uniqueWhereIsScoped(
        { companyId_idempotencyKey: { companyId: "c1", idempotencyKey: "k" } },
        expense,
      ),
    ).toBe(true);
  });

  it("{ companyId_year_month: { companyId, year, month } } → acotado (correlativos Z-1)", () => {
    expect(
      uniqueWhereIsScoped(
        { companyId_year_month: { companyId: "c1", year: 2026, month: 8 } },
        expense,
      ),
    ).toBe(true);
  });

  it("selector compuesto SIN tenant → NO acotado", () => {
    expect(
      uniqueWhereIsScoped(
        { invoiceNumber_type: { invoiceNumber: "00001", type: "SALE" } },
        expense,
      ),
    ).toBe(false);
  });

  it("selector compuesto al que le FALTA el companyId → NO acotado", () => {
    expect(
      uniqueWhereIsScoped({ companyId_idempotencyKey: { idempotencyKey: "k" } }, expense),
    ).toBe(false);
  });

  it("el companyId de DENTRO del selector también pasa por keyIsScoping", () => {
    expect(
      uniqueWhereIsScoped(
        { companyId_idempotencyKey: { companyId: { not: "c1" }, idempotencyKey: "k" } },
        expense,
      ),
    ).toBe(false);
  });

  it("selector vacío, nulo, string o array → NO acotado", () => {
    expect(uniqueWhereIsScoped({ companyId_idempotencyKey: {} }, expense)).toBe(false);
    expect(uniqueWhereIsScoped({ companyId_idempotencyKey: null }, expense)).toBe(false);
    expect(uniqueWhereIsScoped({ companyId_idempotencyKey: "c1_k" }, expense)).toBe(false);
    expect(
      uniqueWhereIsScoped({ companyId_idempotencyKey: [{ companyId: "c1" }] }, expense),
    ).toBe(false);
  });

  it("se recorren TODAS las claves: basta un selector acotado entre varios", () => {
    expect(
      uniqueWhereIsScoped(
        {
          otro_selector: { a: 1 },
          companyId_idempotencyKey: { companyId: "c1", idempotencyKey: "k" },
        },
        expense,
      ),
    ).toBe(true);
  });

  it("APROXIMACIÓN CONOCIDA: cualquier objeto anidado con el tenant dentro cuenta", () => {
    // El barrido de (3) no distingue un selector compuesto de un objeto cualquiera:
    // mira si ALGÚN valor-objeto del where acota. Es una sobre-aceptación consciente
    // —más laxa que la forma real—, contenida por el sistema de tipos de Prisma, que
    // no admite claves arbitrarias en un where-unique. Queda anclada aquí para que
    // cualquier intento de endurecerlo rompa a la vista y no en silencio.
    expect(uniqueWhereIsScoped({ loQueSea: { companyId: "c1" } }, expense)).toBe(true);
  });
});

describe("uniqueWhereIsScoped — el caso REAL que obligó a estrechar la exención", () => {
  const expense = spec(["companyId"]);

  it("REGRESIÓN IDOR: { idempotencyKey } a secas → NO acotado (esa clave la elige el cliente)", () => {
    // ÉSTE es el bug. Con la exención vieja, esta consulta se daba por acotada y
    // pasaba sin ruido; devolvía la fila entera de OTRA empresa.
    expect(
      uniqueWhereIsScoped({ idempotencyKey: "8f14e45f-ceea-467a-9c0e-1f8b0b0f0a11" }, expense),
    ).toBe(false);
  });

  it("REGRESIÓN IDOR: tampoco vale envolver la clave del cliente en equals / in", () => {
    expect(uniqueWhereIsScoped({ idempotencyKey: { equals: "k" } }, expense)).toBe(false);
    expect(uniqueWhereIsScoped({ idempotencyKey: { in: ["k"] } }, expense)).toBe(false);
  });

  it("FK única GENERADA POR EL SERVIDOR (glTransactionId) → NO acotado: se reporta a propósito", () => {
    // De facto es segura. Aun así entra en el inventario de `report` en vez de
    // eximirse por analogía: preferimos afinar la lista con datos a repetir el
    // razonamiento que abrió el agujero. Está documentado en el JSDoc de la función.
    expect(uniqueWhereIsScoped({ glTransactionId: "t1" }, expense)).toBe(false);
  });

  it("ninguna otra clave única de negocio exime (referenceNumber, controlNumber…)", () => {
    expect(uniqueWhereIsScoped({ referenceNumber: "DIST-000001" }, expense)).toBe(false);
    expect(uniqueWhereIsScoped({ controlNumber: "00-00000001" }, expense)).toBe(false);
    expect(uniqueWhereIsScoped({ rif: "J-12345678-9" }, expense)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. assertViolation
// ══════════════════════════════════════════════════════════════════════════════

describe("assertViolation", () => {
  it("model undefined ($queryRaw, $connect…) → null: no hay nada que inspeccionar", () => {
    expect(assertViolation(undefined, "findMany", {})).toBeNull();
  });

  it("modelo fuera del SCOPE_MAP → null", () => {
    expect(assertViolation("User", "findMany", {})).toBeNull();
    expect(assertViolation("ModeloQueNoExiste", "findMany", {})).toBeNull();
  });

  it("findMany sobre modelo tenant sin where → VIOLACIÓN", () => {
    const violation = assertViolation("Invoice", "findMany", {});
    expect(violation).toBeTruthy();
    expect(violation).toContain("Invoice");
    expect(violation).toContain("findMany");
    expect(violation).toContain("companyId");
  });

  it("findMany sin args en absoluto → VIOLACIÓN (args undefined no es excusa)", () => {
    expect(assertViolation("Invoice", "findMany", undefined)).toBeTruthy();
    expect(assertViolation("Invoice", "findMany", null)).toBeTruthy();
  });

  it("findMany con where.companyId → null", () => {
    expect(assertViolation("Invoice", "findMany", { where: { companyId: "c1" } })).toBeNull();
  });

  it("findMany con where sin companyId → VIOLACIÓN", () => {
    expect(assertViolation("Invoice", "findMany", { where: { status: "PAID" } })).toBeTruthy();
  });

  it.each(["findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy", "updateMany", "updateManyAndReturn", "deleteMany"])(
    "%s es multi-fila: sin companyId → VIOLACIÓN, con companyId → null",
    (op) => {
      expect(assertViolation("Invoice", op, { where: {} })).toBeTruthy();
      expect(assertViolation("Invoice", op, { where: { companyId: "c1" } })).toBeNull();
    },
  );

  // ── D-3-bis: aquí vivía la exención en bloque, y se ha revertido ────────────
  //
  // Hasta 2026-08-16 este punto afirmaba lo contrario, con este nombre:
  //   "%s está EXENTA por diseño (clave única, sin barrido cross-tenant) → null sin companyId"
  // y comprobaba que `assertViolation("Invoice", op, {})` devolvía null.
  //
  // La decisión se revirtió con un contraejemplo real, no por gusto: la premisa del
  // ADR («un CUID no es adivinable») justificaba la clave PRIMARIA y se aplicó a
  // CUALQUIER clave única. `Expense.idempotencyKey` era `@unique` y lo elegía el
  // cliente (`z.string().uuid()`): `findUnique({ where: { idempotencyKey } })`
  // devolvía a la empresa B el gasto de A. Lo que exime no es el formato del valor
  // sino su PROCEDENCIA — la PK la genera el servidor.
  //
  // Sobrevive sólo lo que la premisa justificaba de verdad, y se invierte el resto.

  it.each(UNIQUE_OPS)(
    "D-3-bis: %s con where { id } a secas SIGUE exenta — la PK la genera el servidor",
    (op) => {
      expect(assertViolation("Invoice", op, { where: { id: "inv-1" } })).toBeNull();
    },
  );

  it.each(UNIQUE_OPS)(
    "D-3-bis: %s por una clave única ELEGIDA POR EL CLIENTE → VIOLACIÓN (antes pasaba)",
    (op) => {
      const violation = assertViolation("Expense", op, {
        where: { idempotencyKey: "8f14e45f-ceea-467a-9c0e-1f8b0b0f0a11" },
      });
      expect(violation).toBeTruthy();
      expect(violation).toContain("Expense");
      expect(violation).toContain(op);
      expect(violation).toContain("companyId");
    },
  );

  it.each(UNIQUE_OPS)(
    "D-3-bis: %s con el selector compuesto companyId_idempotencyKey → null",
    (op) => {
      expect(
        assertViolation("Expense", op, {
          where: { companyId_idempotencyKey: { companyId: "c1", idempotencyKey: "k" } },
        }),
      ).toBeNull();
    },
  );

  it.each(UNIQUE_OPS)("D-3-bis: %s sin where en absoluto → VIOLACIÓN", (op) => {
    expect(assertViolation("Invoice", op, {})).toBeTruthy();
    expect(assertViolation("Invoice", op, undefined)).toBeTruthy();
    expect(assertViolation("Invoice", op, { where: {} })).toBeTruthy();
  });

  it("D-3-bis: el mensaje distingue la vía de fila única y nombra modelo, operación e id", () => {
    expect(assertViolation("Expense", "findUnique", { where: { idempotencyKey: "k" } })).toBe(
      "Expense.findUnique por clave única sin companyId ni id",
    );
    // ...y NO se confunde con el mensaje de las multi-fila, que apunta al `where`.
    expect(assertViolation("Expense", "findMany", { where: { idempotencyKey: "k" } })).toBe(
      "Expense.findMany sin companyId en where",
    );
  });

  it("D-3-bis: en Company el mensaje NO se duplica — su escalar de tenant ya ES `id`", () => {
    // Verruga corregida el 2026-08-16. El texto se componía siempre como
    // `${expected} ni id`, y Company tiene el override self-id (expected === "id"),
    // así que salía "Company.findUnique por clave única sin id ni id": un mensaje que
    // manda a buscar el bug a la extensión en vez de al call-site, que es donde está.
    expect(assertViolation("Company", "findUnique", { where: { rif: "J-12345678-9" } })).toBe(
      "Company.findUnique por clave única sin id",
    );
    // El subrayado del defecto: la cadena duplicada NO puede reaparecer. (El literal
    // tiene que ser "id ni id" — con "ni id ni" este expect sería verde también con
    // la verruga puesta, o sea un test incapaz de fallar.)
    expect(assertViolation("Company", "delete", { where: { rif: "J-12345678-9" } })).not.toContain(
      "id ni id",
    );
    // Con la PK sí presente no hay nada que reportar (vía (1) y vía (2) a la vez).
    expect(assertViolation("Company", "findUnique", { where: { id: "cmp-1" } })).toBeNull();

    // El resto de modelos conserva las DOS claves en el mensaje, incluido el otro
    // override, cuyo escalar no se llama companyId.
    expect(assertViolation("ManagedClient", "findUnique", { where: { rif: "J-12345678-9" } })).toBe(
      "ManagedClient.findUnique por clave única sin despachoCompanyId ni id",
    );
    expect(
      assertViolation("ManagedClient", "findUnique", { where: { despachoCompanyId: "d1" } }),
    ).toBeNull();
  });

  it("D-3-bis: el modelo hijo también queda cubierto por la vía de fila única", () => {
    expect(
      assertViolation("InvoiceTaxLine", "update", { where: { invoiceId: "inv-1" } }),
    ).toBeNull();
    const violation = assertViolation("InvoiceTaxLine", "update", {
      where: { luxuryGroupId: "g1" },
    });
    expect(violation).toContain("InvoiceTaxLine.update");
    expect(violation).toContain("invoiceId");
  });

  it("operaciones no vigiladas (create, findRaw…) → null", () => {
    expect(assertViolation("Invoice", "create", { data: { total: 1 } })).toBeNull();
    expect(assertViolation("Invoice", "findRaw", {})).toBeNull();
    expect(assertViolation("Invoice", "", {})).toBeNull();
  });

  it.each(["createMany", "createManyAndReturn"])("%s mira data, no where", (op) => {
    // data acotada, sin where → OK
    expect(assertViolation("Invoice", op, { data: [{ companyId: "c1" }] })).toBeNull();
    // where acotado pero data sin tenant → VIOLACIÓN (el where no pinta nada aquí)
    const violation = assertViolation("Invoice", op, {
      where: { companyId: "c1" },
      data: [{ total: 5 }],
    });
    expect(violation).toBeTruthy();
    expect(violation).toContain("en data");
  });

  it("el mensaje nombra modelo, operación y la clave esperada", () => {
    expect(assertViolation("Invoice", "findMany", {})).toBe(
      "Invoice.findMany sin companyId en where",
    );
    expect(assertViolation("Invoice", "createMany", { data: [{}] })).toBe(
      "Invoice.createMany sin companyId en data",
    );
  });

  it("modelo hijo (InvoiceTaxLine): acotar por invoiceId o por la relación basta", () => {
    expect(assertViolation("InvoiceTaxLine", "findMany", { where: { invoiceId: "i1" } })).toBeNull();
    expect(
      assertViolation("InvoiceTaxLine", "findMany", { where: { invoice: { companyId: "c1" } } }),
    ).toBeNull();
    const violation = assertViolation("InvoiceTaxLine", "findMany", { where: { taxType: "IVA" } });
    expect(violation).toContain("InvoiceTaxLine.findMany");
    expect(violation).toContain("invoiceId");
  });

  it("Company se acota por su propia PK (policy self-id)", () => {
    expect(assertViolation("Company", "findMany", { where: { id: "cmp-1" } })).toBeNull();
    expect(assertViolation("Company", "findMany", { where: { rif: "J-123" } })).toBeTruthy();
  });

  it("ManagedClient se acota por despachoCompanyId, NO por companyId", () => {
    expect(
      assertViolation("ManagedClient", "findMany", { where: { despachoCompanyId: "d1" } }),
    ).toBeNull();
    expect(assertViolation("ManagedClient", "findMany", { where: { companyId: "c1" } })).toBeTruthy();
  });

  it("caso real de fuga: OR entre 'mis facturas' y 'las públicas' → VIOLACIÓN", () => {
    expect(
      assertViolation("Invoice", "findMany", {
        where: { OR: [{ companyId: "c1" }, { isPublic: true }] },
      }),
    ).toBeTruthy();
  });

  it("HIGH-1 extremo a extremo: findMany con companyId negado → VIOLACIÓN", () => {
    expect(
      assertViolation("Invoice", "findMany", { where: { companyId: { not: "c1" } } }),
    ).toBeTruthy();
    expect(
      assertViolation("Invoice", "findMany", { where: { companyId: { in: undefined } } }),
    ).toBeTruthy();
    expect(
      assertViolation("Invoice", "findMany", { where: { companyId: { in: ["c1"] } } }),
    ).toBeNull();
  });

  it("Employee (R1 nómina, cobertura RLS 0 %) queda cubierto", () => {
    expect(assertViolation("Employee", "findMany", {})).toBeTruthy();
    expect(assertViolation("Employee", "findMany", { where: { companyId: "c1" } })).toBeNull();
  });
});

describe("catálogos de operaciones", () => {
  it("SCOPED_OPERATIONS contiene exactamente las multi-fila de ADR-044 D-3", () => {
    expect([...SCOPED_OPERATIONS].sort()).toEqual(
      [
        "aggregate",
        "count",
        "deleteMany",
        "findFirst",
        "findFirstOrThrow",
        "findMany",
        "groupBy",
        "updateMany",
        "updateManyAndReturn",
      ].sort(),
    );
  });

  it("UNIQUE_ROW_OPERATIONS contiene exactamente las cinco de fila única (D-3-bis)", () => {
    // Confronta la lista con la que alimenta los it.each de esta suite: si alguien
    // saca una operación del catálogo de producción, los casos no desaparecen en
    // silencio — este test se pone rojo primero.
    expect([...UNIQUE_ROW_OPERATIONS].sort()).toEqual([...UNIQUE_OPS].sort());
  });

  it("D-3-bis: las cinco de fila única YA NO son un hueco — están vigiladas, por otra vía", () => {
    // Este test afirmaba antes "NO están vigiladas (decisión deliberada del ADR)" y
    // ahí se acababa la historia. Siguen fuera de SCOPED_OPERATIONS —no son multi-fila
    // y se juzgan con uniqueWhereIsScoped, no con whereIsScoped—, pero ya no pasan
    // sin que nadie las mire.
    for (const op of UNIQUE_OPS) {
      expect(SCOPED_OPERATIONS.has(op)).toBe(false);
      expect(UNIQUE_ROW_OPERATIONS.has(op)).toBe(true);
      expect(assertViolation("Invoice", op, { where: { controlNumber: "00-1" } })).toBeTruthy();
    }
  });

  it("`create` sigue fuera de los tres catálogos: no barre nada y su tenant va en data", () => {
    expect(SCOPED_OPERATIONS.has("create")).toBe(false);
    expect(UNIQUE_ROW_OPERATIONS.has("create")).toBe(false);
    expect(CREATE_MANY_OPERATIONS.has("create")).toBe(false);
  });

  it("CREATE_MANY_OPERATIONS cubre createMany y createManyAndReturn", () => {
    expect([...CREATE_MANY_OPERATIONS].sort()).toEqual(["createMany", "createManyAndReturn"]);
  });

  it("los tres catálogos son disjuntos dos a dos (cada op se juzga por UNA sola vía)", () => {
    // Si una operación cayera en dos catálogos, el orden de los `if` de
    // assertViolation decidiría en silencio cuál gana. No debe poder pasar.
    for (const op of CREATE_MANY_OPERATIONS) {
      expect(SCOPED_OPERATIONS.has(op)).toBe(false);
      expect(UNIQUE_ROW_OPERATIONS.has(op)).toBe(false);
    }
    for (const op of UNIQUE_ROW_OPERATIONS) {
      expect(SCOPED_OPERATIONS.has(op)).toBe(false);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. SCOPE_MAP real — derivado del DMMF de verdad
// ══════════════════════════════════════════════════════════════════════════════

describe("SCOPE_MAP (DMMF real)", () => {
  it("cubre 89 modelos: las mismas 89 tablas que tienen RLS (verify-rls.mjs)", () => {
    // +1 el 2026-08-29: OvertimeEntry (registro de horas extraordinarias,
    // LOTTT Art. 183). El conteo se mueve a la vez que verify-rls.mjs.
    expect(SCOPE_MAP.size).toBe(89);
  });

  it("User NO está: es global por diseño", () => {
    expect(SCOPE_MAP.has("User")).toBe(false);
  });

  it.each(["Invoice", "Employee", "PayrollRun"])("%s → { companyId }", (model) => {
    expect([...SCOPE_MAP.get(model)!.scalars]).toEqual(["companyId"]);
  });

  it("JournalEntry → transactionId + accountId (no tiene companyId propio)", () => {
    const je = SCOPE_MAP.get("JournalEntry")!;
    expect(je.scalars.has("transactionId")).toBe(true);
    expect(je.scalars.has("accountId")).toBe(true);
    expect(je.scalars.has("companyId")).toBe(false);
    expect(je.relations.get("transaction")).toBe("Transaction");
    expect(je.relations.get("account")).toBe("Account");
  });

  it("InvoiceTaxLine → invoiceId", () => {
    expect([...SCOPE_MAP.get("InvoiceTaxLine")!.scalars]).toEqual(["invoiceId"]);
  });

  it("Company → id (override self-id)", () => {
    expect([...SCOPE_MAP.get("Company")!.scalars]).toEqual(["id"]);
  });

  it("ManagedClient → despachoCompanyId (override)", () => {
    expect([...SCOPE_MAP.get("ManagedClient")!.scalars]).toEqual(["despachoCompanyId"]);
  });

  it.each([
    "OrderItem",
    "QuotationItem",
    "PaymentBatchLine",
    "InventoryMovementLot",
    "InventoryMovementSerial",
    "IncomeDistributionLine",
    "IncomeDistributionAudit",
    "SubscriptionPayment",
    "PlanChangeRequest",
  ])("modelo hijo %s está cubierto vía su padre", (model) => {
    const s = SCOPE_MAP.get(model);
    expect(s, `${model} quedó fuera del mapa`).toBeDefined();
    expect(s!.scalars.size).toBeGreaterThan(0);
  });

  // ─── Guard anti-regresión ──────────────────────────────────────────────────
  //
  // Un modelo hijo cuya FK NO siga la convención `<relación>Id` sale del mapa en
  // SILENCIO: `assertViolation` devolvería null para él y sus findMany sin ámbito
  // pasarían inadvertidos. Este bloque es el que debe romper RUIDOSAMENTE.

  it("GUARD: el único modelo del datamodel fuera del mapa es User", () => {
    const fuera = Prisma.dmmf.datamodel.models
      .map((model) => model.name)
      .filter((name) => !SCOPE_MAP.has(name));

    expect(
      fuera,
      `Modelos sin ámbito derivable: ${fuera.join(", ")}. ` +
        "Si acabas de añadir un modelo, o le falta companyId, o su FK no sigue la " +
        "convención <relación>Id. Mientras esté fuera del mapa, la aserción de " +
        "ADR-044 D-3 NO lo protege: sus findMany sin companyId pasan en silencio.",
    ).toEqual(["User"]);
  });

  it("GUARD: todo modelo del mapa sin companyId tiene al menos un escalar resoluble", () => {
    const rotos: string[] = [];
    for (const [name, scopeSpec] of SCOPE_MAP) {
      if (scopeSpec.scalars.has("companyId")) continue;
      if (scopeSpec.scalars.size === 0) rotos.push(name);
    }
    expect(rotos, `Modelos con spec vacía: ${rotos.join(", ")}`).toEqual([]);
  });

  it("GUARD: cada escalar del mapa existe de verdad como columna en el DMMF", () => {
    const inexistentes: string[] = [];
    for (const [name, scopeSpec] of SCOPE_MAP) {
      const model = Prisma.dmmf.datamodel.models.find((mm) => mm.name === name);
      const scalarNames = new Set(
        (model?.fields ?? []).filter((f) => f.kind === "scalar").map((f) => f.name),
      );
      for (const key of scopeSpec.scalars) {
        if (!scalarNames.has(key)) inexistentes.push(`${name}.${key}`);
      }
    }
    expect(
      inexistentes,
      `Claves de ámbito que no son columnas reales: ${inexistentes.join(", ")}`,
    ).toEqual([]);
  });

  it("GUARD: todo padre referenciado por una relación del mapa está a su vez en el mapa", () => {
    const huérfanas: string[] = [];
    for (const [name, scopeSpec] of SCOPE_MAP) {
      for (const [relName, parent] of scopeSpec.relations) {
        if (!SCOPE_MAP.has(parent)) huérfanas.push(`${name}.${relName}→${parent}`);
      }
    }
    expect(
      huérfanas,
      `Relaciones a modelos sin ámbito: ${huérfanas.join(", ")}`,
    ).toEqual([]);
  });

  it("GUARD: todo modelo del mapa acepta un where acotado por alguna de sus claves", () => {
    // Si esto falla, hay un modelo cuyo spec es inalcanzable desde whereIsScoped:
    // toda consulta suya sería una violación permanente (ruido infinito en report,
    // app caída en enforce).
    const inalcanzables: string[] = [];
    for (const [name, scopeSpec] of SCOPE_MAP) {
      const key = [...scopeSpec.scalars][0];
      if (!whereIsScoped({ [key]: "valor" }, scopeSpec)) inalcanzables.push(name);
    }
    expect(inalcanzables).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. unscoped / currentUnscopedReason (AsyncLocalStorage)
// ══════════════════════════════════════════════════════════════════════════════

describe("unscoped / currentUnscopedReason", () => {
  it("fuera de todo unscoped → undefined", () => {
    expect(currentUnscopedReason()).toBeUndefined();
  });

  it("dentro del callback devuelve el motivo declarado", async () => {
    await unscoped("cron:billing-lifecycle", async () => {
      expect(currentUnscopedReason()).toBe("cron:billing-lifecycle");
    });
  });

  it("devuelve el valor del callback", async () => {
    const result = await unscoped("health", async () => ({ ok: true }));
    expect(result).toEqual({ ok: true });
  });

  it("el contexto sobrevive a un await (AsyncLocalStorage, no variable global)", async () => {
    await unscoped("webhook:nowpayments", async () => {
      expect(currentUnscopedReason()).toBe("webhook:nowpayments");
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(currentUnscopedReason()).toBe("webhook:nowpayments");
      await Promise.resolve();
      expect(currentUnscopedReason()).toBe("webhook:nowpayments");
    });
  });

  it("sobrevive a varios niveles de funciones async encadenadas", async () => {
    const nivel3 = async () => currentUnscopedReason();
    const nivel2 = async () => {
      await new Promise((r) => setImmediate(r));
      return nivel3();
    };
    const nivel1 = async () => nivel2();

    const reason = await unscoped("seed", nivel1);
    expect(reason).toBe("seed");
  });

  it("anidado: gana el interior y se restaura el exterior al salir", async () => {
    await unscoped("auth-bootstrap", async () => {
      expect(currentUnscopedReason()).toBe("auth-bootstrap");

      await unscoped("company-create", async () => {
        expect(currentUnscopedReason()).toBe("company-create");
      });

      expect(currentUnscopedReason()).toBe("auth-bootstrap");
    });
  });

  it("se restaura a undefined al salir del bloque", async () => {
    await unscoped("cron:plan-change", async () => {
      expect(currentUnscopedReason()).toBe("cron:plan-change");
    });
    expect(currentUnscopedReason()).toBeUndefined();
  });

  it("si el callback lanza, el contexto se limpia igual y la excepción se propaga", async () => {
    await expect(
      unscoped("webhook:qstash", async () => {
        expect(currentUnscopedReason()).toBe("webhook:qstash");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(currentUnscopedReason()).toBeUndefined();
  });

  it("si el interior lanza y el exterior lo captura, el exterior conserva su motivo", async () => {
    await unscoped("despacho:managed-clients", async () => {
      try {
        await unscoped("health", async () => {
          throw new Error("fallo interno");
        });
      } catch {
        // capturado a propósito
      }
      expect(currentUnscopedReason()).toBe("despacho:managed-clients");
    });
    expect(currentUnscopedReason()).toBeUndefined();
  });

  it("dos bloques concurrentes no se pisan el motivo", async () => {
    const observado: string[] = [];

    await Promise.all([
      unscoped("health", async () => {
        await new Promise((r) => setTimeout(r, 15));
        observado.push(`health:${currentUnscopedReason()}`);
      }),
      unscoped("seed", async () => {
        await new Promise((r) => setTimeout(r, 5));
        observado.push(`seed:${currentUnscopedReason()}`);
      }),
    ]);

    expect(observado.sort()).toEqual(["health:health", "seed:seed"]);
    expect(currentUnscopedReason()).toBeUndefined();
  });
});

// ==============================================================================
// 8. createTenantAssertExtension — el handler, sin BD ni PrismaClient
// ==============================================================================

type AllOperationsParams = {
  model?: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
};
type AllOperationsHandler = (params: AllOperationsParams) => Promise<unknown>;

/**
 * Extrae el handler `$allOperations` de la extensión sin instanciar PrismaClient.
 *
 * `Prisma.defineExtension` devuelve, para un objeto literal, `(client) => client.$extends(ext)`.
 * Se le pasa un cliente falso cuyo `$extends` devuelve la definición tal cual, y con eso
 * se recupera el handler. Si Prisma cambiara esa forma, esto LANZA con un mensaje
 * explicativo — nunca deja pasar la suite en verde sin haber ejercitado nada.
 */
function handlerFor(mode: TenantAssertMode): AllOperationsHandler {
  const defined: unknown = createTenantAssertExtension(mode);
  const ext =
    typeof defined === "function"
      ? (defined as (client: { $extends: (e: unknown) => unknown }) => unknown)({
          $extends: (e: unknown) => e,
        })
      : defined;

  const handler = (ext as { query?: { $allModels?: { $allOperations?: AllOperationsHandler } } })
    ?.query?.$allModels?.$allOperations;

  if (typeof handler !== "function") {
    throw new Error(
      "No se pudo extraer $allOperations: cambió la forma de Prisma.defineExtension. " +
        "Arreglar este helper ANTES de dar por buena la extensión.",
    );
  }
  return handler;
}

describe("createTenantAssertExtension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const violating = (query: (args: unknown) => Promise<unknown>): AllOperationsParams => ({
    model: "Invoice",
    operation: "findMany",
    args: { where: { status: "PAID" } },
    query,
  });

  it("el helper de extracción obtiene un handler real (si no, esta suite no prueba nada)", () => {
    expect(typeof handlerFor("report")).toBe("function");
  });

  it("enforce + violación → LANZA y la consulta NUNCA llega a la BD", async () => {
    const query = vi.fn().mockResolvedValue(["fila-de-otra-empresa"]);
    const handler = handlerFor("enforce");

    await expect(handler(violating(query))).rejects.toThrow(TENANT_ASSERT_MESSAGE);
    expect(query).not.toHaveBeenCalled();
  });

  it("enforce + consulta acotada → pasa, con los MISMOS args y devolviendo su resultado", async () => {
    const args = { where: { companyId: "c1" }, take: 10 };
    const query = vi.fn().mockResolvedValue([{ id: "inv-1" }]);
    const handler = handlerFor("enforce");

    const result = await handler({ model: "Invoice", operation: "findMany", args, query });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(args);
    expect(result).toEqual([{ id: "inv-1" }]);
  });

  it("report + violación → NO lanza, deja pasar la consulta y avisa a Sentry con el tag", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const handler = handlerFor("report");

    await expect(handler(violating(query))).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = vi.mocked(Sentry.captureMessage).mock.calls[0];
    expect(message).toContain("tenant-assert:");
    expect(message).toContain("Invoice.findMany");
    expect(options).toMatchObject({
      level: "warning",
      tags: { tenant_assert_violation: "Invoice.findMany" },
    });
  });

  it("report + consulta acotada → ni Sentry ni ruido", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const handler = handlerFor("report");

    await handler({
      model: "Invoice",
      operation: "findMany",
      args: { where: { companyId: "c1" } },
      query,
    });

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("off → válvula de emergencia: ni afirma ni instrumenta", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const handler = handlerFor("off");

    await expect(handler(violating(query))).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
  });

  it("dentro de unscoped(): ni siquiera enforce lanza, y queda breadcrumb con el motivo", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const handler = handlerFor("enforce");

    await unscoped("cron:billing-lifecycle", async () => {
      await expect(handler(violating(query))).resolves.toEqual([]);
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "tenant-assert",
        level: "info",
        message: "unscoped: Invoice.findMany",
        data: { unscoped_reason: "cron:billing-lifecycle" },
      }),
    );
  });

  it("fuera de unscoped(), el mismo handler vuelve a lanzar (el escape no se pega)", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const handler = handlerFor("enforce");

    await unscoped("health", async () => {
      await handler(violating(query));
    });

    await expect(handler(violating(query))).rejects.toThrow(TENANT_ASSERT_MESSAGE);
  });

  it("operación sin model ($queryRaw, $connect…) pasa sin ruido — límite conocido D-8.2", async () => {
    const query = vi.fn().mockResolvedValue(1);
    const handler = handlerFor("enforce");

    await expect(
      handler({ model: undefined, operation: "$queryRaw", args: {}, query }),
    ).resolves.toBe(1);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("D-3-bis: findUnique por where { id } pasa en enforce (la PK la genera el servidor)", async () => {
    const query = vi.fn().mockResolvedValue({ id: "inv-1" });
    const handler = handlerFor("enforce");

    await expect(
      handler({
        model: "Invoice",
        operation: "findUnique",
        args: { where: { id: "inv-1" } },
        query,
      }),
    ).resolves.toEqual({ id: "inv-1" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("D-3-bis: findUnique por idempotencyKey del CLIENTE → LANZA y no llega a la BD", async () => {
    // El IDOR de `Expense.idempotencyKey`, extremo a extremo a través del handler.
    // Antes de D-3-bis esta llamada devolvía la fila de la otra empresa.
    const query = vi.fn().mockResolvedValue({ id: "exp-de-otra-empresa" });
    const handler = handlerFor("enforce");

    await expect(
      handler({
        model: "Expense",
        operation: "findUnique",
        args: { where: { idempotencyKey: "8f14e45f-ceea-467a-9c0e-1f8b0b0f0a11" } },
        query,
      }),
    ).rejects.toThrow(TENANT_ASSERT_MESSAGE);
    expect(query).not.toHaveBeenCalled();
  });

  it("D-3-bis: un delete por clave única del cliente tampoco llega a la BD", async () => {
    const query = vi.fn().mockResolvedValue({ id: "exp-1" });
    const handler = handlerFor("enforce");

    await expect(
      handler({
        model: "Expense",
        operation: "delete",
        args: { where: { idempotencyKey: "k" } },
        query,
      }),
    ).rejects.toThrow(TENANT_ASSERT_MESSAGE);
    expect(query).not.toHaveBeenCalled();
  });

  it("D-3-bis: el selector compuesto companyId_idempotencyKey pasa en enforce", async () => {
    const query = vi.fn().mockResolvedValue(null);
    const handler = handlerFor("enforce");

    await expect(
      handler({
        model: "Expense",
        operation: "upsert",
        args: {
          where: { companyId_idempotencyKey: { companyId: "c1", idempotencyKey: "k" } },
          create: { companyId: "c1" },
          update: {},
        },
        query,
      }),
    ).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("D-3-bis: en report la violación de fila única se instrumenta con su propio tag", async () => {
    const query = vi.fn().mockResolvedValue({ id: "exp-1" });
    const handler = handlerFor("report");

    await handler({
      model: "Expense",
      operation: "findUnique",
      args: { where: { idempotencyKey: "k" } },
      query,
    });

    expect(query).toHaveBeenCalledTimes(1); // report NO bloquea
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = vi.mocked(Sentry.captureMessage).mock.calls[0];
    expect(message).toContain("por clave única");
    expect(options).toMatchObject({
      tags: { tenant_assert_violation: "Expense.findUnique" },
    });
  });

  it("propaga el error de la consulta subyacente sin enmascararlo", async () => {
    const query = vi.fn().mockRejectedValue(new Error("P2002"));
    const handler = handlerFor("report");

    await expect(
      handler({
        model: "Invoice",
        operation: "findMany",
        args: { where: { companyId: "c1" } },
        query,
      }),
    ).rejects.toThrow("P2002");
  });

  it("fuera de producción, la violación también se ve en consola (bucle de dev)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await handlerFor("report")(violating(vi.fn().mockResolvedValue([])));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("[tenant-assert]"));
    } finally {
      warn.mockRestore();
    }
  });

  it("en producción NO escribe en consola — el canal es Sentry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    try {
      await handlerFor("report")(violating(vi.fn().mockResolvedValue([])));
      expect(warn).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
      warn.mockRestore();
    }
  });

  it("el mensaje de enforce no filtra datos del where al usuario", async () => {
    const handler = handlerFor("enforce");

    await expect(
      handler({
        model: "Employee",
        operation: "findMany",
        args: { where: { cedula: "V-12345678" } },
        query: vi.fn(),
      }),
    ).rejects.toThrow(TENANT_ASSERT_MESSAGE);
    expect(TENANT_ASSERT_MESSAGE).not.toContain("cedula");
  });
});

describe("createTenantAssertExtension — robustez de la instrumentación", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const violatingArgs = { where: { status: "PAID" } };

  it("M-2: deduplica por modelo.operación — un evento de Sentry, no uno por consulta", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const handler = handlerFor("report");

    // misma violación 5 veces (p. ej. un listado que se repinta)
    for (let i = 0; i < 5; i++) {
      await handler({ model: "Invoice", operation: "findMany", args: violatingArgs, query });
    }

    expect(query).toHaveBeenCalledTimes(5);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it("M-2: una violación DISTINTA sí genera su propio evento (el inventario no se pierde)", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const handler = handlerFor("report");

    await handler({ model: "Invoice", operation: "findMany", args: violatingArgs, query });
    await handler({ model: "Invoice", operation: "count", args: violatingArgs, query });
    await handler({ model: "Employee", operation: "findMany", args: violatingArgs, query });
    await handler({ model: "Invoice", operation: "findMany", args: violatingArgs, query });

    const tags = vi
      .mocked(Sentry.captureMessage)
      .mock.calls.map((call) => (call[1] as { tags: Record<string, string> }).tags
        .tenant_assert_violation);
    expect(tags).toEqual(["Invoice.findMany", "Invoice.count", "Employee.findMany"]);
  });

  it("M-2: la deduplicación es por instancia — un proceso nuevo vuelve a reportar", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const params = { model: "Invoice", operation: "findMany", args: violatingArgs, query };

    await handlerFor("report")(params);
    await handlerFor("report")(params);

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
  });

  it("M-2: aun deduplicado, la consola de dev sigue avisando en CADA consulta", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const query = vi.fn().mockResolvedValue([]);
      const handler = handlerFor("report");

      await handler({ model: "Invoice", operation: "findMany", args: violatingArgs, query });
      await handler({ model: "Invoice", operation: "findMany", args: violatingArgs, query });

      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("M-1: si Sentry revienta, la consulta NO se cae (la telemetría nunca rompe la petición)", async () => {
    vi.mocked(Sentry.captureMessage).mockImplementationOnce(() => {
      throw new Error("Sentry caído");
    });
    const query = vi.fn().mockResolvedValue([{ id: "inv-1" }]);
    const handler = handlerFor("report");

    await expect(
      handler({ model: "Invoice", operation: "findMany", args: violatingArgs, query }),
    ).resolves.toEqual([{ id: "inv-1" }]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("M-1: si addBreadcrumb revienta dentro de unscoped(), la consulta sigue igual", async () => {
    vi.mocked(Sentry.addBreadcrumb).mockImplementationOnce(() => {
      throw new Error("Sentry caído");
    });
    const query = vi.fn().mockResolvedValue([]);
    const handler = handlerFor("enforce");

    await unscoped("health", async () => {
      await expect(
        handler({ model: "Invoice", operation: "findMany", args: violatingArgs, query }),
      ).resolves.toEqual([]);
    });

    expect(query).toHaveBeenCalledTimes(1);
  });

  it("M-1: el throw de enforce vive FUERA del try — no se lo traga el catch", async () => {
    // Si el `throw` estuviera dentro del try/catch de la instrumentación, `enforce`
    // degradaría en silencio a `report` y el control quedaría desactivado sin avisar.
    vi.mocked(Sentry.captureMessage).mockImplementation(() => {
      throw new Error("Sentry caído");
    });
    try {
      const query = vi.fn().mockResolvedValue([]);
      const handler = handlerFor("enforce");

      await expect(
        handler({ model: "Invoice", operation: "findMany", args: violatingArgs, query }),
      ).rejects.toThrow(TENANT_ASSERT_MESSAGE);
      expect(query).not.toHaveBeenCalled();
    } finally {
      vi.mocked(Sentry.captureMessage).mockReset();
    }
  });
});

// ==============================================================================
// 9. Arranque defensivo: DMMF ausente o recortado por el bundler
// ==============================================================================

describe("SCOPE_MAP cuando el DMMF no está disponible", () => {
  afterEach(() => {
    vi.doUnmock("@prisma/client");
    vi.resetModules();
  });

  it.each([
    ["Prisma sin dmmf", {}],
    ["dmmf sin datamodel", { dmmf: {} }],
    ["datamodel sin models", { dmmf: { datamodel: {} } }],
  ])("%s → mapa vacío y aviso a Sentry (level error), nunca un crash de arranque", async (
    _caso: string,
    prismaShape: object,
  ) => {
    vi.resetModules();
    vi.doMock("@prisma/client", () => ({
      Prisma: { ...prismaShape, defineExtension: (e: unknown) => e },
    }));

    const sentry = await import("@sentry/nextjs");
    vi.mocked(sentry.captureMessage).mockClear();

    const mod = await import("../prisma-tenant-assert");

    // Fail-open a nivel de aserción (no rompe la app) pero RUIDOSO en Sentry: sin
    // DMMF la extensión no puede afirmar nada, y eso tiene que verse.
    expect(mod.SCOPE_MAP.size).toBe(0);
    expect(mod.assertViolation("Invoice", "findMany", {})).toBeNull();
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("SCOPE_MAP vacío"),
      { level: "error" },
    );
  });
});
