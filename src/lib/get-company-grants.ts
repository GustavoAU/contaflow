import { unstable_cache } from "next/cache";
import prisma from "@/lib/prisma";
import { toGrantSet } from "@/lib/app-modules";

/**
 * Devuelve los grants de una empresa como Set "ROLE:module".
 * Cacheado por companyId dentro de la request (unstable_cache).
 * Se invalida cuando permission.actions usa revalidatePath(`/company/${companyId}`).
 */
export function getCompanyGrants(companyId: string): Promise<Set<string>> {
  return unstable_cache(
    async () => {
      const rows = await prisma.rolePermission.findMany({
        where: { companyId },
        select: { role: true, module: true },
      });
      return toGrantSet(rows);
    },
    [`grants`, companyId]
  )();
}
