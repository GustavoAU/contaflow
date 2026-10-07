// src/components/accounting/SavedAccountsAlert.tsx
//
// SPEC-012 (Entrega B2, Q4) — aviso de configuración guardada que ya no se puede usar. Cuando un
// formulario de configuración (cierre fiscal, Libro Mayor, nómina) guarda una cuenta que ahora es un
// TÍTULO, que ya no existe o que es de un tipo que el campo no ofrece, el combobox la muestra vacía e
// inválida (D1) y este aviso lista los campos
// afectados. El formulario es quien bloquea el guardado (botón deshabilitado + `submit` que retorna); este
// componente solo informa: sin botones ni enlaces, el usuario corrige en el propio formulario.
//
// Los rótulos se pintan como texto (React escapa): nunca como HTML.

import { TriangleAlertIcon } from "lucide-react";

export type SavedAccountProblem = { key: string; label: string };

type Props = {
  /** Salida de `unselectableSavedAccounts`: los campos con una cuenta guardada inutilizable, en orden. */
  problems: ReadonlyArray<SavedAccountProblem>;
  /** El botón de guardar apunta aquí con `aria-describedby` para explicar por qué está deshabilitado. */
  id?: string;
};

export function SavedAccountsAlert({ problems, id }: Props) {
  if (problems.length === 0) return null;
  const single = problems.length === 1;

  return (
    <div
      id={id}
      role="alert"
      className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-gray-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-gray-200"
    >
      <TriangleAlertIcon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500"
      />
      <div className="space-y-2">
        <p className="font-semibold text-gray-900 dark:text-gray-50">
          {single
            ? "Hay una cuenta guardada que no se puede usar"
            : `Hay ${problems.length} cuentas guardadas que no se pueden usar`}
        </p>
        <p>
          {single
            ? "Esta configuración apunta a una cuenta de título (los títulos agrupan cuentas y no se usan para registrar), a una cuenta que ya no existe o a una de un tipo que este campo no admite. Cámbiala por una cuenta de movimiento del tipo que pide el campo para poder guardar:"
            : "Estas configuraciones apuntan a una cuenta de título (los títulos agrupan cuentas y no se usan para registrar), a una cuenta que ya no existe o a una de un tipo que el campo no admite. Cámbialas por una cuenta de movimiento del tipo que pide cada campo para poder guardar:"}
        </p>
        <ul className="list-disc space-y-0.5 pl-5">
          {problems.map((problem) => (
            <li key={problem.key} className="font-medium text-gray-900 dark:text-gray-50">
              {problem.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
