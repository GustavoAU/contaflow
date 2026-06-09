"use server";

// src/modules/iva-declaration/actions/exportForma30PDF.action.ts

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { GenerarForma30Schema } from "../schemas/generarForma30.schema";
import { DeclaracionIVAService } from "../services/DeclaracionIVAService";
import { generateForma30PDF } from "../services/Forma30PDFService";
import { Decimal } from "decimal.js";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

/**
 * Server Action — exporta el PDF de la Forma 30 SENIAT para un período mensual.
 *
 * Flujo ADR-006 D-1:
 *   1. auth() — verificar sesión
 *   2. checkRateLimit — proteger queries + renderizado PDF
 *   3. safeParse — validar input
 *   4. companyMember — verificar pertenencia (cualquier rol, lectura)
 *   5. DeclaracionIVAService.calculate()
 *   6. generateForma30PDF() → Buffer → base64
 *
 * @returns base64 del PDF o error message
 */
export async function exportForma30PDFAction(
  companyId: string,
  year: number,
  month: number,
  creditoFiscalPeriodoAnterior?: number,
): Promise<ActionResult<string>> {
  // 1. Autenticación
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  // 2. Rate limit
  const rl = await checkRateLimit(userId, limiters.export);
  if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes. Intente más tarde." };

  // 3. Validar input
  const parsed = GenerarForma30Schema.safeParse({ companyId, year, month, creditoFiscalPeriodoAnterior });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    // 4. Verificar membresía (cualquier rol puede exportar reportes)
    const member = await prisma.companyMember.findFirst({
      where: { companyId: parsed.data.companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };

    // Obtener datos de la empresa para el encabezado PA-121 del PDF
    const company = await prisma.company.findUnique({
      where: { id: parsed.data.companyId },
      select: { name: true, rif: true, isSpecialContributor: true, address: true, telefono: true, email: true, ciiu: true, actividad: true },
    });
    if (!company) return { success: false, error: "Empresa no encontrada" };

    // 5. Calcular Forma 30 (con crédito anterior si aplica)
    const creditoDecimal = new Decimal(parsed.data.creditoFiscalPeriodoAnterior ?? 0);
    const result = await DeclaracionIVAService.calculate(
      parsed.data.companyId,
      parsed.data.year,
      parsed.data.month,
      undefined,
      creditoDecimal,
    );

    // 6. Generar PDF
    const pdfBuffer = await generateForma30PDF({
      companyName: company.name,
      companyRif: company.rif ?? null,
      companyAddress: company.address ?? null,
      companyTelefono: company.telefono ?? null,
      companyEmail: company.email ?? null,
      companyCiiu: company.ciiu ?? null,
      companyActividad: company.actividad ?? null,
      year: parsed.data.year,
      month: parsed.data.month,
      isSpecialContributor: company.isSpecialContributor,
      seccionA: result.seccionA,
      seccionB: result.seccionB,
      seccionC: result.seccionC,
      seccionD: result.seccionD,
      seccionE: result.seccionE,
    });

    return { success: true, data: pdfBuffer.toString("base64") };
  } catch (err) {
    return toActionError(err);
  }
}
