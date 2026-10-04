// src/modules/accounting/actions/account.actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { Prisma, type AccountType } from "@prisma/client";
import { withCompanyContext } from "@/lib/prisma-rls";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { limiters } from "@/lib/ratelimit";
import { isPostableCode, parentCodeOf, MOVEMENT_CODE_REGEX } from "@/lib/account-code";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";
import { nextChildCode } from "../utils/next-account-code";
import { checkMovementParent, checkParentTitle, parentCheckMessage } from "../utils/parent-title";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const CreateAccountSchema = z.object({
  companyId: z.string().min(1, "Company ID es requerido"),
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100),
  code: z
    .string()
    .min(1, "El codigo es requerido")
    .max(20)
    .regex(
      /^\d+([.\-]\d+)*$/,
      "El codigo debe ser numérico o jerárquico (ej: 1105, 1-1-05, 1.1.05)"
    ),
  type: z.enum(["ASSET", "CONTRA_ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"], {
    error: "Tipo de cuenta invalido",
  }),
  description: z.string().max(255).optional(),
  // VEN-NIF 3: true = Caja/Bancos/CxC/CxP — excluida de reexpresión INPC
  isMonetary: z.boolean().default(false),
  // VEN-NIF BA-10 / IAS 1: true = corriente (ASSET/CONTRA_ASSET/LIABILITY ≤12 meses)
  isCurrent: z.boolean().default(false),
});

const UpdateAccountSchema = CreateAccountSchema.omit({ companyId: true })
  .partial()
  .extend({
    id: z.string().min(1, "ID es requerido"),
  });

// Sugerencia de código (getNextAccountCodeAction): SPEC-008 — código de 9 dígitos dentro de un título
// padre. Ya no hay rangos numéricos por tipo: eso proponía códigos de 4 dígitos que nacen como título.

const NextCodeInput = z.object({
  type: z.enum(["ASSET", "CONTRA_ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"], {
    error: "Tipo de cuenta invalido",
  }),
  companyId: z.string().min(1, "Company ID es requerido"),
  // RN-7: no existe sugerencia sin padre.
  parentId: z.string().min(1, "La cuenta padre es requerida"),
});

// Primer dígito del código según el tipo (convención venezolana: 1 Activo, 2 Pasivo, 3 Patrimonio,
// 4 Ingresos, 5-9 Costos/Gastos/Cuentas de orden — ContaFlow no los distingue, todo es EXPENSE).
// Los códigos que no empiezan por ese dígito son válidos (la cuenta se crea con advertencia).
const LEADING_DIGITS: Record<string, string> = {
  ASSET: "1",
  CONTRA_ASSET: "1",
  LIABILITY: "2",
  EQUITY: "3",
  REVENUE: "4",
  EXPENSE: "56789",
};

// ─── Obtener todas las cuentas ────────────────────────────────────────────────

// `onlyPostable` (ADR-059): los selectores de cuenta de los formularios piden solo las de
// movimiento (≥ 9 dígitos); el plan de cuentas y los reportes siguen viendo títulos y subtítulos.
export async function getAccountsAction(
  companyId: string,
  opts: { onlyPostable?: boolean } = {}
): Promise<ActionResult<Awaited<ReturnType<typeof prisma.account.findMany>>>> {
  try {
    const ctx = await requireCompanyAction(companyId, {
      roles: "MEMBER_ANY",
      limiter: limiters.read,
    });
    if (!ctx.ok) return ctx.error;
    const accounts = await prisma.account.findMany({
      where: { companyId, deletedAt: null, ...(opts.onlyPostable ? { isPostable: true } : {}) },
      orderBy: { code: "asc" },
    });
    return { success: true, data: accounts };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Título padre de una cuenta de movimiento (SPEC-008 RN-9 / RN-10) ─────────────────────────────

// Devuelve el mensaje de negocio si `code` (de movimiento) no tiene forma válida o su título padre no
// existe / no sirve; `null` si todo está bien. El padre se busca en la empresa VERIFICADA por el guard
// (nunca en una que venga del input) y sin eliminadas (RN-2). Va ANTES del $transaction: un rechazo no
// crea nada. Se llama solo cuando el código es de movimiento y se crea o cambia.
async function movementParentError(
  companyId: string,
  code: string,
  type: AccountType
): Promise<string | null> {
  const parentCode = parentCodeOf(code);
  const parent =
    parentCode === null
      ? null
      : await prisma.account.findFirst({
          where: { companyId, code: parentCode, deletedAt: null },
          select: { code: true, type: true, isPostable: true },
        });
  const check = checkMovementParent({ code, type, parent });
  return check.ok ? null : parentCheckMessage(check, code);
}

// ─── Crear cuenta ─────────────────────────────────────────────────────────────

export async function createAccountAction(
  input: z.infer<typeof CreateAccountSchema>
): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const ctx = await requireCompanyAction(input.companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    const { userId, ipAddress, userAgent } = ctx;

    const validated = CreateAccountSchema.parse(input);

    // Verificar que el codigo no exista en esta empresa
    const existingCode = await prisma.account.findUnique({
      where: {
        companyId_code: {
          companyId: validated.companyId,
          code: validated.code,
        },
      },
    });

    if (existingCode) {
      return {
        success: false,
        error: `El codigo ${validated.code} ya esta en uso por la cuenta "${existingCode.name}"`,
      };
    }

    // ADR-059: el nombre NO es único — títulos, subtítulos y cuentas de movimiento repiten
    // nombre en un plan real ("CAJAS" / "CAJAS" / "Caja Principal"). Solo el código no se repite.
    // Título o movimiento lo decide la longitud del código (9 dígitos = movimiento).
    const isPostable = isPostableCode(validated.code);

    // SPEC-008 RN-9: una cuenta de movimiento solo se crea si existe su título padre (con tipo
    // compatible). Un código de < 9 dígitos sigue creándose como título, sin padre obligatorio.
    if (isPostable) {
      const parentError = await movementParentError(
        validated.companyId,
        validated.code,
        validated.type
      );
      if (parentError) return { success: false, error: parentError };
    }

    // Un código de movimiento (>= 9 dígitos, ej. 1.1.01.01.001) se valida por su PRIMER dígito
    // (convención 1-5; 6-9 también son Gasto). Los códigos de < 9 dígitos son títulos y ya
    // reciben su propio aviso, así que no se comparan contra ningún rango.
    const firstDigit = validated.code.replace(/\D/g, "")[0] ?? "";
    const outOfRange = isPostable && !LEADING_DIGITS[validated.type].includes(firstDigit);

    const account = await prisma.$transaction(async (tx) =>
      withCompanyContext(validated.companyId, tx, async (tx) => {
        const created = await tx.account.create({
          data: {
            name: validated.name,
            code: validated.code,
            type: validated.type,
            description: validated.description,
            isMonetary: validated.isMonetary,
            isCurrent: validated.isCurrent,
            isPostable,
            companyId: validated.companyId,
          },
        });

        await tx.auditLog.create({
          data: {
            companyId: validated.companyId,
            entityId: created.id,
            entityName: "Account",
            action: "CREATE",
            userId,
            ipAddress,
            userAgent,
            newValue: {
              code: validated.code,
              name: validated.name,
              type: validated.type,
              isPostable,
            },
          },
        });

        return created;
      })
    );

    revalidatePath(`/company/${validated.companyId}/accounts`);

    if (!isPostable) {
      return {
        success: true,
        data: { id: account.id, name: account.name },
        warning: `El código ${validated.code} tiene menos de 9 dígitos: la cuenta se creó como título/subtítulo y no se podrá seleccionar en asientos. Las cuentas de movimiento llevan 9 dígitos (ej: 1.1.01.01.001).`,
      };
    }

    if (outOfRange) {
      return {
        success: true,
        data: { id: account.id, name: account.name },
        warning: `Advertencia: El codigo ${validated.code} no empieza por el dígito estándar de las cuentas de tipo ${validated.type} (${LEADING_DIGITS[validated.type].split("").join(", ")}). La cuenta fue creada de todas formas.`,
      };
    }

    return { success: true, data: { id: account.id, name: account.name } };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Editar cuenta ────────────────────────────────────────────────────────────

// Error de negocio lanzado dentro del $transaction de updateAccountAction; se captura abajo
// para devolver el mensaje tal cual (toActionError no debe tragarlo ni filtrarlo).
class AccountInUseError extends Error {}

export async function updateAccountAction(
  input: z.infer<typeof UpdateAccountSchema>
): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const validated = UpdateAccountSchema.parse(input);
    const { id, ...data } = validated;

    const before = await prisma.account.findUnique({
      where: { id },
      select: { code: true, name: true, type: true, companyId: true, isPostable: true },
    });
    if (!before) return { success: false, error: "Cuenta no encontrada" };

    const ctx = await requireCompanyAction(before.companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    const { userId, ipAddress, userAgent } = ctx;

    if (data.code) {
      // FIX CRÍTICO-1 (ADR-004): unicidad de código scoped a companyId.
      // Sin companyId, un código existente en empresa B bloqueaba actualizaciones
      // legítimas en empresa A. Ver lessons-learned.md LL-003.
      const existing = await prisma.account.findFirst({
        where: {
          code: data.code,
          companyId: before.companyId, // ← fix: era `companyId: before.companyId` pero faltaba antes
          NOT: { id },
          deletedAt: null,
        },
      });
      if (existing) {
        return {
          success: false,
          error: `El codigo ${data.code} ya esta en uso por la cuenta "${existing.name}"`,
        };
      }
    }

    // SPEC-008 RN-10: si el código CAMBIA y el nuevo es de movimiento, aplica el mismo chequeo de
    // título padre que el alta. El formulario reenvía siempre `code` (ver H-1 abajo), así que solo se
    // consulta cuando difiere del guardado: editar el nombre u otros campos con el mismo código NO
    // dispara el chequeo (RN-12: una cuenta heredada sin título padre sigue siendo editable). El tipo a
    // validar es el que quedará (`data.type`) o, si no cambia, el actual.
    if (data.code !== undefined && data.code !== before.code && isPostableCode(data.code)) {
      const parentError = await movementParentError(
        before.companyId,
        data.code,
        data.type ?? before.type
      );
      if (parentError) return { success: false, error: parentError };
    }

    // ADR-059: título/movimiento solo se recalcula si el código CRUZA el umbral de 9 dígitos.
    // El formulario de edición reenvía siempre el `code`, así que "vino un code" no significa
    // "cambió" — comparar contra el valor previo. Una cuenta heredada de 4 dígitos que sigue en
    // 4 dígitos conserva su isPostable (no se degrada a título en silencio).
    const crossesThreshold =
      data.code !== undefined && isPostableCode(data.code) !== isPostableCode(before.code);
    const newIsPostable = crossesThreshold ? isPostableCode(data.code as string) : undefined;

    const account = await prisma.$transaction(async (tx) =>
      withCompanyContext(before.companyId, tx, async (tx) => {
        // Pasar a título una cuenta con asientos dejaría movimientos colgando de un título.
        // El conteo va DENTRO de la transacción, justo antes del update, para acortar la
        // ventana frente a un asiento concurrente.
        if (newIsPostable === false) {
          const enUso = await tx.journalEntry.count({
            where: { accountId: id, account: { companyId: before.companyId } },
          });
          if (enUso > 0) {
            throw new AccountInUseError(
              `La cuenta tiene ${enUso} ${enUso === 1 ? "asiento" : "asientos"}: su código debe mantener 9 dígitos para seguir siendo una cuenta de movimiento.`
            );
          }
        }

        const updated = await tx.account.update({
          where: { id },
          data: newIsPostable === undefined ? data : { ...data, isPostable: newIsPostable },
        });

        await tx.auditLog.create({
          data: {
            companyId: before.companyId,
            entityId: id,
            entityName: "Account",
            action: "UPDATE",
            userId,
            ipAddress,
            userAgent,
            oldValue: before as object,
            newValue: (newIsPostable === undefined
              ? data
              : { ...data, isPostable: newIsPostable }) as object,
          },
        });

        return updated;
      })
    );

    revalidatePath("/company");

    return { success: true, data: { id: account.id, name: account.name } };
  } catch (error) {
    if (error instanceof AccountInUseError) return { success: false, error: error.message };
    return toActionError(error);
  }
}

// ─── Generar codigo automatico ────────────────────────────────────────────────

// SPEC-008 (RN-4..RN-8, RN-13): propone el siguiente código de 9 dígitos dentro de un título padre.
// Es de LECTURA (MEMBER_ANY + limiters.read, sin AuditLog) y solo una propuesta editable: lo que
// manda es la validación del servidor en createAccountAction/updateAccountAction.
export async function getNextAccountCodeAction(
  type: AccountType,
  companyId: string,
  parentId: string
): Promise<ActionResult<{ code: string }>> {
  try {
    // safeParse ANTES del guard: un `companyId` undefined llegaría a Prisma como "sin filtro" y el
    // lookup de membresía/las consultas de cuentas abarcarían a todas las empresas (ADR-004/ADR-044).
    const parsed = NextCodeInput.safeParse({ type, companyId, parentId });
    if (!parsed.success) return toActionError(parsed.error);
    const input = parsed.data;

    const ctx = await requireCompanyAction(input.companyId, {
      roles: "MEMBER_ANY",
      limiter: limiters.read,
    });
    if (!ctx.ok) return ctx.error;

    // RN-2: el padre es de la empresa verificada, no está eliminado, es un título de 6 dígitos y su
    // tipo es compatible (RN-3). Un solo mensaje genérico para toda causa: no confirma a un usuario
    // si un id de otra empresa existe, ni qué código tiene.
    const parent = await prisma.account.findFirst({
      where: { id: input.parentId, companyId: input.companyId, deletedAt: null },
      select: { code: true, type: true, isPostable: true },
    });
    // `${padre}.001` debe tener la forma de una cuenta de movimiento (RN-1): un título de 6 dígitos
    // sin puntos (`110101`) no es un padre válido — su sugerido sería rechazado al guardar.
    if (
      !parent ||
      checkParentTitle(parent, input.type) !== null ||
      !MOVEMENT_CODE_REGEX.test(`${parent.code}.001`)
    ) {
      return { success: false, error: "La cuenta padre no es válida para este tipo de cuenta." };
    }

    // RN-5: "ocupado" se decide contra TODAS las filas de la empresa, INCLUIDAS las eliminadas
    // (sin filtrar `deletedAt`): el @@unique([companyId, code]) las cuenta.
    const accounts = await prisma.account.findMany({
      where: { companyId: input.companyId },
      select: { code: true },
    });

    const code = nextChildCode({
      parentCode: parent.code,
      existingCodes: accounts.map((a) => a.code),
    });

    // RN-6: el título ya tiene los 999 hijos — no se inventa otro padre.
    if (!code) {
      return {
        success: false,
        error: `El título ${parent.code} ya tiene 999 cuentas; elige otro título.`,
      };
    }

    return { success: true, data: { code } };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Eliminar cuenta ──────────────────────────────────────────────────────────
// No existía ninguna vía para quitar una cuenta del plan: sólo se podían crear y
// editar. Una cuenta creada por error —un nombre de persona en el plan, un
// código mal tecleado— se quedaba ahí para siempre, ensuciando todos los
// desplegables de cuentas de la aplicación.
//
// Borrado LÓGICO y sólo si la cuenta NO tiene movimiento. Un asiento apunta a su
// cuenta: borrarla de verdad rompería el Libro Mayor y la trazabilidad que el
// SENIAT exige. Y una cuenta con asientos no es un error que limpiar, es
// historia contable — para ésas la salida es dejar de usarlas, no borrarlas.

export async function deleteAccountAction(
  accountId: string
): Promise<ActionResult<{ id: string }>> {
  try {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, code: true, name: true, type: true, companyId: true, deletedAt: true },
    });
    if (!account || account.deletedAt) {
      return { success: false, error: "Cuenta no encontrada" };
    }

    // El companyId sale de la cuenta, no del cliente: el guard lo verifica
    // contra la membresía real (ADR-004/ADR-041).
    const ctx = await requireCompanyAction(account.companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    const { userId, ipAddress, userAgent } = ctx;

    // `JournalEntry` no tiene columna `companyId` propia, así que el tenant se
    // acota por la relación. `accountId` ya bastaría —una cuenta pertenece a una
    // sola empresa—, pero se deja explícito: la RLS no cubre nada (ADR-044) y un
    // filtro implícito obliga a razonar para ver que es seguro.
    const enUso = await prisma.journalEntry.count({
      where: { accountId, account: { companyId: account.companyId } },
    });
    if (enUso > 0) {
      return {
        success: false,
        error:
          `La cuenta ${account.code} tiene ${enUso} ${enUso === 1 ? "asiento" : "asientos"} ` +
          "y no puede eliminarse: borrarla rompería el Libro Mayor. Si ya no la usas, " +
          "renómbrala o deja de asignarla en las configuraciones.",
      };
    }

    await prisma.$transaction(async (tx) => {
      // El `deletedAt: null` en el where cierra la ventana entre el conteo y el
      // borrado: si otra petición la borró antes, ésta no la toca dos veces.
      const borrada = await tx.account.updateMany({
        where: { id: accountId, companyId: account.companyId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (borrada.count === 0) throw new Error("Cuenta no encontrada");

      await tx.auditLog.create({
        data: {
          companyId: account.companyId,
          entityId: accountId,
          entityName: "Account",
          action: "DELETE",
          userId,
          ipAddress,
          userAgent,
          oldValue: { code: account.code, name: account.name, type: account.type },
          newValue: Prisma.JsonNull,
        },
      });
    });

    revalidatePath(`/company/${account.companyId}/accounting/accounts`);
    return { success: true, data: { id: accountId } };
  } catch (error) {
    return toActionError(error);
  }
}
