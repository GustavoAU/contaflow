// prisma/seed-account-titles.ts
//
// ADR-059 / SPEC-008: una cuenta de movimiento (A.B.CC.DD.EEE, 9 dígitos) cuelga de un título padre
// (A.B.CC.DD, 6 dígitos). Los seeds definen solo cuentas de movimiento; este helper deriva la
// jerarquía de títulos de cada una:
//   nivel 1  A            nombre fijo por dígito
//   nivel 2  A.B          nombre fijo por prefijo
//   nivel 3  A.B.CC       nombre de la cuenta en mayúsculas (como el plan real: "CAJAS" / "CAJAS" / "Caja Principal")
//   nivel 4  A.B.CC.DD    idem
// Mismo esquema y mismos nombres que la migración 20261005_demo_account_titles. Un prefijo sin nombre
// definido lanza un error (no hay nombre por defecto silencioso).

export type SeedAccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
export type SeedTitle = { code: string; name: string; type: SeedAccountType };

const LEVEL_1: Record<string, string> = {
  "1": "ACTIVOS",
  "2": "PASIVOS",
  "3": "PATRIMONIO",
  "4": "INGRESOS",
  "5": "COSTOS Y GASTOS",
  "6": "OTROS GASTOS",
};

const LEVEL_2: Record<string, string> = {
  "1.1": "ACTIVO CIRCULANTE",
  "1.3": "CUENTAS POR COBRAR Y ANTICIPOS",
  "1.5": "ACTIVO FIJO",
  "2.1": "OBLIGACIONES FISCALES",
  "2.2": "CUENTAS POR PAGAR Y OBLIGACIONES LABORALES",
  "3.1": "CAPITAL",
  "3.2": "RESULTADOS ACUMULADOS",
  "3.3": "RESULTADO DEL EJERCICIO",
  "4.1": "INGRESOS OPERATIVOS",
  "4.2": "INGRESOS NO OPERATIVOS",
  "5.1": "COSTOS Y GASTOS OPERATIVOS",
  "6.1": "PÉRDIDAS NO OPERATIVAS",
};

function titleType(firstDigit: string): SeedAccountType {
  switch (firstDigit) {
    case "1":
      return "ASSET";
    case "2":
      return "LIABILITY";
    case "3":
      return "EQUITY";
    case "4":
      return "REVENUE";
    default:
      return "EXPENSE";
  }
}

export function buildTitleAccounts(
  movement: readonly { code: string; name: string }[]
): SeedTitle[] {
  const titles = new Map<string, SeedTitle>();
  const add = (code: string, name: string | undefined) => {
    if (!name)
      throw new Error(`seed-account-titles: no hay nombre definido para el título ${code}`);
    if (!titles.has(code)) titles.set(code, { code, name, type: titleType(code[0]) });
  };

  for (const { code, name } of movement) {
    const parts = code.split(".");
    if (parts.length !== 5) {
      throw new Error(`seed-account-titles: ${code} no tiene la forma A.B.CC.DD.EEE`);
    }
    const [a, b, cc, dd] = parts;
    add(a, LEVEL_1[a]);
    add(`${a}.${b}`, LEVEL_2[`${a}.${b}`]);
    add(`${a}.${b}.${cc}`, name.toUpperCase());
    add(`${a}.${b}.${cc}.${dd}`, name.toUpperCase());
  }

  // Orden por código para que se creen padres antes que hijos.
  return [...titles.values()].sort((x, y) =>
    x.code.localeCompare(y.code, undefined, { numeric: true })
  );
}
