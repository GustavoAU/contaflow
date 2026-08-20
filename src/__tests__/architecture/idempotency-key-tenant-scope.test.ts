// src/__tests__/architecture/idempotency-key-tenant-scope.test.ts
//
// Guard arquitectónico: NINGÚN lookup filtrado por `idempotencyKey` puede
// omitir `companyId`.
//
// Por qué existe este archivo
// ───────────────────────────
// `idempotencyKey` es `@unique` GLOBAL en 10 modelos (Expense, InventoryMovement,
// InvoicePayment, Invoice, Retention, PaymentBatch, ...). En varios de esos
// modelos el valor lo suministra el CLIENTE (`z.string().uuid()` en el schema).
// Un `findUnique({ where: { idempotencyKey } })` sin `companyId` devuelve
// entonces la fila de OTRA empresa: la empresa B recibe el registro de A y su
// propio registro no se crea nunca. Fuga cross-tenant + corrupción silenciosa.
//
// El guard existente `company-isolation.test.ts` NO cubre esto: excluye
// `findUnique` del detector a propósito ("PK lookups acceptable by design — PK
// is globally unique"). La premisa falla justamente aquí, porque el `@unique`
// no es la PK y la clave no la genera el servidor. Este test cierra ese hueco.
//
// ─────────────────────────────────────────────────────────────────────────────
// ENDURECIMIENTO (auditoría security-agent, 2026-08-19)
// ─────────────────────────────────────────────────────────────────────────────
// La primera versión decidía `scoped` con `window.includes("companyId")` sobre
// una ventana FIJA de líneas (3 antes / 6 después). Eso mide PROXIMIDAD TEXTUAL,
// no PERTENENCIA AL `where`, y el security-agent midió cuatro evasiones
// ejecutando el detector real:
//
//   1. `const companyId = ctx.companyId;` en la línea anterior  → falso negativo
//   2. `where: {` con 3+ campos antes de `idempotencyKey`       → NI SE DETECTA
//      (el `where: {` cae fuera de `WINDOW_BEFORE`), y al ser un sitio NUEVO el
//      ratchet `MIN_EXPECTED_SITES` tampoco lo compensa
//   3. `select: { id, companyId }` junto a un `where` sin acotar → falso negativo
//   4. `$queryRaw` con `"idempotencyKey"` en el SQL              → invisible
//
// Ahora el detector:
//   · ENMASCARA comentarios, strings, plantillas y regex (conservando offsets),
//     así que `includes("idempotencyKey")` o una mención en un comentario no
//     cuentan, y las llaves de un SQL o de un regex no descuadran el balanceo.
//   · Localiza el `where` que ENCIERRA la ocurrencia por BALANCEO de llaves
//     (hacia afuera, sin ventana) → mata el vector 2.
//   · Decide `scoped` exigiendo `companyId` en POSICIÓN DE CLAVE dentro de ese
//     bloque `where` → mata los vectores 1 y 3.
//   · Escanea `$queryRaw`/`$executeRaw` → cierra el vector 4.
//   · Neutraliza `NOT`/`isNot` (niegan, no acotan) y exige que TODAS las ramas de
//     un `OR` acoten, misma semántica que `whereIsScoped` en runtime.
//   · SE TESTEA A SÍ MISMO: los cuatro vectores medidos —más otros cuatro que
//     aparecieron al endurecerlo— viven abajo como fixtures sintéticos y DEBEN
//     salir marcados; y un test de MUTACIÓN le amputa el `companyId` a un archivo
//     REAL del repo (en memoria) para demostrar que el guard puede fallar. Un
//     guard que no se prueba a sí mismo es exactamente lo que falló aquí.
//
// LÍMITES CONOCIDOS (deliberados, cubiertos por otra capa)
//   · `const where = { idempotencyKey }; findFirst({ where })` — el `where` no es
//     un literal en el call-site, ningún análisis textual lo ve. Lo cubre la
//     aserción de runtime `assertViolation`/`whereIsScoped` (ADR-044 D-3), que
//     inspecciona los args REALES y por tanto es inmune a la forma del código.
//   · El SQL crudo es punto ciego compartido: `src/lib/prisma-tenant-assert.ts:19`
//     lo documenta (no hay `model` que inspeccionar) y el checklist de CLAUDE.md
//     lo cubre como regla D-8.2. El test 5 de este archivo es el centinela.
//   · Acotar por relación (`where: { idempotencyKey, company: { id } }`) NO se
//     acepta como acotado. Es un falso positivo consciente: hoy no existe ningún
//     call-site así, y el guard falla CERRADO — ensanchar las formas aceptadas es
//     ensanchar la superficie de evasión. Si algún día hace falta, el fallo imprime
//     el `where` analizado y la decisión se toma con el caso delante.
//   · Una clave `where` entrecomillada (`{ "where": { … } }`) sería invisible al ir
//     el contenido de los strings enmascarado — por eso el test 6 prohibe la forma
//     en vez de intentar interpretarla.
//
// Environment: node

import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(process.cwd());
const SRC = path.join(ROOT, "src");

// Nº mínimo de sitios que el detector DEBE encontrar (uno por bloque `where`, no
// por ocurrencia). Si alguien rompe el analizador —o borra los lookups— este
// número cae y el test falla: impide que el guard se degrade en silencio a un
// test que no puede fallar.
const MIN_EXPECTED_SITES = 9;

// Ídem para el escáner de SQL crudo: hoy NINGÚN raw menciona `idempotencyKey`,
// así que el test 5 sólo tiene valor si se demuestra que el escáner encuentra los
// raw que sí existen. Medido: 14 call-sites de producción (2026-08-19).
const MIN_EXPECTED_RAW_SITES = 10;

// Cuántos niveles de anidamiento se recorren hacia afuera buscando el `where`.
// `where: { AND: [{ OR: [{ idempotencyKey }] }] }` son 5 saltos; 8 da margen.
const MAX_OUTWARD_LEVELS = 8;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Enmascarado de no-código (conserva offsets)
// ─────────────────────────────────────────────────────────────────────────────
// Sustituye por espacios el CONTENIDO de comentarios, strings, plantillas y
// regex, conservando longitud y saltos de línea: los offsets del original siguen
// siendo válidos y los nº de línea también.
//
// El escáner es UNO SOLO con pila de contextos, no varios ad-hoc. La primera
// versión tenía un escáner aparte para `${…}` que no conocía los regex, y
// `` `"${v.replace(/"/g, '""')}"` `` (audit.actions.ts) lo descarrilaba: la
// comilla del regex abría un string fantasma que se comía el resto del archivo.
// Lo detectó el meta-test de balanceo del final — que es justo para qué está.

type Span = { start: number; end: number; kind: "string" | "template" };

type CodeFrame = {
  kind: "code";
  /** true si es el interior de un `${…}`: su `}` de cierre vuelve a la plantilla. */
  interpolation: boolean;
  depth: number;
  prevChar: string;
  prevPrev: string;
  prevWord: string;
};
type TemplateFrame = { kind: "template"; start: number };
type Frame = CodeFrame | TemplateFrame;

/**
 * Chars tras los que un `/` abre un regex (y no es una división).
 *
 * Deliberadamente NO incluye `<`, `>`, `}` ni operadores aritméticos: en TSX eso
 * convertía `</div>`, `<Foo {...p} />` y `<Bar />` en "regex" y blanqueaba código
 * real (52 archivos descuadrados, medido). El caso legítimo tras `>` es la flecha
 * `=>`, que se resuelve mirando el char anterior.
 */
const REGEX_PREV_CHARS = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", ";", "{"]);

/** Palabras tras las que un `/` abre un regex (`return /x/.test(y)`). */
const REGEX_PREV_WORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "case",
  "do",
  "else",
  "yield",
  "await",
  "delete",
  "void",
  "new",
  "throw",
]);

const WORD_CHAR = /[A-Za-z0-9_$]/;

/** Fin de un string `'…'` / `"…"`. Corta en el salto de línea: un apóstrofo de
 *  texto (`Don't`) no puede así comerse el resto del archivo. */
function scanQuoteEnd(src: string, start: number): number {
  const quote = src[start];
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === quote) return i;
    if (c === "\n") return i - 1; // sin terminar → daño acotado a la línea
  }
  return src.length - 1;
}

/** Fin de un regex literal. Respeta clases `[…]`, donde `/` no cierra. */
function scanRegexEnd(src: string, start: number): number {
  let inClass = false;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "\n") return i - 1;
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return i;
  }
  return src.length - 1;
}

function startsRegex(frame: CodeFrame, src: string, i: number): boolean {
  if (src[i + 1] === ">") return false; // cierre JSX `/>`
  if (frame.prevChar === ">") return frame.prevPrev === "="; // flecha `=>` sí, `>` de JSX no
  return REGEX_PREV_CHARS.has(frame.prevChar) || REGEX_PREV_WORDS.has(frame.prevWord);
}

export function scanSource(src: string): { code: string; literals: Span[] } {
  const out = src.split("");
  const literals: Span[] = [];
  const blank = (from: number, to: number) => {
    for (let k = Math.max(0, from); k < Math.min(to, src.length); k++) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };
  const setPrev = (frame: CodeFrame, ch: string, word = "") => {
    frame.prevPrev = frame.prevChar;
    frame.prevChar = ch;
    frame.prevWord = word;
  };
  const newCode = (interpolation: boolean): CodeFrame => ({
    kind: "code",
    interpolation,
    depth: 0,
    prevChar: "",
    prevPrev: "",
    prevWord: "",
  });

  const stack: Frame[] = [newCode(false)];
  let i = 0;

  while (i < src.length) {
    const frame = stack[stack.length - 1]!;
    const c = src[i]!;
    const next = src[i + 1];

    // ── interior de plantilla: se blanquea el texto, el código de `${…}` NO ──
    if (frame.kind === "template") {
      if (c === "\\") {
        blank(i, i + 2);
        i += 2;
        continue;
      }
      if (c === "`") {
        literals.push({ start: frame.start, end: i, kind: "template" });
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent && parent.kind === "code") setPrev(parent, "`");
        i++;
        continue;
      }
      if (c === "$" && next === "{") {
        // Se conservan `${` y su `}`: así el balanceo de llaves sigue cuadrando.
        i += 2;
        stack.push(newCode(true));
        continue;
      }
      blank(i, i + 1);
      i++;
      continue;
    }

    // ── código ──
    if (c === "/" && next === "/") {
      const start = i;
      while (i < src.length && src[i] !== "\n") i++;
      blank(start, i);
      continue;
    }
    if (c === "/" && next === "*") {
      const start = i;
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i = Math.min(i + 2, src.length);
      blank(start, i);
      continue;
    }
    if (c === "'" || c === '"') {
      const end = scanQuoteEnd(src, i);
      if (src[end] === c && end > i) literals.push({ start: i, end, kind: "string" });
      blank(i + 1, end);
      i = end + 1;
      setPrev(frame, '"');
      continue;
    }
    if (c === "`") {
      stack.push({ kind: "template", start: i });
      i++;
      continue;
    }
    if (c === "/" && startsRegex(frame, src, i)) {
      const end = scanRegexEnd(src, i);
      blank(i + 1, end);
      i = end + 1;
      setPrev(frame, "x"); // tras un regex, el `/` siguiente es división
      continue;
    }
    if (WORD_CHAR.test(c)) {
      let j = i;
      while (j < src.length && WORD_CHAR.test(src[j]!)) j++;
      setPrev(frame, src[j - 1]!, src.slice(i, j));
      i = j;
      continue;
    }
    if (c === "{") {
      frame.depth++;
      setPrev(frame, c);
      i++;
      continue;
    }
    if (c === "}") {
      if (frame.interpolation && frame.depth === 0) {
        stack.pop(); // cierra el `${…}` y vuelve a la plantilla
        i++;
        continue;
      }
      frame.depth = Math.max(0, frame.depth - 1);
      setPrev(frame, c);
      i++;
      continue;
    }
    if (!/\s/.test(c)) setPrev(frame, c);
    i++;
  }

  return { code: out.join(""), literals };
}

export const maskNonCode = (src: string): string => scanSource(src).code;

// ─────────────────────────────────────────────────────────────────────────────
// 2. Navegación por balanceo de llaves
// ─────────────────────────────────────────────────────────────────────────────

/** Índice del abridor (`{`, `(`, `[`) que ENCIERRA la posición dada, o null. */
function findEnclosingOpener(code: string, from: number): number | null {
  let depth = 0;
  for (let k = from - 1; k >= 0; k--) {
    const ch = code[k]!;
    if (ch === "}" || ch === ")" || ch === "]") depth++;
    else if (ch === "{" || ch === "(" || ch === "[") {
      if (depth === 0) return k;
      depth--;
    }
  }
  return null;
}

/** Índice del cierre que corresponde al abridor `{`/`[`/`(` dado. */
function matchClosing(code: string, open: number): number {
  const openCh = code[open]!;
  const closeCh = openCh === "{" ? "}" : openCh === "[" ? "]" : ")";
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    const ch = code[k];
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return k;
    }
  }
  return code.length - 1;
}

/** ¿Este `{` es el que abre un `where:`? (con frontera de palabra: `somewhere:` no) */
function isWhereOpener(code: string, open: number): boolean {
  if (code[open] !== "{") return false;
  const before = code.slice(Math.max(0, open - 60), open);
  return /(?:^|[^\w$])where\s*:\s*$/.test(before);
}

/**
 * Bloque `where` que ENCIERRA la ocurrencia, buscado hacia afuera por balanceo.
 *
 * Es la pieza que mata el vector 2: sin ventana de líneas, da igual cuántos
 * campos haya antes de `idempotencyKey` dentro del `where`. Y como sólo recorre
 * ANCESTROS, un `data: { idempotencyKey }` hermano de un `where: {…}` nunca se
 * confunde con un filtro: las llaves del `where` no lo encierran.
 */
function findEnclosingWhereBlock(code: string, idx: number): { open: number; close: number } | null {
  let pos = idx;
  for (let level = 0; level < MAX_OUTWARD_LEVELS; level++) {
    const opener = findEnclosingOpener(code, pos);
    if (opener === null) return null;
    if (isWhereOpener(code, opener)) {
      return { open: opener, close: matchClosing(code, opener) };
    }
    pos = opener;
  }
  return null;
}

/** Nombre del método cuya llamada `(` encierra la posición (`findFirst`, …). */
function enclosingCallName(code: string, from: number): string | null {
  let pos = from;
  for (let level = 0; level < MAX_OUTWARD_LEVELS; level++) {
    const opener = findEnclosingOpener(code, pos);
    if (opener === null) return null;
    if (code[opener] === "(") {
      const m = /([\w$]+)\s*$/.exec(code.slice(Math.max(0, opener - 80), opener));
      return m ? m[1]! : null;
    }
    pos = opener;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ¿El bloque `where` acota por companyId?
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `companyId` en POSICIÓN DE CLAVE de objeto — explícita (`companyId:`) o
 * abreviada (`{ companyId, … }` / `{ …, companyId }`).
 *
 * No matchea `companyId_idempotencyKey:` (le sigue `_`), que se resuelve por el
 * `companyId` de dentro del selector compuesto. Tampoco matchea
 * `tenant: input.companyId` como VALOR (le precede un `.`).
 */
const COMPANY_ID_KEY = /(?:^|[{,[(\s])companyId\s*(?::|,|\}|$)/;

type KeyedBlock = { keyStart: number; open: number; close: number; body: string };

/** Localiza `KEY: { … }` / `KEY: [ … ]` a cualquier profundidad del texto. */
function findKeyedBlocks(text: string, key: string): KeyedBlock[] {
  const re = new RegExp(`(?:^|[^\\w$])(${key})\\s*:\\s*[{[]`, "g");
  const found: KeyedBlock[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchClosing(text, open);
    found.push({
      keyStart: m.index + m[0].indexOf(key),
      open,
      close,
      body: text.slice(open, close + 1),
    });
    re.lastIndex = open + 1; // permite ver claves anidadas dentro del bloque
  }
  return found;
}

function removeSpans(text: string, spans: { keyStart: number; close: number }[]): string {
  const sorted = [...spans].sort((a, b) => b.keyStart - a.keyStart);
  let out = text;
  for (const s of sorted) {
    if (s.keyStart < 0 || s.close >= out.length) continue;
    out = out.slice(0, s.keyStart) + " ".repeat(s.close - s.keyStart + 1) + out.slice(s.close + 1);
  }
  return out;
}

/** Objetos `{…}` de primer nivel dentro de un array `[ {…}, {…} ]`. */
function topLevelObjects(arrayBody: string): string[] {
  const items: string[] = [];
  for (let i = 1; i < arrayBody.length; i++) {
    if (arrayBody[i] !== "{") continue;
    const close = matchClosing(arrayBody, i);
    items.push(arrayBody.slice(i, close + 1));
    i = close;
  }
  return items;
}

/**
 * Semántica de combinadores, la misma que `whereIsScoped` en runtime:
 *   · `AND` — basta una rama que acote (restringe el conjunto entero).
 *   · `OR`  — deben acotar TODAS; si una no acota, la unión se sale de la empresa.
 *   · `NOT` / `isNot` — no acotan nunca: niegan.
 */
export function whereBlockIsScoped(block: string, depth = 0): boolean {
  if (depth > 4) return false;

  const negations = [...findKeyedBlocks(block, "NOT"), ...findKeyedBlocks(block, "isNot")];
  const withoutNegations = removeSpans(block, negations);

  const orBlocks = findKeyedBlocks(withoutNegations, "OR");
  const outsideOr = removeSpans(withoutNegations, orBlocks);

  // companyId fuera de cualquier `OR` → acota (top-level o rama de un AND).
  if (COMPANY_ID_KEY.test(outsideOr)) return true;

  // …o bien TODAS las ramas de algún `OR` acotan.
  for (const or of orBlocks) {
    const branches = or.body.startsWith("[") ? topLevelObjects(or.body) : [or.body];
    if (branches.length > 0 && branches.every((b) => whereBlockIsScoped(b, depth + 1))) return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Detectores
// ─────────────────────────────────────────────────────────────────────────────

export type Site = {
  file: string;
  line: number;
  text: string;
  scoped: boolean;
  operation: string | null;
  whereBlock: string;
};

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === "\n") line++;
  return line;
}

function lineTextAt(content: string, index: number): string {
  const start = content.lastIndexOf("\n", index) + 1;
  const end = content.indexOf("\n", index);
  return content
    .slice(start, end === -1 ? content.length : end)
    .trim()
    .slice(0, 140);
}

/**
 * Usos de `idempotencyKey` como FILTRO (dentro de un `where`), no como dato de
 * escritura (`data: { idempotencyKey: … }`, que es legítimo).
 *
 * La unidad es el BLOQUE `where`, no la ocurrencia: `{ idempotencyKey:
 * input.idempotencyKey }` tiene dos ocurrencias del identificador y es un solo
 * sitio. Así el ratchet cuenta lo mismo que contaba la versión por líneas.
 */
export function findFilterSites(content: string, relPath: string): Site[] {
  const { code } = scanSource(content);
  const sites: Site[] = [];
  const seen = new Set<number>();
  const re = /\bidempotencyKey\b/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(code)) !== null) {
    const where = findEnclosingWhereBlock(code, m.index);
    if (!where || seen.has(where.open)) continue;
    seen.add(where.open);

    const whereBlock = code.slice(where.open, where.close + 1);
    sites.push({
      file: relPath,
      line: lineOf(content, m.index),
      text: lineTextAt(content, m.index),
      scoped: whereBlockIsScoped(whereBlock),
      operation: enclosingCallName(code, where.open),
      whereBlock: whereBlock.replace(/\s+/g, " ").slice(0, 200),
    });
  }

  return sites;
}

export type RawSite = { file: string; line: number; method: string; sql: string };

/**
 * `$queryRaw` / `$executeRaw` (+ variantes `Unsafe`) con su literal SQL.
 *
 * La BÚSQUEDA va sobre el código enmascarado —así un `$queryRaw` citado en un
 * comentario no genera un sitio fantasma, p. ej. el propio comentario de
 * `prisma-tenant-assert.ts:19`— y el SQL se recupera del ORIGINAL usando los
 * spans de literales que devuelve el escáner (mismos offsets).
 */
export function findRawSqlSites(content: string, relPath: string): RawSite[] {
  const { code, literals } = scanSource(content);
  const sites: RawSite[] = [];
  const re = /\$(?:queryRaw|executeRaw)(?:Unsafe)?\b/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(code)) !== null) {
    const head = m.index + m[0].length;
    // Entre el método y el literal sólo caben genéricos, espacios y `(`.
    const literal = literals.find(
      (l) => l.start >= head && l.start <= head + 220 && !code.slice(head, l.start).includes(";"),
    );
    const sql = literal
      ? content.slice(literal.start, literal.end + 1)
      : // SQL armado fuera del call-site: se conserva una ventana amplia para no
        // perder la señal (fail-loud antes que fail-silent).
        content.slice(m.index, Math.min(m.index + 600, content.length));
    sites.push({ file: relPath, line: lineOf(content, m.index), method: m[0], sql });
  }

  return sites;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Recorrido del repo
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

const FILES = walk(SRC).map((abs) => ({
  rel: path.relative(ROOT, abs).replace(/\\/g, "/"),
  content: fs.readFileSync(abs, "utf-8"),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Architecture: lookups por idempotencyKey acotados a companyId", () => {
  const sites = FILES.flatMap((f) => findFilterSites(f.content, f.rel));

  it("el detector encuentra los sitios reales (no es un test que no puede fallar)", () => {
    expect(
      sites.length,
      `El detector solo encontró ${sites.length} filtros por idempotencyKey. ` +
        `Si el patrón cambió de forma, ajusta el analizador — no bajes el mínimo.`,
    ).toBeGreaterThanOrEqual(MIN_EXPECTED_SITES);
  });

  it("ningún filtro por idempotencyKey omite companyId (IDOR cross-tenant)", () => {
    const violations = sites
      .filter((s) => !s.scoped)
      .map(
        (s) =>
          `[${s.file}:${s.line}] filtro por idempotencyKey SIN companyId en el where — IDOR cross-tenant\n` +
          `  ${s.text}\n` +
          `  where analizado: ${s.whereBlock}`,
      );

    expect(
      violations,
      `\`idempotencyKey\` es @unique GLOBAL y en varios modelos lo suministra el cliente.\n` +
        `Un lookup sin companyId devuelve la fila de otra empresa.\n\n${violations.join("\n\n")}`,
    ).toHaveLength(0);
  });

  it("los 3 sitios del IDOR corregido siguen acotados", () => {
    // Sentinelas explícitos: si alguien revierte uno de estos, falla con nombre
    // y apellido en vez de perderse en un conteo agregado.
    const REGRESSION_SITES = [
      "src/modules/expenses/services/ExpenseService.ts",
      "src/modules/inventory/services/InventoryOperationsService.ts",
      "src/modules/payments/services/PaymentBatchService.ts",
    ];

    for (const file of REGRESSION_SITES) {
      const own = sites.filter((s) => s.file === file);
      expect(own.length, `${file}: no se encontró el lookup por idempotencyKey`).toBeGreaterThan(0);
      for (const s of own) {
        expect(s.scoped, `${file}:${s.line} volvió a filtrar sin companyId`).toBe(true);
      }
    }
  });

  it("ningún findUnique busca por idempotencyKey sin companyId", () => {
    // `findUnique` sobre el `@unique` GLOBAL no se puede acotar por companyId
    // (Prisma solo admite campos únicos en su where) → hay que usar `findFirst`.
    // Queda permitido el selector compuesto de un `@@unique([companyId,
    // idempotencyKey])`, porque ahí el companyId SÍ forma parte de la clave:
    //   findUnique({ where: { companyId_idempotencyKey: { companyId, ... } } })
    const offenders = sites
      .filter((s) => s.operation === "findUnique" || s.operation === "findUniqueOrThrow")
      .filter((s) => !s.scoped)
      .map((s) => `[${s.file}:${s.line}] ${s.text}`);

    expect(
      offenders,
      `findUnique por idempotencyKey sin companyId → usar findFirst acotado (o el selector compuesto companyId_idempotencyKey):\n${offenders.join("\n")}`,
    ).toHaveLength(0);
  });

  it("ningún SQL crudo toca idempotencyKey sin companyId (punto ciego de la aserción de tenant)", () => {
    // `$queryRaw`/`$executeRaw` no los ve NI la extensión de runtime (no hay
    // `model` que inspeccionar — src/lib/prisma-tenant-assert.ts:19) NI el
    // análisis de `where` de arriba. Es la regla D-8.2 del checklist de CLAUDE.md
    // aplicada al caso concreto de `idempotencyKey`.
    const rawSites = FILES.flatMap((f) => findRawSqlSites(f.content, f.rel));

    // El centinela sólo vale si se demuestra que el escáner encuentra los raw que
    // SÍ existen; si no, sería un test que no puede fallar.
    expect(
      rawSites.length,
      `El escáner de SQL crudo sólo encontró ${rawSites.length} call-sites. ` +
        `Si $queryRaw/$executeRaw cambiaron de forma, ajusta el escáner.`,
    ).toBeGreaterThanOrEqual(MIN_EXPECTED_RAW_SITES);

    const offenders = rawSites
      .filter((s) => /idempotencyKey/i.test(s.sql) && !/"companyId"/.test(s.sql))
      .map((s) => `[${s.file}:${s.line}] ${s.method} — SQL con idempotencyKey y sin "companyId"`);

    expect(
      offenders,
      `SQL crudo que filtra por idempotencyKey debe incluir \`"companyId" = \${companyId}\` ` +
        `explícito (también en JOINs y EXISTS anidados — CLAUDE.md D-8.2):\n${offenders.join("\n")}`,
    ).toHaveLength(0);
  });

  it("el `where` se escribe siempre como clave plana (una clave entrecomillada sería invisible)", () => {
    // `{ "where": { idempotencyKey } }` es JS válido y Prisma lo acepta, pero el
    // contenido de los strings va enmascarado: ese `where` no lo vería el
    // analizador. En vez de ensanchar el analizador con una forma que NADIE usa
    // (medido: 0 ocurrencias en src/), se bloquea la forma. El fallo dice qué
    // hacer: escribir `where:` plano.
    //
    // Auto-verificación del patrón: sin esto, un regex roto convertiría esta
    // prohibición en un test que no puede fallar (hoy hay 0 ocurrencias reales).
    expect(/["'`]where["'`]\s*:/.test('{ "where": { idempotencyKey } }')).toBe(true);

    const offenders: string[] = [];
    for (const f of FILES) {
      const re = /["'`]where["'`]\s*:/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.content)) !== null) {
        offenders.push(`${f.rel}:${lineOf(f.content, m.index)} ${lineTextAt(f.content, m.index)}`);
      }
    }

    expect(
      offenders,
      `Clave \`where\` entrecomillada — el guard de idempotencyKey no puede analizarla. ` +
        `Escríbela como clave plana \`where: { … }\`:\n${offenders.join("\n")}`,
    ).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// META-TESTS: el detector contra los vectores de evasión medidos
// ─────────────────────────────────────────────────────────────────────────────
// Sin esto no hay forma de saber si el endurecimiento funciona. Cada fixture es
// una evasión que el security-agent midió ejecutando la versión anterior.

describe("Meta: el detector caza las evasiones medidas (2026-08-19)", () => {
  const onlySite = (src: string): Site => {
    const found = findFilterSites(src, "fixture.ts");
    expect(found.length, `el fixture debía producir 1 sitio, produjo ${found.length}`).toBe(1);
    return found[0]!;
  };

  it("VECTOR 1 — `const companyId = ctx.companyId` en la línea anterior no acota", () => {
    const site = onlySite(`
      const companyId = ctx.companyId;
      const dupe = await prisma.expense.findFirst({
        where: { idempotencyKey: input.idempotencyKey },
      });
    `);
    expect(site.scoped).toBe(false);
  });

  it("VECTOR 2 — where con 5 campos antes de idempotencyKey SÍ se detecta", () => {
    // El fallo grave de la versión anterior: `where: {` caía fuera de la ventana
    // de 3 líneas, así que el sitio no se detectaba EN ABSOLUTO (ni como
    // violación ni como sitio, con lo que el ratchet tampoco lo delataba).
    const site = onlySite(`
      const dupe = await prisma.expense.findFirst({
        where: {
          deletedAt: null,
          status: "CONFIRMED",
          vendorId: input.vendorId,
          date: input.date,
          amount: input.amount,
          idempotencyKey: input.idempotencyKey,
        },
      });
    `);
    expect(site.scoped).toBe(false);
  });

  it("VECTOR 3 — companyId en el `select` no acota el `where`", () => {
    const site = onlySite(`
      const dupe = await prisma.expense.findFirst({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, companyId: true },
      });
    `);
    expect(site.scoped).toBe(false);
  });

  it("VECTOR 4 — $queryRaw con idempotencyKey y sin companyId se marca", () => {
    const src =
      "await prisma.$queryRaw`SELECT id FROM \"Expense\" WHERE \"idempotencyKey\" = ${key}`;";
    const raw = findRawSqlSites(src, "fixture.ts");
    expect(raw).toHaveLength(1);
    expect(/idempotencyKey/.test(raw[0]!.sql)).toBe(true);
    expect(/"companyId"/.test(raw[0]!.sql)).toBe(false);
  });

  it("VECTOR 5 — companyId dentro de un NOT no acota (niega, no restringe)", () => {
    const site = onlySite(`
      const dupe = await prisma.expense.findFirst({
        where: { idempotencyKey: input.idempotencyKey, NOT: { companyId: other } },
      });
    `);
    expect(site.scoped).toBe(false);
  });

  it("VECTOR 6 — OR con una rama sin companyId no acota", () => {
    const site = onlySite(`
      const dupe = await prisma.expense.findFirst({
        where: { OR: [{ companyId: c }, { idempotencyKey: k }] },
      });
    `);
    expect(site.scoped).toBe(false);
  });

  it("VECTOR 7 — companyId como VALOR (no como clave) no acota", () => {
    const site = onlySite(`
      const dupe = await prisma.expense.findFirst({
        where: { idempotencyKey: input.idempotencyKey, tenant: input.companyId },
      });
    `);
    expect(site.scoped).toBe(false);
  });

  it("VECTOR 8 — mención en comentario o string no cuenta como acotamiento", () => {
    const site = onlySite(`
      // acotado por companyId, de verdad, lo prometo
      const dupe = await prisma.expense.findFirst({
        where: { idempotencyKey: input.idempotencyKey, tag: "companyId" },
      });
    `);
    expect(site.scoped).toBe(false);
  });
});

describe("Meta: el detector NO produce falsos positivos", () => {
  const analyze = (src: string) => findFilterSites(src, "fixture.ts");

  it("el `where` real del repo (companyId explícito) sale acotado", () => {
    const sites = analyze(`
      const existing = await prisma.expense.findFirst({
        where: { idempotencyKey: input.idempotencyKey, companyId: input.companyId },
        include: { category: { select: { name: true } } },
      });
    `);
    expect(sites).toHaveLength(1);
    expect(sites[0]!.scoped).toBe(true);
    expect(sites[0]!.operation).toBe("findFirst");
  });

  it("companyId abreviado (`{ idempotencyKey, companyId }`) sale acotado", () => {
    const sites = analyze(`
      const existing = await tx.inventoryMovement.findFirst({
        where: { idempotencyKey, companyId },
      });
    `);
    expect(sites[0]!.scoped).toBe(true);
  });

  it("selector compuesto companyId_idempotencyKey sale acotado", () => {
    const sites = analyze(`
      const existing = await prisma.expense.findUnique({
        where: { companyId_idempotencyKey: { companyId, idempotencyKey } },
      });
    `);
    expect(sites[0]!.scoped).toBe(true);
    expect(sites[0]!.operation).toBe("findUnique");
  });

  it("AND con una rama que acota sale acotado", () => {
    const sites = analyze(`
      const existing = await prisma.expense.findFirst({
        where: { AND: [{ companyId: input.companyId }, { idempotencyKey: key }] },
      });
    `);
    expect(sites[0]!.scoped).toBe(true);
  });

  it("OR con TODAS las ramas acotadas sale acotado", () => {
    const sites = analyze(`
      const existing = await prisma.expense.findFirst({
        where: {
          OR: [
            { companyId: c, idempotencyKey: k1 },
            { companyId: c, idempotencyKey: k2 },
          ],
        },
      });
    `);
    expect(sites[0]!.scoped).toBe(true);
  });

  it("escritura (`data: { idempotencyKey }`) no es un sitio de filtro", () => {
    expect(
      analyze(`
        await tx.expense.create({
          data: { companyId: input.companyId, idempotencyKey: input.idempotencyKey },
        });
        await tx.expense.update({
          where: { id, companyId },
          data: { lines: { create: { idempotencyKey: k } } },
        });
      `),
    ).toHaveLength(0);
  });

  it('P2002 target (`meta.target.includes("idempotencyKey")`) no es un sitio', () => {
    expect(
      analyze(`
        if (isPrismaError(error, "P2002")) {
          const meta = error.meta as { target?: string[] };
          if (meta?.target?.includes("idempotencyKey")) return duplicado();
        }
      `),
    ).toHaveLength(0);
  });

  it("un comentario que muestra el antipatrón no es un sitio", () => {
    expect(
      analyze(`
        // Antes era \`findUnique({ where: { idempotencyKey } })\` sobre un @unique GLOBAL.
        /* where: { idempotencyKey } — así NO */
        const x = 1;
      `),
    ).toHaveLength(0);
  });

  it("SQL crudo con companyId explícito no se marca", () => {
    const src =
      'await tx.$executeRaw`SELECT id FROM "Expense" WHERE "companyId" = ${companyId} AND "idempotencyKey" = ${key}`;';
    const raw = findRawSqlSites(src, "fixture.ts");
    expect(raw).toHaveLength(1);
    expect(/"companyId"/.test(raw[0]!.sql)).toBe(true);
  });
});

describe("Meta: el guard PUEDE fallar sobre código real (mutación)", () => {
  // Los fixtures sintéticos prueban la lógica; esto prueba el circuito completo
  // — archivo real del repo, leído de disco, con el `companyId` amputado en
  // memoria. Si este test pasara en verde con la mutación aplicada, el guard
  // sería decorativo. No se escribe nada a disco.
  const TARGET = "src/modules/expenses/services/ExpenseService.ts";
  const SCOPED_WHERE = "{ idempotencyKey: input.idempotencyKey, companyId: input.companyId }";
  const UNSCOPED_WHERE = "{ idempotencyKey: input.idempotencyKey }";

  it("el archivo real sale acotado; amputarle el companyId lo vuelve violación", () => {
    const target = FILES.find((f) => f.rel === TARGET);
    expect(target, `${TARGET}: el sentinela apunta a un archivo que ya no existe`).toBeDefined();

    const before = findFilterSites(target!.content, TARGET);
    expect(before.length, `${TARGET}: no se detectó el lookup por idempotencyKey`).toBe(1);
    expect(before[0]!.scoped).toBe(true);

    const mutated = target!.content.replace(SCOPED_WHERE, UNSCOPED_WHERE);
    expect(
      mutated,
      `la mutación no se aplicó — el where cambió de forma; actualiza SCOPED_WHERE`,
    ).not.toBe(target!.content);

    const after = findFilterSites(mutated, TARGET);
    expect(after.length, "la mutación no debe hacer desaparecer el sitio").toBe(1);
    expect(after[0]!.scoped, "el guard NO detectó la pérdida del companyId").toBe(false);
  });
});

describe("Meta: integridad del enmascarado", () => {
  it("preserva longitud y saltos de línea (los offsets siguen siendo válidos)", () => {
    for (const f of FILES) {
      const masked = maskNonCode(f.content);
      expect(masked.length, `${f.rel}: el enmascarado cambió la longitud`).toBe(f.content.length);
      expect(masked.split("\n").length, `${f.rel}: el enmascarado cambió el nº de líneas`).toBe(
        f.content.split("\n").length,
      );
    }
  });

  it("maneja regex dentro de interpolaciones de plantilla (audit.actions.ts:211)", () => {
    // Regresión del escáner: `` `"${v.replace(/"/g, '""')}"` `` descarrilaba la
    // versión con escáner de interpolaciones separado (no conocía los regex), y
    // el string fantasma se comía el resto del archivo.
    const code = maskNonCode(
      'const escape = (v: string) => `"${v.replace(/"/g, \'""\')}"`;\nconst after = { a: 1 };',
    );
    expect(code).toContain("v.replace(");
    expect(code).toContain("{ a: 1 }");
  });

  it("no confunde JSX (`</div>`, `<Foo {...p} />`) con literales regex", () => {
    const code = maskNonCode(
      "const El = () => (\n  <div>\n    <Foo {...p} />\n  </div>\n);\nconst after = { b: 2 };",
    );
    expect(code).toContain("{ b: 2 }");
    expect(code).toContain("{...p}");
  });

  it("deja todo archivo del repo con llaves balanceadas", () => {
    // Prueba empírica de que el enmascarado no corrompe la estructura: si un SQL
    // en plantilla, un regex con `\\{` o una comilla de texto JSX rompieran el
    // escáner, el balanceo se descuadraría y el análisis de `where` se volvería
    // basura EN SILENCIO. Aquí no: falla con el archivo señalado.
    const broken: string[] = [];
    for (const f of FILES) {
      const masked = maskNonCode(f.content);
      let depth = 0;
      let min = 0;
      for (const ch of masked) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        if (depth < min) min = depth;
      }
      if (depth !== 0 || min < 0) broken.push(`${f.rel} (balance final ${depth}, mínimo ${min})`);
    }
    expect(
      broken,
      `El enmascarado descuadra estos archivos — el análisis por balanceo no es fiable en ellos:\n${broken.join("\n")}`,
    ).toHaveLength(0);
  });
});
