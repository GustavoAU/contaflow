// src/lib/company-page-guard.ts
//
// Guard de AUTORIZACIÓN para page components de `/company/[companyId]/...`.
//
// El equivalente de `requireCompanyAction` (ADR-041) para el lado de las páginas.
// Las Server Actions ya tenían su ritual centralizado; las páginas no, y por eso
// cinco de ellas leían `prisma.company.findUnique({ where: { id: companyId } })`
// con el companyId crudo de la URL — sin atarlo al usuario.
//
// Por qué importa aunque el layout redirija (ADR-004):
//   · La lectura OCURRE igual: la fila de otra empresa se trae a memoria del
//     proceso antes de que nadie compruebe nada.
//   · Lo único que hoy impide entregarla es el `redirect("/dashboard")` del
//     layout padre — un punto único de fallo que vive en OTRO archivo. Mover la
//     ruta fuera de ese grupo de layout, envolverlo en Suspense o habilitar PPR
//     lo convierte en divulgación cross-tenant directa.
//   · `upgrade/page.tsx` ni siquiera llamaba a `auth()`.
//
// La forma correcta es la misma que usa el guard de actions: el `where` lleva
// companyId Y userId, así que un no-miembro obtiene `null` y la fila jamás se
// carga. La autorización deja de depender de un archivo lejano.

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import type { Prisma, UserRole } from "@prisma/client";

export type CompanyPageContext<S extends Prisma.CompanySelect> = {
  company: Prisma.CompanyGetPayload<{ select: S }>;
  role: UserRole;
  userId: string;
};

/**
 * Devuelve los campos pedidos de la empresa **a través de la membresía**, o
 * redirige si el usuario no es miembro.
 *
 * @param select mismos campos que se le pedirían a `prisma.company.findUnique`
 *
 * @example
 *   const { company, role } = await requireCompanyPage(companyId, { name: true });
 */
export async function requireCompanyPage<S extends Prisma.CompanySelect>(
  companyId: string,
  select: S,
): Promise<CompanyPageContext<S>> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true, company: { select } },
  });

  // Mismo destino para "no existe" y "no eres miembro": no confirmar existencia
  if (!member?.company) redirect("/dashboard");

  return {
    company: member.company as Prisma.CompanyGetPayload<{ select: S }>,
    role: member.role,
    userId,
  };
}
