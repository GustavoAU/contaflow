// src/modules/accounting/__tests__/parent-title.test.ts
//
// SPEC-008 (RN-1, RN-2, RN-3, RN-9): validación PURA del título padre de una cuenta de movimiento.
// La comparten createAccountAction, updateAccountAction e ImportService.importAccounts, así que la
// regla vive en un solo lugar y se prueba aquí sin BD ni mocks.
//
// Modo RED: `../utils/parent-title` aún no existe (lo crea el ledger-agent). El módulo se carga con
// un import dinámico de especificador no literal y se tipa con el contrato de la SPEC, para que ni
// `tsc` ni la resolución de Vite fallen al cargar el archivo y cada caso falle por su propia razón.
// Cuando el módulo exista (GREEN) se puede pasar a `import { ... } from "../utils/parent-title"`.

import { describe, it, expect } from "vitest";

type AccountType = "ASSET" | "CONTRA_ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
type ParentTitle = { code: string; type: AccountType; isPostable: boolean };
type ParentCheck =
  | { ok: true }
  | {
      ok: false;
      reason: "bad_format" | "missing_parent" | "not_a_title" | "type_mismatch";
      parentCode: string | null;
    };
type ParentTitleModule = {
  checkMovementParent(args: {
    code: string;
    type: AccountType;
    parent: ParentTitle | null;
  }): ParentCheck;
  parentCheckMessage(check: Extract<ParentCheck, { ok: false }>, code: string): string;
};

const MODULE_PATH = "../utils/parent-title";
async function load(): Promise<ParentTitleModule> {
  return (await import(/* @vite-ignore */ MODULE_PATH)) as ParentTitleModule;
}

const ALL_TYPES: AccountType[] = [
  "ASSET",
  "CONTRA_ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
];

const CODE = "1.1.01.01.050";
const PARENT_CODE = "1.1.01.01";
const titulo = (over: Partial<ParentTitle> = {}): ParentTitle => ({
  code: PARENT_CODE,
  type: "ASSET",
  isPostable: false,
  ...over,
});

describe("checkMovementParent — título padre de una cuenta de movimiento (SPEC-008)", () => {
  // ─── Camino feliz ──────────────────────────────────────────────────────────────────────────
  it("padre de 6 dígitos, no movible y del mismo tipo → { ok: true }", async () => {
    const { checkMovementParent } = await load();
    expect(checkMovementParent({ code: CODE, type: "ASSET", parent: titulo() })).toEqual({
      ok: true,
    });
  });

  it.each([
    ["LIABILITY", "2.1.05.02.001", "2.1.05.02"],
    ["EQUITY", "3.2.01.01.001", "3.2.01.01"],
    ["REVENUE", "4.1.01.01.001", "4.1.01.01"],
    ["EXPENSE", "5.1.02.03.010", "5.1.02.03"],
  ] as const)("%s con padre del mismo tipo es válido (%s bajo %s)", async (type, code, parent) => {
    const { checkMovementParent } = await load();
    expect(checkMovementParent({ code, type, parent: titulo({ code: parent, type }) })).toEqual({
      ok: true,
    });
  });

  // ─── bad_format (RN-1) ─────────────────────────────────────────────────────────────────────
  it.each([
    ["sin puntos (9 dígitos planos)", "110101001"],
    ["10 dígitos (último segmento de 4)", "1.1.01.01.0010"],
    ["último segmento de 2 dígitos", "1.1.01.01.01"],
    ["separador guion", "1-1-01-01-001"],
    ["segmentos con otro tamaño", "1.1.1.01.001"],
    ["un título de 4 dígitos", "1.1.01"],
    ["un título de 6 dígitos", "1.1.01.01"],
    ["cadena vacía", ""],
  ])("CA-10: código %s → bad_format, sin padre calculable", async (_label, code) => {
    const { checkMovementParent } = await load();
    expect(checkMovementParent({ code, type: "ASSET", parent: titulo() })).toEqual({
      ok: false,
      reason: "bad_format",
      parentCode: null,
    });
  });

  it("bad_format gana sobre missing_parent: con código malformado y sin padre, se reclama la forma", async () => {
    const { checkMovementParent } = await load();
    expect(checkMovementParent({ code: "110101001", type: "ASSET", parent: null })).toMatchObject({
      ok: false,
      reason: "bad_format",
    });
  });

  // ─── CA-5: el padre no sirve ───────────────────────────────────────────────────────────────
  it("CA-5: padre null (no existe, es de otra empresa o está eliminado) → missing_parent con el código del padre", async () => {
    const { checkMovementParent } = await load();
    expect(checkMovementParent({ code: CODE, type: "ASSET", parent: null })).toEqual({
      ok: false,
      reason: "missing_parent",
      parentCode: PARENT_CODE,
    });
  });

  it("CA-5: el padre calculado sale del propio código (2.1.05.02.123 → 2.1.05.02)", async () => {
    const { checkMovementParent } = await load();
    expect(
      checkMovementParent({ code: "2.1.05.02.123", type: "LIABILITY", parent: null })
    ).toMatchObject({ reason: "missing_parent", parentCode: "2.1.05.02" });
  });

  it("CA-5: padre con 9 dígitos (es una cuenta de movimiento, no un título) → not_a_title", async () => {
    const { checkMovementParent } = await load();
    const result = checkMovementParent({
      code: CODE,
      type: "ASSET",
      parent: titulo({ code: "1.1.01.01.001", isPostable: false }),
    });
    expect(result).toMatchObject({ ok: false, reason: "not_a_title" });
  });

  it("CA-5: padre con 9 dígitos y isPostable=true → not_a_title", async () => {
    const { checkMovementParent } = await load();
    const result = checkMovementParent({
      code: CODE,
      type: "ASSET",
      parent: titulo({ code: "1.1.01.01.001", isPostable: true }),
    });
    expect(result).toMatchObject({ ok: false, reason: "not_a_title" });
  });

  it("CA-5: padre con 4 dígitos (1.1.01) → not_a_title", async () => {
    const { checkMovementParent } = await load();
    const result = checkMovementParent({
      code: CODE,
      type: "ASSET",
      parent: titulo({ code: "1.1.01", isPostable: false }),
    });
    expect(result).toMatchObject({ ok: false, reason: "not_a_title" });
  });

  it("CA-5: padre heredado de 4 dígitos sin separadores (1105) → not_a_title", async () => {
    const { checkMovementParent } = await load();
    const result = checkMovementParent({
      code: CODE,
      type: "ASSET",
      parent: titulo({ code: "1105", isPostable: false }),
    });
    expect(result).toMatchObject({ ok: false, reason: "not_a_title" });
  });

  it("CA-5: padre de 6 dígitos pero con isPostable=true → not_a_title", async () => {
    const { checkMovementParent } = await load();
    expect(
      checkMovementParent({ code: CODE, type: "ASSET", parent: titulo({ isPostable: true }) })
    ).toEqual({ ok: false, reason: "not_a_title", parentCode: PARENT_CODE });
  });

  // ─── CA-6 / RN-3: compatibilidad de tipo ───────────────────────────────────────────────────
  it("CA-6: CONTRA_ASSET con padre ASSET es válido", async () => {
    const { checkMovementParent } = await load();
    expect(
      checkMovementParent({
        code: "1.1.09.01.001",
        type: "CONTRA_ASSET",
        parent: titulo({ code: "1.1.09.01", type: "ASSET" }),
      })
    ).toEqual({ ok: true });
  });

  it("CA-6: LIABILITY con padre ASSET → type_mismatch", async () => {
    const { checkMovementParent } = await load();
    expect(
      checkMovementParent({ code: CODE, type: "LIABILITY", parent: titulo({ type: "ASSET" }) })
    ).toEqual({ ok: false, reason: "type_mismatch", parentCode: PARENT_CODE });
  });

  it("CA-6: ASSET con padre CONTRA_ASSET → type_mismatch (la excepción es solo de CONTRA_ASSET hacia ASSET)", async () => {
    const { checkMovementParent } = await load();
    expect(
      checkMovementParent({
        code: CODE,
        type: "ASSET",
        parent: titulo({ type: "CONTRA_ASSET" }),
      })
    ).toMatchObject({ ok: false, reason: "type_mismatch" });
  });

  it("CA-6: CONTRA_ASSET con padre CONTRA_ASSET (mismo tipo) es válido", async () => {
    const { checkMovementParent } = await load();
    expect(
      checkMovementParent({
        code: "1.1.09.01.001",
        type: "CONTRA_ASSET",
        parent: titulo({ code: "1.1.09.01", type: "CONTRA_ASSET" }),
      })
    ).toEqual({ ok: true });
  });

  it("CA-6: CONTRA_ASSET con padre de otro tipo que no es ASSET (LIABILITY) → type_mismatch", async () => {
    const { checkMovementParent } = await load();
    expect(
      checkMovementParent({
        code: "1.1.09.01.001",
        type: "CONTRA_ASSET",
        parent: titulo({ code: "1.1.09.01", type: "LIABILITY" }),
      })
    ).toMatchObject({ ok: false, reason: "type_mismatch" });
  });

  // Matriz completa 6x6: compatible = mismo tipo, o hijo CONTRA_ASSET con padre ASSET.
  const MATRIZ = ALL_TYPES.flatMap((type) =>
    ALL_TYPES.map((parentType) => ({
      type,
      parentType,
      compatible: type === parentType || (type === "CONTRA_ASSET" && parentType === "ASSET"),
    }))
  );
  it.each(MATRIZ)(
    "RN-3: hijo $type bajo padre $parentType → compatible=$compatible",
    async ({ type, parentType, compatible }) => {
      const { checkMovementParent } = await load();
      const result = checkMovementParent({
        code: CODE,
        type,
        parent: titulo({ type: parentType }),
      });
      if (compatible) {
        expect(result).toEqual({ ok: true });
      } else {
        expect(result).toEqual({ ok: false, reason: "type_mismatch", parentCode: PARENT_CODE });
      }
    }
  );

  // ─── Pureza ────────────────────────────────────────────────────────────────────────────────
  it("no muta el padre recibido", async () => {
    const { checkMovementParent } = await load();
    const parent = Object.freeze(titulo()) as ParentTitle;
    expect(() => checkMovementParent({ code: CODE, type: "ASSET", parent })).not.toThrow();
    expect(parent).toEqual(titulo());
  });
});

describe("parentCheckMessage — copy exacto de SPEC §8", () => {
  it("bad_format → forma A.B.CC.DD.EEE con ejemplo", async () => {
    const { parentCheckMessage } = await load();
    expect(
      parentCheckMessage({ ok: false, reason: "bad_format", parentCode: null }, "110101001")
    ).toBe(
      "El código de una cuenta de movimiento debe tener el formato A.B.CC.DD.EEE (ej: 1.1.01.01.001)."
    );
  });

  it("missing_parent → nombra la cuenta y el padre que falta", async () => {
    const { parentCheckMessage } = await load();
    expect(
      parentCheckMessage({ ok: false, reason: "missing_parent", parentCode: PARENT_CODE }, CODE)
    ).toBe(
      "La cuenta 1.1.01.01.050 necesita un título padre (1.1.01.01) que no existe. Créalo primero."
    );
  });

  it("not_a_title → mismo mensaje que 'sin padre'", async () => {
    const { parentCheckMessage } = await load();
    expect(
      parentCheckMessage({ ok: false, reason: "not_a_title", parentCode: PARENT_CODE }, CODE)
    ).toBe(
      "La cuenta 1.1.01.01.050 necesita un título padre (1.1.01.01) que no existe. Créalo primero."
    );
  });

  it("type_mismatch → el título padre es de otro tipo de cuenta", async () => {
    const { parentCheckMessage } = await load();
    expect(
      parentCheckMessage({ ok: false, reason: "type_mismatch", parentCode: PARENT_CODE }, CODE)
    ).toBe("El título padre 1.1.01.01 es de otro tipo de cuenta.");
  });

  it("el mensaje usa los códigos que recibe, no valores fijos (2.1.05.02.123 / 2.1.05.02)", async () => {
    const { parentCheckMessage } = await load();
    expect(
      parentCheckMessage(
        { ok: false, reason: "missing_parent", parentCode: "2.1.05.02" },
        "2.1.05.02.123"
      )
    ).toBe(
      "La cuenta 2.1.05.02.123 necesita un título padre (2.1.05.02) que no existe. Créalo primero."
    );
  });

  it("de punta a punta: checkMovementParent + parentCheckMessage, un mensaje por cada razón", async () => {
    const { checkMovementParent, parentCheckMessage } = await load();
    const mensaje = (code: string, type: AccountType, parent: ParentTitle | null) => {
      const check = checkMovementParent({ code, type, parent });
      if (check.ok) throw new Error("se esperaba un rechazo");
      return parentCheckMessage(check, code);
    };

    expect(mensaje("110101001", "ASSET", null)).toBe(
      "El código de una cuenta de movimiento debe tener el formato A.B.CC.DD.EEE (ej: 1.1.01.01.001)."
    );
    expect(mensaje(CODE, "ASSET", null)).toBe(
      "La cuenta 1.1.01.01.050 necesita un título padre (1.1.01.01) que no existe. Créalo primero."
    );
    expect(mensaje(CODE, "ASSET", titulo({ isPostable: true }))).toBe(
      "La cuenta 1.1.01.01.050 necesita un título padre (1.1.01.01) que no existe. Créalo primero."
    );
    expect(mensaje(CODE, "LIABILITY", titulo({ type: "ASSET" }))).toBe(
      "El título padre 1.1.01.01 es de otro tipo de cuenta."
    );
  });
});
