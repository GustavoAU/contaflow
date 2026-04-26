"use server";

// src/modules/iva-declaration/actions/generarForma30.action.ts

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { FiscalYearCloseService } from "@/modules/fiscal-close/services/FiscalYearCloseService";
import { GenerarForma30Schema } from "../schemas/generarForma30.schema";
import { DeclaracionIVAService } from "../services/DeclaracionIVAService";
import type { Forma30Result, TaxLineRow } from "../types/forma30.types";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export type SerializedTaxLine = { base: string; tax: string };
export type SerializedBaseOnly = { base: string };

export type SerializedForma30Result = {
  companyId: string;
  year: number;
  month: number;
  periodExists: boolean;
  isSpecialContributor: boolean;
  fiscalYearClosed: boolean;
  calculatedAt: string;
  seccionA: {
    general: SerializedTaxLine;
    reducida: SerializedTaxLine;
    adicionalLujo: SerializedTaxLine;
    exentasExoneradas: SerializedBaseOnly;
    exportaciones: SerializedBaseOnly;
    totalDebitosFiscales: string;
  };
  seccionB: {
    general: SerializedTaxLine;
    reducida: SerializedTaxLine;
    adicionalLujo: SerializedTaxLine;
    exentasExoneradas: SerializedBaseOnly;
    importaciones: SerializedTaxLine;
    totalCreditosFiscales: string;
  };
  seccionC: {
    retencionesIvaSufridas: string;
    retencionesIvaPracticadas: string;
    totalRetenciones: string;
  };
  seccionD: { igtfBase: string; igtfTotal: string };
  seccionE: { cuotaPeriodo: string; esSaldoAFavor: boolean };
};

function stl(tl: TaxLineRow): SerializedTaxLine {
  return { base: tl.base.toFixed(2), tax: tl.tax.toFixed(2) };
}

function serializeForma30(r: Forma30Result, fiscalYearClosed: boolean): SerializedForma30Result {
  return {
    companyId: r.companyId,
    year: r.year,
    month: r.month,
    periodExists: r.periodExists,
    isSpecialContributor: r.isSpecialContributor,
    fiscalYearClosed,
    calculatedAt: r.calculatedAt.toISOString(),
    seccionA: {
      general: stl(r.seccionA.general),
      reducida: stl(r.seccionA.reducida),
      adicionalLujo: stl(r.seccionA.adicionalLujo),
      exentasExoneradas: { base: r.seccionA.exentasExoneradas.base.toFixed(2) },
      exportaciones: { base: r.seccionA.exportaciones.base.toFixed(2) },
      totalDebitosFiscales: r.seccionA.totalDebitosFiscales.toFixed(2),
    },
    seccionB: {
      general: stl(r.seccionB.general),
      reducida: stl(r.seccionB.reducida),
      adicionalLujo: stl(r.seccionB.adicionalLujo),
      exentasExoneradas: { base: r.seccionB.exentasExoneradas.base.toFixed(2) },
      importaciones: stl(r.seccionB.importaciones),
      totalCreditosFiscales: r.seccionB.totalCreditosFiscales.toFixed(2),
    },
    seccionC: {
      retencionesIvaSufridas: r.seccionC.retencionesIvaSufridas.toFixed(2),
      retencionesIvaPracticadas: r.seccionC.retencionesIvaPracticadas.toFixed(2),
      totalRetenciones: r.seccionC.totalRetenciones.toFixed(2),
    },
    seccionD: {
      igtfBase: r.seccionD.igtfBase.toFixed(2),
      igtfTotal: r.seccionD.igtfTotal.toFixed(2),
    },
    seccionE: {
      cuotaPeriodo: r.seccionE.cuotaPeriodo.abs().toFixed(2),
      esSaldoAFavor: r.seccionE.esSaldoAFavor,
    },
  };
}

export type Forma30ActionResult = SerializedForma30Result;

/**
 * Server Action para calcular la Forma 30 SENIAT de un período mensual.
 *
 * Flujo ADR-006 D-1:
 *   1. auth() — verificar sesión
 *   2. checkRateLimit — proteger queries costosas
 *   3. safeParse — validar input
 *   4. companyMember — verificar pertenencia (cualquier rol)
 *   5. DeclaracionIVAService.calculate()
 *
 * FiscalYearClose: informativo únicamente — no bloquea la declaración mensual.
 */
export async function generarForma30Action(
  companyId: string,
  year: number,
  month: number
): Promise<ActionResult<Forma30ActionResult>> {
  // 1. Autenticación
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  // 2. Rate limit
  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes. Intente más tarde." };

  // 3. Validar input
  const parsed = GenerarForma30Schema.safeParse({ companyId, year, month });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    // 4. Verificar membresía (cualquier rol puede generar reportes)
    const member = await prisma.companyMember.findFirst({
      where: { companyId: parsed.data.companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };

    // 5. FiscalYearClose — informativo, no bloquea
    const fiscalYearClosed = await FiscalYearCloseService.isFiscalYearClosed(
      parsed.data.companyId,
      parsed.data.year
    );

    // 6. Calcular Forma 30
    const result = await DeclaracionIVAService.calculate(
      parsed.data.companyId,
      parsed.data.year,
      parsed.data.month
    );

    return {
      success: true,
      data: serializeForma30(result, fiscalYearClosed),
    };
  } catch (err) {
    if (err instanceof Error) return { success: false, error: err.message };
    return { success: false, error: "Error al calcular la declaración de IVA" };
  }
}
