// src/__tests__/helpers/in-memory-account-db.ts
//
// BD en memoria de `Account` para los tests de SPEC-008 (padre obligatorio de una cuenta de
// movimiento). Es un helper de TEST, no de producción.
//
// Por qué existe en vez de `mockResolvedValue(...)` a pelo
// ───────────────────────────────────────────────────────
// La regla de SPEC-008 se decide con VARIAS consultas a la misma tabla (unicidad del código, padre
// por código, padre por id, hijos existentes), y el valor que importa depende del `where` con que se
// pregunta: `{ companyId, code, deletedAt: null }` encuentra el título; el mismo `where` sin
// `companyId` encontraría el de OTRA empresa. Un `mockResolvedValue(titulo)` responde lo mismo a
// cualquier `where`, así que un test con ese mock PASA aunque la action olvide `companyId` o
// `deletedAt: null` — exactamente los dos fallos (IDOR / sugerir un padre eliminado) que la spec
// quiere impedir. Aquí cada consulta se evalúa contra filas reales:
//
//   · `undefined` en un campo del `where` = "sin filtro" (igual que Prisma). Un `companyId: undefined`
//     devuelve filas de TODAS las empresas, y el test lo ve.
//   · `deletedAt: null` excluye las eliminadas; si el `where` no menciona `deletedAt`, las incluye
//     (justo lo que necesita RN-5 para los códigos ocupados).
//   · `select` proyecta: leer un campo que no se pidió da `undefined`, como en producción.
//   · Un operador de `where` que el helper no conoce LANZA — nunca devuelve un resultado inventado.

export type AccountTypeValue =
  | "ASSET"
  | "CONTRA_ASSET"
  | "LIABILITY"
  | "EQUITY"
  | "REVENUE"
  | "EXPENSE";

export type AccountRow = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: AccountTypeValue;
  isPostable: boolean;
  deletedAt: Date | null;
};

type Where = Record<string, unknown>;
type Select = Record<string, boolean> | undefined;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !(v instanceof Date) && !Array.isArray(v);
}

function matches(row: AccountRow, where: Where): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue; // Prisma: undefined = sin filtro

    if (key === "NOT") {
      const negated = Array.isArray(value) ? value : [value];
      if (negated.some((w) => matches(row, w as Where))) return false;
      continue;
    }
    if (key === "OR") {
      if (!(value as Where[]).some((w) => matches(row, w))) return false;
      continue;
    }
    if (key === "AND") {
      const all = Array.isArray(value) ? (value as Where[]) : [value as Where];
      if (!all.every((w) => matches(row, w))) return false;
      continue;
    }
    if (key === "companyId_code") {
      const compound = value as { companyId: string; code: string };
      if (row.companyId !== compound.companyId || row.code !== compound.code) return false;
      continue;
    }

    const actual = (row as Record<string, unknown>)[key];
    if (isPlainObject(value)) {
      const ops = Object.keys(value);
      for (const op of ops) {
        const arg = value[op];
        if (op === "in") {
          if (!(arg as unknown[]).includes(actual)) return false;
        } else if (op === "startsWith") {
          if (typeof actual !== "string" || !actual.startsWith(arg as string)) return false;
        } else if (op === "not") {
          if (actual === arg) return false;
        } else {
          throw new Error(`in-memory-account-db: operador de where no soportado "${key}.${op}"`);
        }
      }
      continue;
    }
    if (actual !== value) return false;
  }
  return true;
}

function project<T extends Record<string, unknown>>(row: T, select: Select): Partial<T> {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const [key, on] of Object.entries(select)) if (on) out[key] = row[key];
  return out as Partial<T>;
}

export function accountRow(partial: Partial<AccountRow> & Pick<AccountRow, "code">): AccountRow {
  return {
    id: `acc-${partial.code}`,
    companyId: "company-1",
    name: `Cuenta ${partial.code}`,
    type: "ASSET",
    isPostable: partial.code.replace(/\D/g, "").length >= 9,
    deletedAt: null,
    ...partial,
  };
}

/** BD en memoria; las funciones devueltas son los `mockImplementation` de `prisma.account.*`. */
export function createAccountDb(initial: AccountRow[] = []) {
  // Se CLONAN las filas: `update` muta la fila y los fixtures de los tests son constantes de módulo
  // compartidas — sin clonar, un test que edita una cuenta contaminaría a los siguientes.
  const rows: AccountRow[] = initial.map((r) => ({ ...r }));
  let seq = 0;

  return {
    rows,

    findFirst: async (args: { where?: Where; select?: Select } = {}) => {
      const row = rows.find((r) => matches(r, args.where ?? {}));
      return row ? project(row, args.select) : null;
    },

    findMany: async (args: { where?: Where; select?: Select } = {}) =>
      rows.filter((r) => matches(r, args.where ?? {})).map((r) => project(r, args.select)),

    findUnique: async (args: { where: Where; select?: Select }) => {
      const row = rows.find((r) => matches(r, args.where));
      return row ? project(row, args.select) : null;
    },

    create: async (args: {
      data: Partial<AccountRow> & Pick<AccountRow, "code" | "companyId">;
    }) => {
      const row: AccountRow = {
        id: `new-${++seq}`,
        name: "",
        type: "ASSET",
        isPostable: false,
        deletedAt: null,
        ...args.data,
      };
      rows.push(row);
      return { ...row };
    },

    update: async (args: { where: { id: string }; data: Partial<AccountRow> }) => {
      const row = rows.find((r) => r.id === args.where.id);
      if (!row) throw new Error("in-memory-account-db: update sobre una fila inexistente");
      Object.assign(row, args.data);
      return { ...row };
    },
  };
}

export type AccountDb = ReturnType<typeof createAccountDb>;
