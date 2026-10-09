// src/__tests__/architecture/agents-frontmatter.test.ts
//
// Guard arquitectónico: la cabecera (frontmatter) de cada subagente de `.claude/agents/` tiene que
// ser YAML que el cargador de Claude Code pueda leer.
//
// Qué protege
// ───────────
// Un agente con la cabecera inválida NO se carga y no avisa: simplemente no aparece entre los
// subagentes disponibles. Ya pasó dos veces con la misma causa:
//   · 2026-06-20: 5 de 7 agentes sin cargar por un `: ` (dos puntos y espacio) sin comillas dentro
//     de `description` (ver la nota `agentes-no-cargan-yaml-crlf` de la memoria);
//   · 2026-10-08: `orchestrator-agent` con `Usar para: planificar…` en su `description`. `js-yaml`
//     lo rechaza con «bad indentation of a mapping entry» (línea 2, columna 57) y el agente
//     dejó de estar disponible para la sesión principal sin ningún error visible.
//
// El análisis es de TEXTO (el repo aún no tiene un parser YAML como dependencia directa; SPEC-020
// lo añadirá y entonces conviene sustituir esto por un parseo real). Por eso cada comprobación se
// prueba también contra fixtures MALOS: un guard que no puede fallar no protege nada.
//
// Reglas (todas sobre el valor de un escalar PLANO, el que no empieza por comilla, `|`, `>`, `[`
// ni `{`):
//   · no puede contener `: ` ni terminar en `:` (YAML lo toma por otra clave: el archivo no parsea);
//   · no puede contener ` #` (empieza un comentario y recorta el valor en silencio).
// Si hace falta uno de los dos, el valor entero va entre comillas.
// Además: `name` coincide con el nombre del archivo y `description` no está vacía.
//
// Environment: node

import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const AGENTS_DIR = path.resolve(process.cwd(), ".claude", "agents");

/** Quita un par de comillas que envuelva el valor entero. */
function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.endsWith(v[0])) return v.slice(1, -1);
  return v;
}

/** Devuelve los problemas de la cabecera de un agente; `[]` si es válida. */
function findFrontmatterProblems(raw: string, fileName: string): string[] {
  const lines = raw.split(/\r?\n/);
  if (!/^---\s*$/.test(lines[0] ?? ""))
    return ["no empieza con una línea `---` (falta la cabecera)"];
  const end = lines.findIndex((l, i) => i > 0 && /^---\s*$/.test(l));
  if (end === -1) return ["la cabecera no se cierra con una segunda línea `---`"];

  const problems: string[] = [];
  // clave → [primera línea del valor, ...líneas de continuación]
  const fields = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "") continue;
    if (/^\s/.test(line)) {
      if (current === null) problems.push(`línea con sangría sin clave previa: «${line.trim()}»`);
      else fields.get(current)!.push(line.trim());
      continue;
    }
    const m = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/.exec(line);
    if (!m) {
      problems.push(`línea que no es «clave: valor»: «${line}»`);
      current = null;
      continue;
    }
    current = m[1];
    fields.set(current, [m[2] ?? ""]);
  }

  for (const [key, parts] of fields) {
    const textParts = parts.filter((p) => p !== "");
    if (textParts.length === 0) continue; // clave sin valor (null en YAML); `name`/`description` se exigen abajo
    const text = textParts.join(" ");
    const lead = textParts[0][0];
    if (lead === '"' || lead === "'") {
      if (text.length < 2 || !text.endsWith(lead))
        problems.push(`${key}: comilla ${lead} sin cerrar`);
      continue;
    }
    if (lead === "|" || lead === ">" || lead === "[" || lead === "{") continue;
    if (/:(\s|$)/.test(text)) {
      problems.push(`${key}: lleva «: » (dos puntos y espacio) sin comillas; el YAML no parsea`);
    }
    if (/\s#/.test(text)) {
      problems.push(`${key}: lleva « #» sin comillas; empieza un comentario y recorta el valor`);
    }
  }

  const valueOf = (key: string) =>
    unquote((fields.get(key) ?? []).filter((p) => p !== "").join(" "));
  const name = valueOf("name");
  if (name === "") problems.push("falta `name`");
  else if (name !== fileName.replace(/\.md$/, "")) {
    problems.push(`name «${name}» no coincide con el archivo «${fileName}»`);
  }
  if (valueOf("description") === "") problems.push("falta `description` o está vacía");
  return problems;
}

const head = (lines: string[], eol = "\n") => lines.join(eol) + eol;

describe("findFrontmatterProblems — fixtures buenos", () => {
  const ok = (raw: string) => expect(findFrontmatterProblems(raw, "x-agent.md")).toEqual([]);

  it("escalar plano en una línea", () => {
    ok(
      head([
        "---",
        "name: x-agent",
        "description: Hace cosas. Usar cuando haga falta.",
        "tools: Read, Glob",
        "---",
        "",
        "cuerpo: libre",
      ])
    );
  });
  it("escalar plano que continúa en varias líneas (estilo de test-agent)", () => {
    ok(
      head([
        "---",
        "name: x-agent",
        "description: QA riguroso de ContaFlow",
        "  con Vitest 4 — y más.",
        "tools: Read",
        "---",
      ])
    );
  });
  it("con fin de línea CRLF", () => {
    ok(head(["---", "name: x-agent", "description: Hace cosas", "---"], "\r\n"));
  });
  it("con `: ` dentro de comillas dobles o simples", () => {
    ok(head(["---", "name: x-agent", 'description: "Usar para: planificar"', "---"]));
    ok(head(["---", "name: x-agent", "description: 'Usar para: planificar'", "---"]));
  });
  it("con `: ` dentro de un bloque `>` o `|`", () => {
    ok(head(["---", "name: x-agent", "description: >", "  Usar para: planificar", "---"]));
    ok(head(["---", "name: x-agent", "description: |", "  Usar para: planificar", "---"]));
  });
  it("con dos puntos sin espacio posterior (una ruta o una hora) en un escalar plano", () => {
    ok(head(["---", "name: x-agent", "description: Reglas de C:\\ruta y 10:30", "---"]));
  });
});

describe("findFrontmatterProblems — fixtures MALOS (el guard puede fallar)", () => {
  const bad = (raw: string, expected: RegExp) => {
    const problems = findFrontmatterProblems(raw, "x-agent.md");
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(" | ")).toMatch(expected);
  };

  it("`: ` sin comillas en la misma línea (el caso de orchestrator-agent)", () => {
    bad(
      head(["---", "name: x-agent", "description: Coordinador. Usar para: planificar", "---"]),
      /description: lleva «: »/
    );
  });
  it("lo mismo con CRLF", () => {
    bad(
      head(["---", "name: x-agent", "description: Usar para: planificar", "---"], "\r\n"),
      /description: lleva «: »/
    );
  });
  it("`: ` en una línea de continuación", () => {
    bad(
      head([
        "---",
        "name: x-agent",
        "description: Primera línea",
        "  segunda: con dos puntos",
        "---",
      ]),
      /description: lleva «: »/
    );
  });
  it("valor plano que termina en `:`", () => {
    bad(
      head(["---", "name: x-agent", "description: Usar para:", "---"]),
      /description: lleva «: »/
    );
  });
  it("` #` sin comillas", () => {
    bad(
      head(["---", "name: x-agent", "description: Ver ADR #12 antes", "---"]),
      /description: lleva « #»/
    );
  });
  it("comilla sin cerrar", () => {
    bad(head(["---", "name: x-agent", 'description: "sin cerrar', "---"]), /comilla " sin cerrar/);
  });
  it("sin cabecera, o cabecera sin cerrar", () => {
    bad("name: x-agent\n", /falta la cabecera/);
    bad("---\nname: x-agent\ndescription: algo\n", /no se cierra/);
  });
  it("`name` distinto del archivo, ausente, o `description` ausente o vacía", () => {
    bad(
      head(["---", "name: otro-agent", "description: algo", "---"]),
      /no coincide con el archivo/
    );
    bad(head(["---", "description: algo", "---"]), /falta `name`/);
    bad(head(["---", "name: x-agent", "---"]), /falta `description`/);
    bad(head(["---", "name: x-agent", 'description: ""', "---"]), /falta `description`/);
  });
  it("línea que no es «clave: valor»", () => {
    bad(
      head(["---", "name: x-agent", "descripcion sin dos puntos", "description: algo", "---"]),
      /no es «clave: valor»/
    );
  });
});

describe("agentes reales de .claude/agents/", () => {
  const files = fs.existsSync(AGENTS_DIR)
    ? fs
        .readdirSync(AGENTS_DIR)
        .filter((f) => f.endsWith(".md"))
        .sort()
    : [];

  it("centinela: el guard está leyendo la carpeta de agentes (hoy hay 7)", () => {
    // Si borraste un agente a propósito, baja este número; si falla porque la carpeta está
    // vacía, el guard estaba mirando la ruta equivocada y no protegía nada.
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  it.each(files)("%s tiene una cabecera YAML cargable", (file) => {
    const raw = fs.readFileSync(path.join(AGENTS_DIR, file), "utf8");
    expect(findFrontmatterProblems(raw, file)).toEqual([]);
  });
});
