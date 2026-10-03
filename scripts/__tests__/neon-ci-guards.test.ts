// TDD SPEC — SPEC-002 secciones 3 y 4. Guardas del script de branches efimeros de Neon.
// Riesgo: la API key de Neon alcanza produccion. Estas guardas deben ser estrictas.
import { describe, it, expect } from "vitest";
import {
  ciBranchName,
  resolveDefaultBranch,
  assertDeletableBranch,
  assertCiProject,
  maskLine,
} from "../lib/neon-ci-guards.mjs";

const PROJECT = "proj-contaflow";
const DEFAULT_ID = "br-rough-sound-ai9i4g7p";

const okBranch = () => ({
  id: "br-ci-123",
  name: "ci-123-1",
  project_id: PROJECT,
  default: false,
  primary: false,
  protected: false,
});

const del = (
  branch: unknown,
  defaultBranchId: unknown = DEFAULT_ID,
  expectedProjectId: unknown = PROJECT,
) => assertDeletableBranch({ branch, expectedProjectId, defaultBranchId } as never);

describe("ciBranchName", () => {
  it("strings numericos -> ci-<runId>-<runAttempt>", () => {
    expect(ciBranchName({ runId: "123456", runAttempt: "2" })).toBe("ci-123456-2");
  });
  it("numbers -> ci-<runId>-<runAttempt>", () => {
    expect(ciBranchName({ runId: 123456, runAttempt: 1 })).toBe("ci-123456-1");
  });
  it.each([
    ["con letras", "12a"],
    ["vacio", ""],
    ["con guion", "1-2"],
    ["con espacio", "1 2"],
    ["con salto de linea", "12\n3"],
    ["con punto", "1.5"],
    ["negativo", "-1"],
    ["inyeccion shell", "1;rm -rf /"],
  ])("runId %s -> lanza mencionando runId", (_n, v) => {
    expect(() => ciBranchName({ runId: v, runAttempt: "1" })).toThrow(/runId/);
  });
  it.each([
    ["con letras", "x"],
    ["vacio", ""],
    ["con guion", "1-1"],
    ["con salto de linea", "1\n"],
  ])("runAttempt %s -> lanza mencionando runAttempt", (_n, v) => {
    expect(() => ciBranchName({ runId: "1", runAttempt: v })).toThrow(/runAttempt/);
  });
  it("runId undefined -> lanza runId", () => {
    expect(() => ciBranchName({ runId: undefined, runAttempt: "1" } as never)).toThrow(/runId/);
  });
  it("runAttempt undefined -> lanza runAttempt", () => {
    expect(() => ciBranchName({ runId: "1", runAttempt: undefined } as never)).toThrow(
      /runAttempt/,
    );
  });
  it("runId null -> lanza runId", () => {
    expect(() => ciBranchName({ runId: null, runAttempt: "1" } as never)).toThrow(/runId/);
  });
  it("runId decimal number (1.5) -> lanza runId", () => {
    expect(() => ciBranchName({ runId: 1.5, runAttempt: 1 })).toThrow(/runId/);
  });
});

describe("resolveDefaultBranch", () => {
  it("devuelve el unico branch con default === true", () => {
    const def = { id: DEFAULT_ID, name: "production", default: true };
    const res = resolveDefaultBranch([
      { id: "a", name: "ci-1-1", default: false },
      def,
      { id: "b", name: "dev" },
    ]);
    expect(res).toBe(def);
  });
  it("0 defaults -> lanza mencionando default", () => {
    expect(() => resolveDefaultBranch([{ id: "a", default: false }, { id: "b" }])).toThrow(
      /default/,
    );
  });
  it("lista vacia -> lanza mencionando default", () => {
    expect(() => resolveDefaultBranch([])).toThrow(/default/);
  });
  it("2 defaults -> lanza mencionando default", () => {
    expect(() =>
      resolveDefaultBranch([
        { id: "a", default: true },
        { id: "b", default: true },
      ]),
    ).toThrow(/default/);
  });
  it("default como string 'true' no cuenta (estricto === true) -> lanza", () => {
    expect(() => resolveDefaultBranch([{ id: "a", default: "true" } as never])).toThrow(
      /default/,
    );
  });
});

describe("assertDeletableBranch", () => {
  it("caso feliz -> no lanza", () => {
    expect(() => del(okBranch())).not.toThrow();
  });

  describe("nombre", () => {
    it.each([
      ["production", "production"],
      ["ci- sin numeros", "ci-"],
      ["ci-1-1-extra", "ci-1-1-extra"],
      ["xci-1-1", "xci-1-1"],
      ["CI-1-1 mayusculas", "CI-1-1"],
      ["ci-1 (un solo numero)", "ci-1"],
      ["ci-1-1 con salto de linea final", "ci-1-1\n"],
      ["vacio", ""],
    ])("%s -> refus", (_n, name) => {
      expect(() => del({ ...okBranch(), name })).toThrow(/refus/);
    });
    it("name faltante -> refus", () => {
      const { name: _omit, ...rest } = okBranch();
      expect(() => del(rest)).toThrow(/refus/);
    });
    it("name no string (number) -> refus", () => {
      expect(() => del({ ...okBranch(), name: 11 })).toThrow(/refus/);
    });
  });

  describe("proyecto", () => {
    it("project_id de otro proyecto -> refus", () => {
      expect(() => del({ ...okBranch(), project_id: "otro-proyecto" })).toThrow(/refus/);
    });
    it("project_id faltante -> refus", () => {
      const { project_id: _omit, ...rest } = okBranch();
      expect(() => del(rest)).toThrow(/refus/);
    });
    it("expectedProjectId undefined y project_id undefined -> refus (undefined === undefined no es seguro)", () => {
      const { project_id: _omit, ...rest } = okBranch();
      // Directo: con `del`, el undefined se sustituiría por PROJECT y el caso no se probaría.
      expect(() =>
        assertDeletableBranch({
          branch: rest,
          expectedProjectId: undefined,
          defaultBranchId: DEFAULT_ID,
        } as never)
      ).toThrow(/refus/);
    });
  });

  describe("flags de proteccion", () => {
    it("default true aunque el nombre sea ci-1-1 -> refus", () => {
      expect(() => del({ ...okBranch(), name: "ci-1-1", default: true })).toThrow(/refus/);
    });
    it("primary true -> refus", () => {
      expect(() => del({ ...okBranch(), primary: true })).toThrow(/refus/);
    });
    it("protected true -> refus", () => {
      expect(() => del({ ...okBranch(), protected: true })).toThrow(/refus/);
    });
  });

  describe("id vs defaultBranchId", () => {
    it("id igual al defaultBranchId -> refus", () => {
      expect(() => del({ ...okBranch(), id: DEFAULT_ID })).toThrow(/refus/);
    });
    it("id faltante -> refus", () => {
      const { id: _omit, ...rest } = okBranch();
      expect(() => del(rest)).toThrow(/refus/);
    });
    it("defaultBranchId undefined -> refus (no se puede verificar)", () => {
      // Directo: `del` tiene valor por defecto y convertiría este undefined en DEFAULT_ID.
      expect(() =>
        assertDeletableBranch({
          branch: okBranch(),
          expectedProjectId: PROJECT,
          defaultBranchId: undefined,
        } as never)
      ).toThrow(/refus/);
    });
  });

  describe("entradas invalidas", () => {
    it("branch undefined -> refus", () => {
      expect(() => del(undefined)).toThrow(/refus/);
    });
    it("branch null -> refus", () => {
      expect(() => del(null)).toThrow(/refus/);
    });
    it("branch objeto vacio -> refus", () => {
      expect(() => del({})).toThrow(/refus/);
    });
    it("argumento completo undefined -> refus (no TypeError sin mensaje de guarda)", () => {
      expect(() => (assertDeletableBranch as (a?: unknown) => void)(undefined)).toThrow(/refus/);
    });
  });
});

describe("maskLine", () => {
  it("valor normal -> ::add-mask::<value>", () => {
    expect(maskLine("npg_secret123")).toBe("::add-mask::npg_secret123");
  });
  it("valor con espacios internos se preserva", () => {
    expect(maskLine("a b")).toBe("::add-mask::a b");
  });
  it("vacio -> lanza", () => {
    expect(() => maskLine("")).toThrow(/mask|value|vac|empty/i);
  });
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["number", 123],
    ["objeto", {}],
  ])("no string (%s) -> lanza", (_n, v) => {
    expect(() => maskLine(v as never)).toThrow(/mask|value|string/i);
  });
  it("valor con LF -> lanza (inyeccion de comandos de workflow)", () => {
    expect(() => maskLine("abc\n::set-output name=x::y")).toThrow(
      /mask|value|newline|salto|line/i,
    );
  });
  it("valor con CR -> lanza", () => {
    expect(() => maskLine("abc\rdef")).toThrow(/mask|value|newline|salto|line/i);
  });
});

describe("assertCiProject — el script solo opera sobre el proyecto dedicado al CI", () => {
  it("proyecto llamado contaflow-ci -> no lanza", () => {
    expect(() => assertCiProject({ id: "jolly-grass-68240438", name: "contaflow-ci" })).not.toThrow();
  });
  it("el proyecto de produccion (accountapp) -> refus", () => {
    expect(() => assertCiProject({ id: "royal-voice-77113362", name: "accountapp" })).toThrow(/refus/);
  });
  it.each([
    ["mayusculas", "CONTAFLOW-CI"],
    ["sufijo", "contaflow-ci-2"],
    ["prefijo", "x-contaflow-ci"],
    ["con espacio", "contaflow-ci "],
    ["vacio", ""],
  ])("nombre %s -> refus", (_n, name) => {
    expect(() => assertCiProject({ id: "p", name })).toThrow(/refus/);
  });
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["objeto vacio", {}],
    ["name no string", { name: 5 }],
  ])("proyecto %s -> refus (falla cerrado)", (_n, project) => {
    expect(() => assertCiProject(project as never)).toThrow(/refus/);
  });
});
