// src/modules/iva-declaration/types/forma30.types.ts

import { Decimal } from "decimal.js";

/** Una fila de base imponible + impuesto para una alícuota dada */
export interface TaxLineRow {
  /** Base imponible en VES */
  base: Decimal;
  /** Monto de IVA (débito fiscal para ventas, crédito fiscal para compras) */
  tax: Decimal;
}

/** Sección A — Débitos Fiscales (Ventas) */
export interface SeccionA {
  /** A1: Ventas gravadas alícuota general 16% */
  general: TaxLineRow;
  /** A2: Ventas gravadas alícuota reducida 8% */
  reducida: TaxLineRow;
  /**
   * A3: Ventas gravadas alícuota adicional lujo (15%).
   * La base es la misma que en A1 para los productos de lujo — no se duplica.
   */
  adicionalLujo: TaxLineRow;
  /** A4: Ventas exentas y exoneradas (IVA = 0) */
  exentasExoneradas: { base: Decimal };
  /** A5: Exportaciones */
  exportaciones: { base: Decimal };
  /** Suma total de débitos fiscales (A1.tax + A2.tax + A3.tax) */
  totalDebitosFiscales: Decimal;
}

/** Sección B — Créditos Fiscales (Compras) */
export interface SeccionB {
  /** B1: Compras gravadas alícuota general 16% */
  general: TaxLineRow;
  /** B2: Compras gravadas alícuota reducida 8% */
  reducida: TaxLineRow;
  /** B3: Compras gravadas alícuota adicional lujo 15% */
  adicionalLujo: TaxLineRow;
  /** B4: Compras exentas y exoneradas */
  exentasExoneradas: { base: Decimal };
  /** B5: Importaciones (PLANILLA_IMPORTACION) */
  importaciones: TaxLineRow;
  /** Suma total de créditos fiscales (B1.tax + B2.tax + B3.tax + B5.tax) */
  totalCreditosFiscales: Decimal;
}

/** Sección C — Retenciones IVA */
export interface SeccionC {
  /**
   * C1: Retenciones IVA sufridas (clientes nos retuvieron).
   * Solo aplica si company.isSpecialContributor = true.
   * Fuente: Invoice(type=SALE).ivaRetentionAmount
   */
  retencionesIvaSufridas: Decimal;
  /**
   * C2: Retenciones IVA practicadas (nosotros retuvimos a proveedores).
   * Solo aplica si company.isSpecialContributor = true.
   * Fuente: Retencion.ivaRetention WHERE status != VOIDED AND deletedAt IS NULL
   */
  retencionesIvaPracticadas: Decimal;
  /** Total retenciones = C1 + C2 */
  totalRetenciones: Decimal;
}

/** Sección D — IGTF */
export interface SeccionD {
  /** Monto base sobre el que se calculó el IGTF */
  igtfBase: Decimal;
  /** Total IGTF pagado en el período */
  igtfTotal: Decimal;
}

/** Sección E — Cuota del período o saldo a favor */
export interface SeccionE {
  /**
   * E1: Crédito fiscal arrastrado del período anterior (saldo a favor mes previo).
   * Ingresado manualmente por el usuario. Siempre >= 0.
   */
  creditoFiscalPeriodoAnterior: Decimal;
  /**
   * Fórmula: totalDebitosFiscales - totalCreditosFiscales - totalRetenciones - creditoFiscalPeriodoAnterior
   * Positivo → monto a pagar. Negativo → saldo a favor.
   */
  cuotaPeriodo: Decimal;
  /** true si cuotaPeriodo < 0 */
  esSaldoAFavor: boolean;
  /**
   * E2: Excedente de crédito fiscal a trasladar al próximo período.
   * = |cuotaPeriodo| cuando esSaldoAFavor = true; 0 en caso contrario.
   * Este es el valor que el contador debe ingresar como creditoFiscalPeriodoAnterior el mes siguiente.
   */
  excedenteCreditoFiscal: Decimal;
}

/** Resultado completo de la Forma 30 SENIAT */
export interface Forma30Result {
  companyId: string;
  year: number;
  /** Mes 1-12 */
  month: number;
  /** Indica si existe un AccountingPeriod registrado para este mes */
  periodExists: boolean;
  /** Indica si la empresa es contribuyente especial */
  isSpecialContributor: boolean;
  seccionA: SeccionA;
  seccionB: SeccionB;
  seccionC: SeccionC;
  seccionD: SeccionD;
  seccionE: SeccionE;
  /** Timestamp en que se calculó el resultado (UTC) */
  calculatedAt: Date;
}
