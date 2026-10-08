// src/__tests__/architecture/correlativo-serializable.test.ts
//
// Guard arquitectónico (ADR-001 / Z-1): TODA llamada a un generador de correlativo
// fiscal debe ejecutarse dentro de una transacción SERIALIZABLE.
//
// Por qué existe este archivo
// ───────────────────────────
// Un correlativo duplicado (Nº de control de factura, comprobante de retención) es una
// infracción SENIAT. La única defensa contra dos requests concurrentes que leen el mismo
// `lastNumber` es el aislamiento Serializable (+ el reintento P2034). Hasta SPEC-014 la
// regla la vigilaba un `grep` de `ci.yml` que:
//   · solo imprimía WARNING (no bloqueaba),
//   · miraba el ARCHIVO, no la llamada ("el archivo contiene la palabra en algún sitio"),
//   · NO reconocía `withSerializableRetry` → 3 falsos positivos medidos (CajaCajaMovementService,
//     invoice.actions, invoice-batch.actions, que SÍ usan Serializable), y
//   · no cubría los correlativos de retención (`getNextIvaVoucherNumber` /
//     `getNextIslrVoucherNumber`), que no se llaman `getNextVoucherNumber`.
// Pasar ese grep a `exit 1` rompía el CI por falsos positivos; dejarlo en WARNING es un gate
// que no existe (RN-1). Este test lo sustituye con un detector sobre el AST de TypeScript.
//
// Qué es legítimo (SPEC-014 sección 3-B)
// ──────────────────────────────────────
// Una LLAMADA —no la definición, no una mención en comentario o string— a una función de
// GOVERNED_FUNCTIONS es legítima solo si está (a cualquier profundidad de callbacks
// anidados, p. ej. `withCompanyContext(..., async (tx) => {...})`) dentro de:
//   (1) el callback de `withSerializableRetry(...)` (`@/lib/tx-helpers`); o
//   (2) el callback de `<algo>.$transaction(cb, opts)` con `opts` un objeto literal cuyo
//       `isolationLevel` contiene `Serializable` ("Serializable",
//       Prisma.TransactionIsolationLevel.Serializable), o el identificador / spread
//       `SERIALIZABLE_TX_OPTIONS`; o
//   (3) una función guardada en una variable (`const txBody = async (tx) => {...}`) que, en
//       el mismo archivo, se pasa por nombre como primer argumento a `withSerializableRetry`
//       o a `$transaction(txBody, <opts Serializable>)`. Dentro de un ternario o un if/else
//       basta con que ALGUNA rama lo use con Serializable: es el caso real de
//       invoice.actions.ts (SALE -> Serializable, PURCHASE -> `$transaction` plano porque
//       nunca genera correlativo).
// Excepción: `// ADR-001-EXCEPTION: <razón>` en la línea de la llamada o en la inmediata
// anterior. Sin razón no exime.
//
// El detector se TESTEA A SÍ MISMO (misma filosofía que idempotency-key-tenant-scope.test.ts):
//   · cada rama de la regla vive abajo como fixture sintético;
//   · el centinela exige que ENCUENTRE las llamadas reales del repo (si no, "cero
//     violaciones" sería un test que no puede fallar);
//   · los tests de MUTACIÓN le quitan el Serializable a un archivo REAL (en memoria) y
//     exigen que el guard falle.
//
// LÍMITES CONOCIDOS (deliberados; ver la spec)
//   · Alias de import (`import { getNextControlNumber as gnc }`) y referencias sin llamar
//     (`const f = getNextControlNumber`) son invisibles a un análisis por nombre.
//   · `isolationLevel` dado por una variable (`const lvl = "Serializable"`) no se acepta: el
//     guard falla CERRADO.
//   · `withSerializableRetry(txBody)` se acepta si aparece en CUALQUIER punto del archivo: no
//     se distingue el ámbito de dos `txBody` homónimos (ver el `it.todo` de abajo).
//   · No se verifica que `withSerializableRetry` venga de `@/lib/tx-helpers`.
//   · Solo se recorre `src/modules/**`: hoy es donde se llaman los generadores.
//
// Environment: node

import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(process.cwd());
const MODULES = path.join(ROOT, "src", "modules");

/**
 * Generadores de correlativo fiscal gobernados por ADR-001. Son los nombres REALES:
 *   · getNextControlNumber      -> ControlNumberSequence      (InvoiceSequenceService)
 *   · getNextIvaVoucherNumber   -> IvaRetentionSequence       (RetentionService)
 *   · getNextIslrVoucherNumber  -> IslrRetentionSequence      (RetentionService)
 *   · getNextVoucherNumber      -> local de CajaCajaMovementService (count()+1 sobre `CCC-`)
 * El comprobante de retención NO se llama `getNextVoucherNumber`: por eso el grep antiguo
 * tenía cobertura 0 sobre ellos.
 */
export const GOVERNED_FUNCTIONS = [
  "getNextControlNumber",
  "getNextVoucherNumber",
  "getNextIvaVoucherNumber",
  "getNextIslrVoucherNumber",
] as const;

export type Violation = { file: string; line: number; fn: string; reason: string };

/** Una llamada a un generador gobernado, sea o no legítima. */
export type GovernedCall = { file: string; line: number; fn: string };

// ─────────────────────────────────────────────────────────────────────────────
// 1. Detector — AST de TypeScript (`ts.createSourceFile`, sin type-check ni resolución de
//    módulos: solo la forma sintáctica del archivo).
// ─────────────────────────────────────────────────────────────────────────────

function parse(content: string, relPath: string): ts.SourceFile {
  const kind = relPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, kind);
}

/** Nombre invocado: `f(...)` -> f, `obj.f(...)` -> f. Cualquier otra forma -> null. */
function calleeName(call: ts.CallExpression): ts.Identifier | null {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e;
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) return e.name;
  return null;
}

function unwrap(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) {
    e = e.expression;
  }
  return e;
}

/** `"Serializable"` o `Prisma.TransactionIsolationLevel.Serializable`. */
function isSerializableLevel(e: ts.Expression): boolean {
  e = unwrap(e);
  if (ts.isStringLiteralLike(e)) return e.text === "Serializable";
  if (ts.isPropertyAccessExpression(e)) return e.name.text === "Serializable";
  return false;
}

/**
 * Opciones de `$transaction` que piden Serializable: un objeto literal con
 * `isolationLevel: <Serializable>` o con `...SERIALIZABLE_TX_OPTIONS`, o el identificador
 * `SERIALIZABLE_TX_OPTIONS` (`@/lib/tx-helpers`). Un `isolationLevel` dado por una variable
 * NO se acepta: el guard falla cerrado.
 */
function isSerializableOptions(arg: ts.Expression | undefined): boolean {
  if (!arg) return false;
  arg = unwrap(arg);
  if (ts.isIdentifier(arg)) return arg.text === "SERIALIZABLE_TX_OPTIONS";
  if (ts.isObjectLiteralExpression(arg)) {
    for (const p of arg.properties) {
      if (ts.isSpreadAssignment(p)) {
        const spread = unwrap(p.expression);
        if (ts.isIdentifier(spread) && spread.text === "SERIALIZABLE_TX_OPTIONS") return true;
      } else if (
        ts.isPropertyAssignment(p) &&
        (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
        p.name.text === "isolationLevel" &&
        isSerializableLevel(p.initializer)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** ¿Esta llamada abre una transacción Serializable cuyo PRIMER argumento es el cuerpo? */
function isSerializableTxCall(call: ts.CallExpression): boolean {
  const name = calleeName(call);
  if (!name) return false;
  if (name.text === "withSerializableRetry") return true;
  if (name.text === "$transaction" && ts.isPropertyAccessExpression(call.expression)) {
    return isSerializableOptions(call.arguments[1]);
  }
  return false;
}

function scan(sf: ts.SourceFile) {
  const calls: { node: ts.CallExpression; name: ts.Identifier; fn: string }[] = [];
  // Cuerpos guardados en una variable y pasados POR NOMBRE a una transacción Serializable
  // (`const txBody = async (tx) => {...}; withSerializableRetry(txBody)`). Se emparejan por
  // nombre en todo el archivo: no se distingue el ámbito de dos `txBody` homónimos.
  const serializableBodies = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name && (GOVERNED_FUNCTIONS as readonly string[]).includes(name.text)) {
        calls.push({ node, name, fn: name.text });
      }
      const first = node.arguments[0];
      if (first && ts.isIdentifier(first) && isSerializableTxCall(node)) {
        serializableBodies.add(first.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { calls, serializableBodies };
}

/** Sube por los ancestros buscando una función que sea el cuerpo de una tx Serializable. */
function isInsideSerializable(call: ts.CallExpression, serializableBodies: Set<string>): boolean {
  for (let a: ts.Node | undefined = call.parent; a; a = a.parent) {
    // (1) y (2): callback pasado directamente a withSerializableRetry / $transaction(Serializable)
    if (
      (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) &&
      ts.isCallExpression(a.parent) &&
      a.parent.arguments[0] === a &&
      isSerializableTxCall(a.parent)
    ) {
      return true;
    }
    // (3): función con nombre, o guardada en una variable, que se pasa por nombre a una tx Serializable
    let bound: string | null = null;
    if (ts.isFunctionDeclaration(a) && a.name) bound = a.name.text;
    else if (
      (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) &&
      ts.isVariableDeclaration(a.parent) &&
      a.parent.initializer === a &&
      ts.isIdentifier(a.parent.name)
    ) {
      bound = a.parent.name.text;
    }
    if (bound && serializableBodies.has(bound)) return true;
  }
  return false;
}

/** Comentarios `//` del archivo con su línea (1-based). Los de bloque no eximen. */
function lineComments(sf: ts.SourceFile): { line: number; text: string }[] {
  const text = sf.text;
  const seen = new Set<number>();
  const out: { line: number; text: string }[] = [];
  const add = (r: ts.CommentRange) => {
    if (seen.has(r.pos) || r.kind !== ts.SyntaxKind.SingleLineCommentTrivia) return;
    seen.add(r.pos);
    out.push({
      line: sf.getLineAndCharacterOfPosition(r.pos).line + 1,
      text: text.slice(r.pos, r.end),
    });
  };
  // Se recorren los TOKENS: así un `// ADR-001-EXCEPTION` dentro de un string no cuenta.
  const walkTokens = (n: ts.Node) => {
    const kids = n.getChildren(sf);
    if (kids.length === 0) {
      for (const r of ts.getLeadingCommentRanges(text, n.pos) ?? []) add(r);
      for (const r of ts.getTrailingCommentRanges(text, n.end) ?? []) add(r);
    }
    kids.forEach(walkTokens);
  };
  walkTokens(sf);
  return out;
}

/**
 * Todas las llamadas a GOVERNED_FUNCTIONS en `content`, en orden de aparición, legítimas o
 * no. `line` es 1-based y es la línea donde aparece el NOMBRE de la función. Las
 * definiciones, importaciones, re-exports, claves de objeto y menciones en
 * comentarios/strings NO son llamadas.
 */
export function collectCalls(content: string, relPath: string): GovernedCall[] {
  const sf = parse(content, relPath);
  return scan(sf).calls.map((c) => ({
    file: relPath,
    line: sf.getLineAndCharacterOfPosition(c.name.getStart(sf)).line + 1,
    fn: c.fn,
  }));
}

/**
 * Las llamadas de `collectCalls` que no son legítimas según la regla de arriba y no están
 * eximidas por `// ADR-001-EXCEPTION: <razón>`. `reason` explica qué falta.
 */
export function findCorrelativoViolations(content: string, relPath: string): Violation[] {
  const sf = parse(content, relPath);
  const { calls, serializableBodies } = scan(sf);
  const comments = lineComments(sf);
  const out: Violation[] = [];
  for (const c of calls) {
    const line = sf.getLineAndCharacterOfPosition(c.name.getStart(sf)).line + 1;
    // La excepción vive en la línea de la llamada o en la inmediata anterior, y exige razón.
    const exempt = comments.some(
      (k) =>
        (k.line === line || k.line === line - 1) && /^\/\/\s*ADR-001-EXCEPTION:\s*\S/.test(k.text)
    );
    if (exempt || isInsideSerializable(c.node, serializableBodies)) continue;
    out.push({
      file: relPath,
      line,
      fn: c.fn,
      reason:
        `${c.fn}() fuera de una transacción Serializable: usa withSerializableRetry(...) o ` +
        `$transaction(cb, { isolationLevel: "Serializable" }), o documenta // ADR-001-EXCEPTION: <razón>`,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Recorrido del repo
// ─────────────────────────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      walk(abs, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

// Prefiltro por subcadena: una llamada contiene el nombre, así que descartar los archivos que
// no lo mencionan es seguro y evita parsear ~500 archivos para nada.
const FILES = walk(MODULES)
  .map((abs) => ({
    rel: path.relative(ROOT, abs).replace(/\\/g, "/"),
    content: fs.readFileSync(abs, "utf-8"),
  }))
  .filter((f) => GOVERNED_FUNCTIONS.some((name) => f.content.includes(name)));

const file = (rel: string) => FILES.find((f) => f.rel === rel);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Helpers de test
// ─────────────────────────────────────────────────────────────────────────────

/** Une líneas de un fixture: los números de línea de los tests son los del array (1-based). */
const lines = (...l: string[]) => l.join("\n");

const REL = "fixture.ts";

/** Una sola llamada gobernada y NINGUNA violación. Exige que la llamada se ENCUENTRE: sin eso,
 *  "cero violaciones" lo cumple un detector que no detecta nada. */
function expectLegit(src: string, fns: string | string[] = "getNextControlNumber") {
  expect(
    collectCalls(src, REL).map((c) => c.fn),
    "el detector debe ENCONTRAR la llamada; si no, 'sin violación' no significa nada"
  ).toEqual(Array.isArray(fns) ? fns : [fns]);
  expect(findCorrelativoViolations(src, REL)).toEqual([]);
}

/** Una sola llamada gobernada y UNA violación sobre ella. */
function expectViolation(src: string, fn = "getNextControlNumber") {
  expect(
    collectCalls(src, REL).map((c) => c.fn),
    "el detector debe ENCONTRAR la llamada"
  ).toEqual([fn]);
  const violations = findCorrelativoViolations(src, REL);
  expect(violations, "debía haber exactamente una violación").toHaveLength(1);
  expect(violations[0]).toMatchObject({ file: REL, fn });
  expect(violations[0]!.reason.length).toBeGreaterThan(0);
}

/** `prisma.$transaction(cb, <opts>)` con la llamada gobernada dentro de `cb`. */
const inTransaction = (opts: string | null, fn = "getNextControlNumber") =>
  lines(
    "await prisma.$transaction(",
    "  async (tx) => {",
    `    const n = await ${fn}(tx, companyId, "SALE");`,
    "    return n;",
    `  }${opts ? "," : ""}`,
    ...(opts ? [`  ${opts}`] : []),
    ");"
  );

/** `const txBody = ...` que contiene la llamada, como en invoice.actions.ts. */
const txBodyDecl = (fn = "getNextControlNumber") => [
  "const txBody = async (tx: Tx) =>",
  "  withCompanyContext(companyId, tx, async (tx) => {",
  `    const n = await ${fn}(tx, companyId, "SALE");`,
  "    return n;",
  "  });",
];

// Opciones de `$transaction` que SÍ son Serializable.
const SERIALIZABLE_OPTS: [string, string][] = [
  ['isolationLevel: "Serializable"', '{ isolationLevel: "Serializable" }'],
  ["comillas simples", "{ isolationLevel: 'Serializable' }"],
  ["con `as const`", '{ isolationLevel: "Serializable" as const }'],
  [
    "Prisma.TransactionIsolationLevel.Serializable",
    "{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }",
  ],
  [
    "isolationLevel no es la primera clave",
    '{ timeout: 15000, maxWait: 5000, isolationLevel: "Serializable" }',
  ],
  ["identificador SERIALIZABLE_TX_OPTIONS", "SERIALIZABLE_TX_OPTIONS"],
  ["spread de SERIALIZABLE_TX_OPTIONS", "{ ...SERIALIZABLE_TX_OPTIONS, timeout: 30000 }"],
];

// Opciones de `$transaction` que NO lo son (o que no lo demuestran).
const NON_SERIALIZABLE_OPTS: [string, string | null][] = [
  ["sin segundo argumento", null],
  ["objeto vacío", "{}"],
  ["solo timeout", "{ timeout: 15000 }"],
  ['isolationLevel "ReadCommitted"', '{ isolationLevel: "ReadCommitted" }'],
  ['isolationLevel "RepeatableRead"', '{ isolationLevel: "RepeatableRead" }'],
  [
    "Prisma.TransactionIsolationLevel.ReadCommitted",
    "{ isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }",
  ],
  [
    "'Serializable' solo como texto de OTRA clave",
    '{ isolationLevel: "ReadCommitted", note: "Serializable" }',
  ],
  ["clave que no es isolationLevel", '{ isolation: "Serializable" }'],
  ["identificador que no es SERIALIZABLE_TX_OPTIONS", "OTHER_OPTIONS"],
];

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Architecture: GOVERNED_FUNCTIONS", () => {
  it("lista los cuatro generadores reales (el de retención NO se llama getNextVoucherNumber)", () => {
    expect([...GOVERNED_FUNCTIONS].sort()).toEqual(
      [
        "getNextControlNumber",
        "getNextIslrVoucherNumber",
        "getNextIvaVoucherNumber",
        "getNextVoucherNumber",
      ].sort()
    );
  });
});

describe("Detector: qué cuenta como llamada", () => {
  it("definiciones, importaciones, re-exports, claves de objeto y tipos NO son llamadas", () => {
    const src = lines(
      'import { getNextControlNumber } from "../services/InvoiceSequenceService";', // 1
      'export { getNextIvaVoucherNumber } from "./RetentionService";', // 2
      "export async function getNextIslrVoucherNumber(tx: Tx, companyId: string) { return 'x'; }", // 3
      "async function getNextVoucherNumber(companyId: string, tx: Tx): Promise<string> {", // 4
      "  return 'CCC-1';", // 5
      "}", // 6
      "export const getNextOtro = async (tx: Tx) => 'x';", // 7
      "class Svc { async getNextControlNumber(tx: Tx) { return 1; } }", // 8
      "const holder = { async getNextIvaVoucherNumber(tx: Tx) { return 1; } };", // 9
      "type T = typeof getNextControlNumber;", // 10
      "const mocks = { getNextControlNumber: vi.fn(), getNextVoucherNumber };", // 11
      "await withSerializableRetry(async (tx) => {", // 12
      "  await getNextVoucherNumber(companyId, tx);", // 13  <- la única llamada
      "});" // 14
    );
    expect(collectCalls(src, REL)).toEqual([{ file: REL, line: 13, fn: "getNextVoucherNumber" }]);
    expect(findCorrelativoViolations(src, REL)).toEqual([]);
  });

  it("menciones en comentarios, JSDoc, strings y plantillas NO son llamadas", () => {
    const src = lines(
      "// await getNextControlNumber(tx, companyId, 'SALE');", // 1
      "/**", // 2
      " * Llama a getNextVoucherNumber(tx) dentro de la transacción.", // 3
      " */", // 4
      'const msg = "getNextIvaVoucherNumber(tx)";', // 5
      "const tpl = `getNextIslrVoucherNumber(${x})`;", // 6
      "await withSerializableRetry(async (tx) => {", // 7
      "  await getNextControlNumber(tx, companyId, 'SALE');", // 8  <- la única llamada
      "});" // 9
    );
    expect(collectCalls(src, REL)).toEqual([{ file: REL, line: 8, fn: "getNextControlNumber" }]);
    expect(findCorrelativoViolations(src, REL)).toEqual([]);
  });

  it.each(GOVERNED_FUNCTIONS)(
    "%s se reconoce como llamada (y fuera de transacción viola)",
    (fn) => {
      expectViolation(
        lines("async function f(tx: Tx) {", `  return ${fn}(tx, companyId, new Date());`, "}"),
        fn
      );
    }
  );

  it("un archivo sin ninguna llamada gobernada no produce nada", () => {
    expect(collectCalls("export const x = 1;\nfoo(bar());", REL)).toEqual([]);
    expect(findCorrelativoViolations("export const x = 1;\nfoo(bar());", REL)).toEqual([]);
  });
});

describe("Fixtures: llamadas LEGÍTIMAS", () => {
  describe("forma (1) — withSerializableRetry(cb)", () => {
    it.each(GOVERNED_FUNCTIONS)("%s dentro del callback", (fn) => {
      expectLegit(
        lines(
          "await withSerializableRetry(async (tx) => {",
          `  const n = await ${fn}(tx, companyId);`,
          "  return n;",
          "});"
        ),
        fn
      );
    });

    it("anidada: withCompanyContext dentro de withSerializableRetry", () => {
      expectLegit(
        lines(
          "const inv = await withSerializableRetry(async (tx) =>",
          "  withCompanyContext(companyId, tx, async (tx2) => {",
          "    if (type === 'SALE') {",
          "      for (const row of rows) {",
          "        const n = await getNextControlNumber(tx2, companyId, 'SALE');",
          "      }",
          "    }",
          "  })",
          ");"
        )
      );
    });
  });

  describe("forma (2) — $transaction(cb, { isolationLevel: Serializable })", () => {
    it.each(GOVERNED_FUNCTIONS)("%s dentro del callback", (fn) => {
      expectLegit(inTransaction('{ isolationLevel: "Serializable" }', fn), fn);
    });

    it.each(SERIALIZABLE_OPTS)("opciones: %s", (_n, opts) => {
      expectLegit(inTransaction(opts));
    });

    it.each(["prisma", "prismaDefault", "this.prisma", "db", "tx"])(
      "el receptor de $transaction puede ser cualquiera (%s)",
      (receiver) => {
        expectLegit(
          lines(
            `await ${receiver}.$transaction(`,
            "  async (t) => getNextControlNumber(t, companyId, 'SALE'),",
            '  { isolationLevel: "Serializable" }',
            ");"
          )
        );
      }
    );

    it("anidada: withCompanyContext dentro de $transaction Serializable", () => {
      expectLegit(
        lines(
          "await prisma.$transaction(",
          "  async (tx) =>",
          "    withCompanyContext(companyId, tx, async (tx2) => {",
          "      if (type === 'SALE') {",
          "        const n = await getNextControlNumber(tx2, companyId, 'SALE');",
          "      }",
          "    }),",
          '  { isolationLevel: "Serializable" }',
          ");"
        )
      );
    });

    it("forma real de retention.actions.ts: IVA e ISLR en ternarios dentro de withCompanyContext", () => {
      expectLegit(
        lines(
          "retention = await prisma.$transaction(",
          "  async (tx) =>",
          "    withCompanyContext(data.companyId, tx, async (tx) => {",
          "      const voucherNumber =",
          '        data.type !== "ISLR"',
          "          ? await getNextIvaVoucherNumber(tx, data.companyId, new Date())",
          "          : null;",
          "      const islrVoucherNumber =",
          '        data.type !== "IVA"',
          "          ? await getNextIslrVoucherNumber(tx, data.companyId, new Date())",
          "          : null;",
          "      return tx.retencion.create({ data: { voucherNumber, islrVoucherNumber } });",
          "    }),",
          '  { isolationLevel: "Serializable" }',
          ");"
        ),
        ["getNextIvaVoucherNumber", "getNextIslrVoucherNumber"]
      );
    });
  });

  describe("forma (3) — función guardada en una variable (txBody)", () => {
    it("txBody pasado a withSerializableRetry(txBody)", () => {
      expectLegit(lines(...txBodyDecl(), "const inv = await withSerializableRetry(txBody);"));
    });

    it("txBody pasado a $transaction(txBody, { isolationLevel: 'Serializable' })", () => {
      expectLegit(
        lines(
          ...txBodyDecl(),
          'const inv = await prisma.$transaction(txBody, { isolationLevel: "Serializable" });'
        )
      );
    });

    it("txBody pasado a $transaction(txBody, SERIALIZABLE_TX_OPTIONS)", () => {
      expectLegit(
        lines(
          ...txBodyDecl(),
          "const inv = await prisma.$transaction(txBody, SERIALIZABLE_TX_OPTIONS);"
        )
      );
    });

    it("CASO REAL de invoice.actions.ts:182-185 — ternario SALE: Serializable / PURCHASE: $transaction plano", () => {
      // PURCHASE usa `$transaction(txBody)` sin Serializable porque nunca genera correlativo
      // (el `if (type === "SALE")` está DENTRO de txBody). El detector no puede saberlo: la regla
      // es "alguna rama lo usa con Serializable". Se documenta aquí a propósito.
      expectLegit(
        lines(
          ...txBodyDecl(),
          "const invoice =",
          '  parsed.data.type === "SALE"',
          "    ? await withSerializableRetry(txBody)",
          "    : await prisma.$transaction(txBody);"
        )
      );
    });

    it("CASO REAL de invoice-batch.actions.ts:206-210 — if/else con withSerializableRetry en una rama", () => {
      expectLegit(
        lines(
          ...txBodyDecl(),
          'if (parsed.data.type === "SALE") {',
          "  await withSerializableRetry(txBody);",
          "} else {",
          "  await prisma.$transaction(txBody);",
          "}"
        )
      );
    });

    it("ternario con la rama Serializable en segundo lugar", () => {
      expectLegit(
        lines(
          ...txBodyDecl(),
          "const r = cond ? await prisma.$transaction(txBody) : await withSerializableRetry(txBody);"
        )
      );
    });

    it("ternario con $transaction(txBody, { isolationLevel: 'Serializable' }) en una rama", () => {
      expectLegit(
        lines(
          ...txBodyDecl(),
          "const r = cond",
          '  ? await prisma.$transaction(txBody, { isolationLevel: "Serializable" })',
          "  : await prisma.$transaction(txBody);"
        )
      );
    });
  });

  describe("excepción // ADR-001-EXCEPTION: <razón>", () => {
    it("en la línea inmediata anterior a la llamada", () => {
      expectLegit(
        lines(
          "async function f(tx: Tx) {",
          "  // ADR-001-EXCEPTION: el llamador ya abrió la transacción Serializable",
          '  return getNextControlNumber(tx, companyId, "SALE");',
          "}"
        )
      );
    });

    it("en la misma línea de la llamada", () => {
      expectLegit(
        lines(
          "async function f(tx: Tx) {",
          '  return getNextControlNumber(tx, companyId, "SALE"); // ADR-001-EXCEPTION: el llamador abre la tx',
          "}"
        )
      );
    });

    it("exime también dentro de una transacción NO Serializable", () => {
      expectLegit(
        lines(
          "await prisma.$transaction(async (tx) => {",
          "  // ADR-001-EXCEPTION: secuencia de prueba, no fiscal",
          "  return getNextControlNumber(tx, companyId, 'SALE');",
          "});"
        )
      );
    });
  });
});

describe("Fixtures: llamadas que VIOLAN", () => {
  describe("dentro de $transaction sin Serializable demostrado", () => {
    it.each(NON_SERIALIZABLE_OPTS)("opciones: %s", (_n, opts) => {
      expectViolation(inTransaction(opts));
    });

    it.each(GOVERNED_FUNCTIONS)("%s en $transaction con ReadCommitted", (fn) => {
      expectViolation(inTransaction('{ isolationLevel: "ReadCommitted" }', fn), fn);
    });
  });

  describe("fuera de toda transacción", () => {
    it("en el cuerpo de una función suelta", () => {
      expectViolation(
        lines(
          "async function f(tx: Tx) {",
          '  return getNextControlNumber(tx, companyId, "SALE");',
          "}"
        )
      );
    });

    it("a nivel de módulo", () => {
      expectViolation('const n = await getNextControlNumber(prisma, companyId, "SALE");');
    });

    it("ANTES de abrir la withSerializableRetry (fuera de su callback)", () => {
      expectViolation(
        lines(
          'const n = await getNextControlNumber(prisma, companyId, "SALE");',
          "await withSerializableRetry(async (tx) => {",
          "  await tx.invoice.create({ data: { controlNumber: n } });",
          "});"
        )
      );
    });

    it("DESPUÉS de cerrar un $transaction Serializable (la legitimidad no se hereda por vecindad)", () => {
      expectViolation(
        lines(
          "await prisma.$transaction(",
          "  async (tx) => { await tx.invoice.create({ data }); },",
          '  { isolationLevel: "Serializable" }',
          ");",
          'const n = await getNextControlNumber(prisma, companyId, "SALE");'
        )
      );
    });

    it("solo dentro de withCompanyContext (sin transacción Serializable por fuera)", () => {
      expectViolation(
        lines(
          "await withCompanyContext(companyId, prisma, async (tx) => {",
          '  await getNextControlNumber(tx, companyId, "SALE");',
          "});"
        )
      );
    });

    it("dentro de un callback que no es una transacción (map / Promise.all)", () => {
      expectViolation(
        lines(
          "await Promise.all(",
          "  rows.map(async (row) => {",
          '    return getNextControlNumber(prisma, companyId, "SALE");',
          "  })",
          ");"
        )
      );
    });

    it("en un wrapper de transacción desconocido", () => {
      expectViolation(
        lines(
          "await runInTransaction(async (tx) => {",
          '  await getNextControlNumber(tx, companyId, "SALE");',
          "});"
        )
      );
    });
  });

  describe("el Serializable de una transacción no cubre a otra", () => {
    it("dos transacciones: solo la Serializable es legítima", () => {
      const src = lines(
        "await prisma.$transaction(async (tx) => {", // 1
        '  await getNextControlNumber(tx, companyId, "SALE");', // 2  <- viola
        "});", // 3
        "await prisma.$transaction(", // 4
        "  async (tx) => {", // 5
        '    await getNextControlNumber(tx, companyId, "PURCHASE");', // 6  <- legítima
        "  },", // 7
        '  { isolationLevel: "Serializable" }', // 8
        ");" // 9
      );
      expect(collectCalls(src, REL).map((c) => c.line)).toEqual([2, 6]);
      expect(findCorrelativoViolations(src, REL).map((v) => v.line)).toEqual([2]);
    });
  });

  describe("mención engañosa de Serializable", () => {
    it("`withSerializableRetry(...)` solo en un comentario no legitima", () => {
      expectViolation(
        lines(
          "// withSerializableRetry(async (tx) => { ... })",
          "await prisma.$transaction(async (tx) => {",
          '  await getNextControlNumber(tx, companyId, "SALE");',
          "});"
        )
      );
    });

    it("`isolationLevel: 'Serializable'` solo en un comentario no legitima", () => {
      expectViolation(
        lines(
          "await prisma.$transaction(async (tx) => {",
          '  await getNextControlNumber(tx, companyId, "SALE");',
          '} /* , { isolationLevel: "Serializable" } */);'
        )
      );
    });

    it("el texto 'Serializable' en un string suelto no legitima", () => {
      expectViolation(
        lines(
          'const doc = "usa isolationLevel: Serializable";',
          "await prisma.$transaction(async (tx) => {",
          '  await getNextControlNumber(tx, companyId, "SALE");',
          "});"
        )
      );
    });
  });

  describe("forma (3) — txBody sin Serializable", () => {
    it("txBody pasado solo a $transaction(txBody) sin opciones", () => {
      expectViolation(lines(...txBodyDecl(), "const inv = await prisma.$transaction(txBody);"));
    });

    it("txBody pasado a $transaction(txBody, { isolationLevel: 'ReadCommitted' })", () => {
      expectViolation(
        lines(
          ...txBodyDecl(),
          'const inv = await prisma.$transaction(txBody, { isolationLevel: "ReadCommitted" });'
        )
      );
    });

    it("ternario en el que NINGUNA rama es Serializable", () => {
      expectViolation(
        lines(
          ...txBodyDecl(),
          "const inv = cond",
          "  ? await prisma.$transaction(txBody)",
          "  : await prisma.$transaction(txBody, { timeout: 5000 });"
        )
      );
    });

    it("txBody declarado pero nunca pasado a nada", () => {
      expectViolation(lines(...txBodyDecl()));
    });

    it("se pasa OTRA variable a withSerializableRetry (el emparejamiento es por nombre)", () => {
      expectViolation(
        lines(
          ...txBodyDecl(),
          "const otherBody = async (tx: Tx) => ({});",
          "await withSerializableRetry(otherBody);"
        )
      );
    });

    it("txBody pasado a un wrapper desconocido", () => {
      expectViolation(lines(...txBodyDecl(), "await runInTransaction(txBody);"));
    });

    it("`withSerializableRetry(txBody)` solo en un comentario no legitima", () => {
      expectViolation(
        lines(
          ...txBodyDecl(),
          "// await withSerializableRetry(txBody);",
          "await prisma.$transaction(txBody);"
        )
      );
    });
  });
});

describe("Fixtures: // ADR-001-EXCEPTION exige razón y posición exacta", () => {
  const callLine = '  return getNextControlNumber(tx, companyId, "SALE");';
  const prev = (marker: string) =>
    lines("async function f(tx: Tx) {", `  ${marker}`, callLine, "}");
  const same = (marker: string) =>
    lines("async function f(tx: Tx) {", `${callLine} ${marker}`, "}");

  const NO_REASON: [string, string][] = [
    ["sin razón", "// ADR-001-EXCEPTION:"],
    ["razón en blanco", "// ADR-001-EXCEPTION:    "],
    ["sin dos puntos", "// ADR-001-EXCEPTION porque sí"],
    ["es la excepción de OTRO ADR", "// ADR-004-EXCEPTION: cron cross-company"],
  ];

  it.each(NO_REASON)("%s en la línea anterior NO exime", (_n, marker) => {
    expectViolation(prev(marker));
  });

  it.each(NO_REASON)("%s en la misma línea NO exime", (_n, marker) => {
    expectViolation(same(marker));
  });

  it("el comentario separado por una línea en blanco no exime", () => {
    expectViolation(
      lines(
        "async function f(tx: Tx) {",
        "  // ADR-001-EXCEPTION: razón válida pero demasiado lejos",
        "",
        callLine,
        "}"
      )
    );
  });

  it("el comentario dos líneas antes (con código en medio) no exime", () => {
    expectViolation(
      lines(
        "async function f(tx: Tx) {",
        "  // ADR-001-EXCEPTION: razón válida pero demasiado lejos",
        "  const x = 1;",
        callLine,
        "}"
      )
    );
  });

  it("la excepción exime solo la llamada anotada, no la vecina", () => {
    const src = lines(
      "async function f(tx: Tx) {", // 1
      "  // ADR-001-EXCEPTION: el llamador abre la transacción Serializable", // 2
      '  const a = await getNextControlNumber(tx, companyId, "SALE");', // 3  <- eximida
      '  const b = await getNextControlNumber(tx, companyId, "PURCHASE");', // 4  <- viola
      "}" // 5
    );
    expect(collectCalls(src, REL).map((c) => c.line)).toEqual([3, 4]);
    expect(findCorrelativoViolations(src, REL).map((v) => v.line)).toEqual([4]);
  });

  it("un string que contiene el texto de la excepción no exime", () => {
    expectViolation(
      lines(
        "async function f(tx: Tx) {",
        '  return getNextControlNumber(tx, "// ADR-001-EXCEPTION: razón", "SALE");',
        "}"
      )
    );
  });
});

describe("Contrato de Violation", () => {
  it("file, line (1-based, línea del NOMBRE de la función), fn y reason, en orden de aparición", () => {
    const src = lines(
      "async function a(tx: Tx) {", // 1
      '  return getNextControlNumber(tx, c, "SALE");', // 2  <- viola
      "}", // 3
      "async function b() {", // 4
      "  const n = await prisma.$transaction(async (t) => {", // 5
      "    return getNextVoucherNumber(c, t);", // 6  <- viola
      "  });", // 7
      "  return n;", // 8
      "}", // 9
      "async function c2(tx: Tx) {", // 10
      "  return getNextIslrVoucherNumber(", // 11  <- viola (la llamada ocupa varias líneas)
      "    tx,", // 12
      "    companyId,", // 13
      "    new Date()", // 14
      "  );", // 15
      "}" // 16
    );
    const relPath = "src/modules/x/y.ts";
    const violations = findCorrelativoViolations(src, relPath);
    expect(violations.map(({ file, line, fn }) => ({ file, line, fn }))).toEqual([
      { file: relPath, line: 2, fn: "getNextControlNumber" },
      { file: relPath, line: 6, fn: "getNextVoucherNumber" },
      { file: relPath, line: 11, fn: "getNextIslrVoucherNumber" },
    ]);
    for (const v of violations) {
      expect(typeof v.reason).toBe("string");
      expect(v.reason, "el mensaje debe decir qué se exige").toMatch(/Serializable/);
    }
  });

  it("collectCalls y findCorrelativoViolations devuelven `file` tal como se les pasó", () => {
    const src = 'await getNextControlNumber(prisma, companyId, "SALE");';
    expect(collectCalls(src, "src/modules/a/b.ts")).toEqual([
      { file: "src/modules/a/b.ts", line: 1, fn: "getNextControlNumber" },
    ]);
  });
});

describe("Extensiones NO explícitas en la spec (decisión a confirmar; borrar si se descartan)", () => {
  it("EXTENSIÓN — función DECLARADA (`async function txBody`) pasada a withSerializableRetry", () => {
    expectLegit(
      lines(
        "async function txBody(tx: Tx) {",
        '  return getNextControlNumber(tx, companyId, "SALE");',
        "}",
        "const inv = await withSerializableRetry(txBody);"
      )
    );
  });

  it("EXTENSIÓN — llamada por propiedad (`seq.getNextControlNumber(...)`) fuera de transacción viola", () => {
    expectViolation(
      lines(
        'import * as seq from "../services/InvoiceSequenceService";',
        "async function f(tx: Tx) {",
        '  return seq.getNextControlNumber(tx, companyId, "SALE");',
        "}"
      )
    );
  });

  it("EXTENSIÓN — llamada por propiedad dentro de withSerializableRetry es legítima", () => {
    expectLegit(
      lines(
        'import * as seq from "../services/InvoiceSequenceService";',
        "await withSerializableRetry(async (tx) => {",
        '  return seq.getNextControlNumber(tx, companyId, "SALE");',
        "});"
      )
    );
  });

  it.todo(
    "LÍMITE CONOCIDO — dos `txBody` homónimos en funciones distintas: el Serializable de uno legitima al otro (no se distingue el ámbito)"
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Repo real
// ─────────────────────────────────────────────────────────────────────────────

/** Nº EXACTO de llamadas por archivo. Varios de estos archivos además DEFINEN, IMPORTAN o MENCIONAN
 *  el nombre (definición local, import, comentario): el conteo exacto prueba que eso no se cuenta. */
const EXPECTED_CALL_SITES: { file: string; fn: string; count: number }[] = [
  {
    file: "src/modules/invoices/actions/invoice.actions.ts",
    fn: "getNextControlNumber",
    count: 1,
  },
  {
    file: "src/modules/invoices/actions/invoice-batch.actions.ts",
    fn: "getNextControlNumber",
    count: 1,
  },
  {
    file: "src/modules/retentions/actions/retention.actions.ts",
    fn: "getNextIvaVoucherNumber",
    count: 1,
  },
  {
    file: "src/modules/retentions/actions/retention.actions.ts",
    fn: "getNextIslrVoucherNumber",
    count: 1,
  },
  {
    // Define su PROPIO `getNextVoucherNumber` local (línea 79) y lo menciona en un comentario
    // (línea 96): la única llamada es la de `createMovement`.
    file: "src/modules/cajachica/services/CajaCajaMovementService.ts",
    fn: "getNextVoucherNumber",
    count: 1,
  },
  {
    // NC y ND de venta generan Nº de control: dos llamadas (createCreditNote / createDebitNote).
    file: "src/modules/invoices/services/InvoiceCreditDebitNoteService.ts",
    fn: "getNextControlNumber",
    count: 2,
  },
];

// Archivos que DEFINEN los generadores: contienen el nombre pero no lo llaman.
const DEFINITION_ONLY = [
  "src/modules/invoices/services/InvoiceSequenceService.ts",
  "src/modules/retentions/services/RetentionService.ts",
];

const MIN_EXPECTED_CALLS = 5;

describe("Architecture: correlativos fiscales dentro de transacción Serializable (ADR-001, Z-1)", () => {
  const calls = FILES.flatMap((f) => collectCalls(f.content, f.rel));

  it("el detector encuentra las llamadas reales (no es un test que no puede fallar)", () => {
    expect(
      calls.length,
      `El detector solo encontró ${calls.length} llamadas a generadores de correlativo. ` +
        `Si la forma del código cambió, ajusta el detector — no bajes el mínimo.`
    ).toBeGreaterThanOrEqual(MIN_EXPECTED_CALLS);
  });

  it.each(EXPECTED_CALL_SITES)(
    "encuentra $fn en $file ($count llamada(s))",
    ({ file: rel, fn, count }) => {
      const f = file(rel);
      expect(
        f,
        `${rel}: el centinela apunta a un archivo que ya no existe o ya no menciona el nombre`
      ).toBeDefined();
      const found = collectCalls(f!.content, rel).filter((c) => c.fn === fn);
      expect(found, `${rel}: llamadas a ${fn} (definiciones y menciones no cuentan)`).toHaveLength(
        count
      );
    }
  );

  it.each(DEFINITION_ONLY)("%s define los generadores pero no los llama", (rel) => {
    const f = file(rel);
    expect(f, `${rel}: el centinela apunta a un archivo que ya no existe`).toBeDefined();
    // Se exige además que el detector SÍ funcione en el repo (si no, esto pasaría con un stub).
    expect(calls.length).toBeGreaterThanOrEqual(MIN_EXPECTED_CALLS);
    expect(collectCalls(f!.content, rel), `${rel}: se contó una definición como llamada`).toEqual(
      []
    );
  });

  it("ninguna llamada a un generador de correlativo queda fuera de una transacción Serializable", () => {
    // Acompañado del centinela de arriba: solo vale porque se demuestra que el detector ve las
    // llamadas reales. Con un detector que no encuentra nada esto pasaría en falso.
    expect(calls.length).toBeGreaterThanOrEqual(MIN_EXPECTED_CALLS);

    const violations = FILES.flatMap((f) => findCorrelativoViolations(f.content, f.rel)).map(
      (v) => `[${v.file}:${v.line}] ${v.fn}() — ${v.reason}`
    );
    expect(
      violations,
      `Un correlativo duplicado es una infracción SENIAT (Z-1). Cada llamada debe ir dentro de ` +
        `withSerializableRetry(...) o de $transaction(cb, { isolationLevel: "Serializable" }). ` +
        `Si es una excepción real, documéntala: // ADR-001-EXCEPTION: <razón>\n\n${violations.join("\n")}`
    ).toHaveLength(0);
  });
});

describe("Meta: el guard PUEDE fallar sobre código real (mutación)", () => {
  // Los fixtures prueban la lógica; esto prueba el circuito completo: archivo real del repo,
  // leído de disco, con el Serializable quitado EN MEMORIA. Si con la mutación aplicada el test
  // pasara en verde, el guard sería decorativo. No se escribe nada a disco.

  /** Reemplaza SOLO la ocurrencia n-ésima (0-based) de `needle`. */
  function replaceNth(src: string, needle: string, repl: string, n: number): string {
    let from = 0;
    for (let i = 0; i < n; i++) from = src.indexOf(needle, from) + needle.length;
    const at = src.indexOf(needle, from);
    return at === -1 ? src : src.slice(0, at) + repl + src.slice(at + needle.length);
  }
  const countOf = (src: string, needle: string) => src.split(needle).length - 1;

  const SERIALIZABLE_LITERAL = '{ isolationLevel: "Serializable" }';
  const READ_COMMITTED_LITERAL = '{ isolationLevel: "ReadCommitted" }';

  const MUTATIONS: {
    name: string;
    file: string;
    needle: string;
    repl: string;
    occurrences: number;
    fns: string[];
  }[] = [
    {
      name: "invoice.actions.ts: el ternario SALE pierde withSerializableRetry",
      file: "src/modules/invoices/actions/invoice.actions.ts",
      needle: "? await withSerializableRetry(txBody)",
      repl: "? await prisma.$transaction(txBody)",
      occurrences: 1,
      fns: ["getNextControlNumber"],
    },
    {
      name: "invoice-batch.actions.ts: la rama SALE pierde withSerializableRetry",
      file: "src/modules/invoices/actions/invoice-batch.actions.ts",
      needle: "await withSerializableRetry(txBody);",
      repl: "await prisma.$transaction(txBody);",
      occurrences: 1,
      fns: ["getNextControlNumber"],
    },
    {
      name: "retention.actions.ts: el $transaction de IVA/ISLR pasa a ReadCommitted",
      file: "src/modules/retentions/actions/retention.actions.ts",
      needle: SERIALIZABLE_LITERAL,
      repl: READ_COMMITTED_LITERAL,
      occurrences: 1,
      fns: ["getNextIvaVoucherNumber", "getNextIslrVoucherNumber"],
    },
    {
      name: "CajaCajaMovementService.ts: createMovement pierde withSerializableRetry",
      file: "src/modules/cajachica/services/CajaCajaMovementService.ts",
      needle: "withSerializableRetry(async (tx) => {",
      repl: "prisma.$transaction(async (tx) => {",
      occurrences: 1,
      fns: ["getNextVoucherNumber"],
    },
    {
      name: "InvoiceCreditDebitNoteService.ts: NC y ND pierden el Serializable (una a la vez)",
      file: "src/modules/invoices/services/InvoiceCreditDebitNoteService.ts",
      needle: SERIALIZABLE_LITERAL,
      repl: READ_COMMITTED_LITERAL,
      occurrences: 2,
      fns: ["getNextControlNumber"],
    },
  ];

  it.each(MUTATIONS)("$name", ({ file: rel, needle, repl, occurrences, fns }) => {
    const target = file(rel);
    expect(target, `${rel}: el centinela apunta a un archivo que ya no existe`).toBeDefined();
    const original = target!.content;

    expect(
      countOf(original, needle),
      `${rel}: el código cambió de forma; actualiza la mutación (needle: ${needle})`
    ).toBe(occurrences);

    // Estado de partida: llamadas encontradas y cero violaciones.
    expect(
      collectCalls(original, rel).length,
      `${rel}: no se detectó ninguna llamada`
    ).toBeGreaterThan(0);
    expect(findCorrelativoViolations(original, rel)).toEqual([]);

    // Un sitio a la vez: si el guard solo mirara el primero, los demás quedarían sin cubrir.
    for (let i = 0; i < occurrences; i++) {
      const mutated = replaceNth(original, needle, repl, i);
      expect(mutated, `la mutación #${i + 1} no se aplicó`).not.toBe(original);
      const after = findCorrelativoViolations(mutated, rel);
      expect(
        after.map((v) => v.fn),
        `el guard NO detectó que se quitó el Serializable (mutación #${i + 1} de ${rel})`
      ).toEqual(fns);
      for (const v of after) expect(v.file).toBe(rel);
    }
  });
});

describe("Barrido de la clase: solo los generadores tocan las tablas de secuencia", () => {
  // Cierra el hueco del grep antiguo (cobertura 0 sobre los correlativos de retención) en el otro
  // sentido: si alguien escribe un generador NUEVO que haga upsert/update directo sobre una
  // tabla de secuencia, el detector por nombre no lo vería. Este test obliga a que esas tablas
  // solo se toquen desde los dos archivos que definen los generadores gobernados.
  const SEQUENCE_MODELS =
    /\.\s*(controlNumberSequence|ivaRetentionSequence|islrRetentionSequence)\b/;
  const ALLOWED = new Set(DEFINITION_ONLY);

  // Este test recorre su propia lista (no FILES): FILES se prefiltró por nombre de función.
  const all = walk(MODULES).map((abs) => ({
    rel: path.relative(ROOT, abs).replace(/\\/g, "/"),
    // Se quitan los comentarios de línea para no contar menciones.
    content: fs.readFileSync(abs, "utf-8").replace(/\/\/.*$/gm, ""),
  }));
  const touching = all.filter((f) => SEQUENCE_MODELS.test(f.content)).map((f) => f.rel);

  it("el patrón encuentra los accesos reales (no es un test que no puede fallar)", () => {
    expect(SEQUENCE_MODELS.test("await tx.controlNumberSequence.upsert({})")).toBe(true);
    expect(SEQUENCE_MODELS.test("await tx.ivaRetentionSequence.upsert({})")).toBe(true);
    expect(SEQUENCE_MODELS.test("await tx.islrRetentionSequence.upsert({})")).toBe(true);
    expect(touching.sort()).toEqual([...ALLOWED].sort());
  });

  it("ningún otro archivo accede a controlNumberSequence / ivaRetentionSequence / islrRetentionSequence", () => {
    const offenders = touching.filter((rel) => !ALLOWED.has(rel));
    expect(
      offenders,
      `Estos archivos tocan una tabla de secuencia fuera de su generador gobernado. Reutiliza ` +
        `getNextControlNumber / getNextIvaVoucherNumber / getNextIslrVoucherNumber, o añade el ` +
        `nuevo generador a GOVERNED_FUNCTIONS:\n${offenders.join("\n")}`
    ).toHaveLength(0);
  });
});
