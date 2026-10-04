// src/modules/accounting/utils/parent-title.ts
//
// Validación PURA del título padre de una cuenta de movimiento (SPEC-008 RN-1, RN-2, RN-3, RN-9).
//
// La comparten createAccountAction, updateAccountAction e ImportService.importAccounts, así que la
// regla vive en un solo lugar. No toca la base de datos: recibe el padre YA cargado (o `null` si no
// existe). Quien lo carga es responsable de buscarlo en la empresa verificada y sin eliminadas
// (`{ companyId, code, deletedAt: null }`) — de eso depende RN-2 y el aislamiento multi-tenant.

import type { AccountType } from "@prisma/client";
import { isTitleParentCode, parentCodeOf } from "@/lib/account-code";

/** Lo mínimo del padre que hace falta para validarlo (el `select` de quien lo consulta). */
export type ParentTitle = { code: string; type: AccountType; isPostable: boolean };

export type ParentCheckFailure = {
  ok: false;
  reason: "bad_format" | "missing_parent" | "not_a_title" | "type_mismatch";
  /** Código del padre esperado; `null` si el código no tiene forma de cuenta de movimiento. */
  parentCode: string | null;
};
export type ParentCheck = { ok: true } | ParentCheckFailure;

/**
 * RN-3: el hijo es del mismo tipo que el padre, salvo `CONTRA_ASSET`, que cuelga de un `ASSET`.
 * La excepción es solo en ese sentido: un `ASSET` bajo un padre `CONTRA_ASSET` se rechaza.
 */
function isTypeCompatible(type: AccountType, parentType: AccountType): boolean {
  return type === parentType || (type === "CONTRA_ASSET" && parentType === "ASSET");
}

/**
 * ¿Sirve este título como padre de una cuenta de tipo `type`? (RN-2 + RN-3)
 * `not_a_title` gana sobre `type_mismatch`. `null` = sirve.
 */
export function checkParentTitle(
  parent: ParentTitle,
  type: AccountType
): "not_a_title" | "type_mismatch" | null {
  if (parent.isPostable || !isTitleParentCode(parent.code)) return "not_a_title";
  if (!isTypeCompatible(type, parent.type)) return "type_mismatch";
  return null;
}

/**
 * Valida que una cuenta de movimiento tenga forma `A.B.CC.DD.EEE` y un título padre utilizable.
 * Precedencia: bad_format > missing_parent > not_a_title > type_mismatch.
 */
export function checkMovementParent({
  code,
  type,
  parent,
}: {
  code: string;
  type: AccountType;
  parent: ParentTitle | null;
}): ParentCheck {
  const parentCode = parentCodeOf(code);
  if (parentCode === null) return { ok: false, reason: "bad_format", parentCode: null };
  if (parent === null) return { ok: false, reason: "missing_parent", parentCode };

  const failure = checkParentTitle(parent, type);
  if (failure) return { ok: false, reason: failure, parentCode };
  return { ok: true };
}

/** Mensaje de negocio (copy exacto de SPEC-008 §8) para un rechazo de `checkMovementParent`. */
export function parentCheckMessage(check: ParentCheckFailure, code: string): string {
  switch (check.reason) {
    case "bad_format":
      return "El código de una cuenta de movimiento debe tener el formato A.B.CC.DD.EEE (ej: 1.1.01.01.001).";
    case "missing_parent":
    case "not_a_title":
      // Un "padre" que no es un título (9 dígitos, 4 dígitos, de movimiento) equivale a no tenerlo.
      return `La cuenta ${code} necesita un título padre (${check.parentCode ?? parentCodeOf(code) ?? "?"}) que no existe. Créalo primero.`;
    case "type_mismatch":
      return `El título padre ${check.parentCode ?? parentCodeOf(code) ?? "?"} es de otro tipo de cuenta.`;
  }
}
