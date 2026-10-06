// src/__tests__/helpers/react-tree.ts
//
// Inspección del árbol de elementos que devuelve una PÁGINA de servidor (async) sin renderizarla:
// se invoca la página como función y se recorre el resultado. Los componentes hijos se sustituyen por
// stubs con `vi.mock`, así que lo que se ve son sus `props` tal como la página las entrega.
// Es un helper de TEST, no de producción (mismo recorrido que `transactions/new/page.test.ts`).

export type ElementLike = {
  type?: unknown;
  props?: { children?: unknown } & Record<string, unknown>;
};

/** Todos los elementos de `type` dentro del árbol devuelto por la página. */
export function findAll(node: unknown, type: unknown, out: ElementLike[] = []): ElementLike[] {
  if (Array.isArray(node)) {
    node.forEach((child) => findAll(child, type, out));
  } else if (node && typeof node === "object") {
    const el = node as ElementLike;
    if (el.type === type) out.push(el);
    if (el.props) findAll(el.props.children, type, out);
  }
  return out;
}

/** Texto plano de los hijos de cadena del árbol (para buscar un aviso renderizado por la página). */
export function collectText(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    node.forEach((child) => collectText(child, out));
  } else if (node && typeof node === "object") {
    const el = node as ElementLike;
    if (el.props) collectText(el.props.children, out);
  }
  return out;
}

/** Las claves de cada objeto de `rows`, ordenadas (para comparar la forma EXACTA que viaja al cliente). */
export function keySets(rows: readonly Record<string, unknown>[]): string[][] {
  return rows.map((row) => Object.keys(row).sort());
}
