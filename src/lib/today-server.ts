// src/lib/today-server.ts
//
// "Hoy" para código de SERVIDOR, donde el proceso corre en UTC (Vercel) y por
// tanto NO conoce el calendario del usuario. La zona sale del país de la empresa
// (ADR-042): `getFiscalConfig(country).timezone`.
//
// Complemento de `src/lib/today.ts` (que cubre el cliente, donde la zona del
// proceso ES la del usuario). Importa `prisma`, así que este módulo no debe
// importarse desde componentes cliente.

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { getFiscalConfig, isSupportedCountry } from "@/lib/countries";
import { todayInTimeZone } from "@/lib/today";

/**
 * Día de hoy (`YYYY-MM-DD`) en la zona del país dado.
 *
 * Para Server Actions: pasar `ctx.country` del guard (ADR-042 D-2) — cero
 * queries extra. País no soportado degrada a VEN, igual que el guard.
 */
export function todayForCountry(country: string): string {
  const cfg = getFiscalConfig(isSupportedCountry(country) ? country : "VEN");
  return todayInTimeZone(cfg.timezone);
}

/**
 * Día de hoy (`YYYY-MM-DD`) en la zona de la empresa.
 *
 * Para páginas de servidor que no pasan por `requireCompanyAction` (los cinco
 * reports lo usan solo para el redirect a `?to=<hoy>`).
 *
 * ADR-004: la lectura va SCOPED por membresía, no `company.findUnique(id)`. En
 * los reports esta llamada ocurre ANTES del check de autorización (el redirect
 * precede a la action), así que un findUnique directo dejaría que cualquier
 * usuario autenticado provocase la lectura de la fila de una empresa ajena. Con
 * el join por membresía, un no-miembro simplemente obtiene null → VEN.
 *
 * Si la BD falla degrada a VEN en vez de tumbar el render: una fecha por defecto
 * no justifica un 500.
 */
export async function todayForCompany(companyId: string): Promise<string> {
  try {
    const { userId } = await auth();
    if (!userId) return todayForCountry("VEN");

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { company: { select: { country: true } } },
    });
    return todayForCountry(member?.company?.country ?? "VEN");
  } catch {
    return todayForCountry("VEN");
  }
}
