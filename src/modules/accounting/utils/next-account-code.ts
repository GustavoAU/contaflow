// src/modules/accounting/utils/next-account-code.ts
//
// Qué código proponer al crear una cuenta contable.
//
// La versión anterior arrancaba en el inicio del rango (2000 para pasivos) y
// paraba en el primer salto. En un plan real, donde los pasivos empiezan en
// 2105, eso proponía `2000`: un número libre, sí, pero que ningún contador usa
// como cuenta de movimiento — los x000 y x100 son cabeceras de grupo.
//
// Lo que hace falta es continuar la serie que la empresa YA usa, y rellenar los
// huecos de esa serie antes de seguir hacia arriba. Un hueco dentro del tramo
// usado casi siempre es un olvido; un número por debajo del primero es una
// decisión deliberada del plan y no se toca.

export interface NextCodeOptions {
  /** Códigos existentes del MISMO tipo de cuenta. Se ignoran los no numéricos. */
  existing: readonly string[];
  rangeStart: number;
  rangeEnd: number;
}

/** Paso cuando NO hay con qué deducirlo (menos de dos códigos). Se usa 1 y no la
 *  convención habitual de 5: con un solo código no hay serie de la que inferir
 *  nada, e inventarse un escalón de cinco deja libres cuatro números sin motivo.
 *  En cuanto existen dos códigos el paso sale del propio plan. */
const PASO_POR_DEFECTO = 1;

/** Diferencias de 100 o más son saltos ENTRE bloques (2115 → 2205), no el paso
 *  de la serie. Incluirlas daría un paso enorme y ningún hueco detectado. */
const SALTO_DE_BLOQUE = 100;

/**
 * Deduce el paso de la serie a partir de los códigos existentes.
 * Se toma el MÍNIMO de las diferencias dentro de un bloque, no la moda: un plan
 * con 2205, 2215, 2220 usa de 5 en 5 aunque haya un salto de 10, y quedarse con
 * 10 escondería el hueco del 2210 — que es justo lo que se quiere encontrar.
 */
export function deducirPaso(codes: readonly number[]): number {
  const ordenados = [...codes].sort((a, b) => a - b);
  let minimo = Infinity;
  for (let i = 1; i < ordenados.length; i++) {
    const diff = ordenados[i] - ordenados[i - 1];
    if (diff > 0 && diff < SALTO_DE_BLOQUE && diff < minimo) minimo = diff;
  }
  if (!Number.isFinite(minimo)) return PASO_POR_DEFECTO;

  // Se ajusta a las convenciones que se usan de verdad (1, 5, 10) en vez de
  // tomar la diferencia cruda. Un plan con 1000 y 1002 tiene diferencia 2, pero
  // su rejilla real es de uno en uno y el hueco que interesa es el 1001: con
  // paso 2 quedaría invisible y se propondría 1004.
  if (minimo >= 10) return 10;
  if (minimo >= 5) return 5;
  return 1;
}

/**
 * Código sugerido, o `null` si el rango está agotado.
 *
 * 1. Sin cuentas de ese tipo → el inicio del rango (no hay serie que continuar).
 * 2. Con cuentas → se trabaja sobre el ÚLTIMO bloque (la centena del código más
 *    alto), se busca el primer hueco de la serie, y si no hay, se sigue hacia
 *    arriba desde el máximo.
 */
export function nextAccountCode({ existing, rangeStart, rangeEnd }: NextCodeOptions): string | null {
  const codes = existing
    .map((c) => Number(c))
    .filter((n) => Number.isInteger(n) && n >= rangeStart && n <= rangeEnd)
    .sort((a, b) => a - b);

  if (codes.length === 0) {
    return rangeStart <= rangeEnd ? String(rangeStart) : null;
  }

  const paso = deducirPaso(codes);
  const max = codes[codes.length - 1];
  const centenaDelUltimo = Math.floor(max / SALTO_DE_BLOQUE) * SALTO_DE_BLOQUE;
  const bloque = codes.filter((c) => c >= centenaDelUltimo);
  const ocupados = new Set(codes);

  // Hueco DENTRO del tramo usado. Se empieza en el mínimo del bloque y no en la
  // centena: los códigos por debajo del primero son decisión del plan.
  for (let c = bloque[0] + paso; c < max; c += paso) {
    if (!ocupados.has(c)) return String(c);
  }

  // Sin huecos: continuar la serie. Si se sale del rango, se busca cualquier
  // hueco anterior antes de rendirse.
  for (let c = max + paso; c <= rangeEnd; c += paso) {
    if (!ocupados.has(c)) return String(c);
  }
  for (let c = rangeStart; c <= rangeEnd; c++) {
    if (!ocupados.has(c)) return String(c);
  }
  return null;
}
