// src/components/invoices/invoice-form/helpers.ts
// Constantes y funciones puras movidas MECÁNICAMENTE desde InvoiceForm.tsx.
// Sin cambios de lógica — solo cambio de ubicación.

import { Decimal } from "decimal.js";
import type { TaxLine, TaxLineType } from "./types";

export const DOC_TYPES = [
  { value: "FACTURA", label: "Factura" },
  { value: "NOTA_DEBITO", label: "Nota de Débito" },
  { value: "NOTA_CREDITO", label: "Nota de Crédito" },
  { value: "REPORTE_Z", label: "Reporte Z (Máquina Fiscal)" },
  { value: "RESUMEN_VENTAS", label: "Resumen de Ventas" },
  { value: "PLANILLA_IMPORTACION", label: "Planilla de Importación" },
  { value: "OTRO", label: "Otro" },
];

export const TAX_CATEGORIES = [
  { value: "GRAVADA", label: "Gravada" },
  { value: "EXENTA", label: "Exenta" },
  { value: "EXONERADA", label: "Exonerada" },
  { value: "NO_SUJETA", label: "No Sujeta" },
  { value: "IMPORTACION", label: "Importación" },
];

// ─── Calcula monto IVA usando Decimal.js exclusivamente ───────────────────────
export function calcAmount(base: string, rate: string): string {
  try {
    const b = new Decimal(base || "0");
    const r = new Decimal(rate || "0");
    if (b.isNaN() || r.isNaN() || b.isNegative() || r.isNegative()) return "0.00";
    return b.mul(r).div(100).toFixed(2);
  } catch {
    return "0.00";
  }
}

// ─── Suma total IVA usando Decimal.js exclusivamente ─────────────────────────
export function sumTaxLines(lines: TaxLine[]): string {
  return lines
    .reduce((acc, l) => {
      try {
        return acc.plus(new Decimal(l.amount || "0"));
      } catch {
        return acc;
      }
    }, new Decimal(0))
    .toFixed(2);
}

// ─── Formatea monto con símbolo de moneda ────────────────────────────────────
export function formatCurrencyAmount(amount: string, currency: string): string {
  const num = parseFloat(amount) || 0;
  if (currency === "VES") return `Bs.D ${num.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (currency === "USD") return `$ ${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (currency === "EUR") return `€ ${num.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${currency} ${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── updateTaxLine unificado — reducer puro ───────────────────────────────────
// Cuerpo movido VERBATIM del setTaxLines((prev) => ...) de InvoiceForm.updateTaxLine.
// El handler updateTaxLine sigue viviendo en el contenedor y delega aquí.
export function updateTaxLineState(
  prev: TaxLine[],
  id: string,
  field: keyof TaxLine,
  value: string
): TaxLine[] {
  const line = prev.find((l) => l.id === id);
  if (!line) return prev;

  // 1. CAMBIO A IVA_ADICIONAL — limpiar líneas huérfanas y crear par limpio
  if (field === "taxType" && value === "IVA_ADICIONAL") {
    // Primero eliminar cualquier línea vinculada anterior de esta línea
    const cleanPrev = line.luxuryGroupId
      ? prev.filter((l) => l.luxuryGroupId !== line.luxuryGroupId || l.id === id)
      : prev;

    const groupId = crypto.randomUUID();
    return [
      ...cleanPrev.map((l) =>
        l.id === id
          ? {
              ...l,
              taxType: "IVA_ADICIONAL" as TaxLineType,
              rate: "15",
              amount: calcAmount(l.base, "15"),
              luxuryGroupId: groupId,
            }
          : l
      ),
      {
        id: crypto.randomUUID(),
        taxType: "IVA_GENERAL" as TaxLineType,
        description: "",
        base: line.base,
        rate: "16",
        amount: calcAmount(line.base, "16"),
        luxuryGroupId: groupId,
      },
    ];
  }

  // 2. CAMBIO DESDE IVA_ADICIONAL A OTRO TIPO — eliminar línea hermana vinculada
  if (field === "taxType" && line.taxType === "IVA_ADICIONAL" && value !== "IVA_ADICIONAL") {
    const rateMap: Record<string, string> = {
      IVA_GENERAL: "16",
      IVA_REDUCIDO: "8",
      EXENTO: "0",
    };
    const newRate = rateMap[value] ?? "0";
    // Eliminar la línea hermana IVA_GENERAL vinculada
    const withoutSister = prev.filter(
      (l) => !(l.luxuryGroupId === line.luxuryGroupId && l.id !== id)
    );
    return withoutSister.map((l) =>
      l.id === id
        ? {
            ...l,
            taxType: value as TaxLineType,
            rate: newRate,
            amount: calcAmount(l.base, newRate),
            luxuryGroupId: null,
          }
        : l
    );
  }

  // 3. SINCRONIZACIÓN ATÓMICA DE BASES — espejo entre líneas vinculadas
  if (field === "base" && line.luxuryGroupId) {
    return prev.map((l) =>
      l.luxuryGroupId === line.luxuryGroupId
        ? { ...l, base: value, amount: calcAmount(value, l.rate) }
        : l
    );
  }

  // 4. CAMBIO DE TIPO NORMAL — líneas no vinculadas
  if (field === "taxType") {
    const rateMap: Record<string, string> = {
      IVA_GENERAL: "16",
      IVA_REDUCIDO: "8",
      EXENTO: "0",
    };
    const newRate = rateMap[value] ?? "0";
    return prev.map((l) =>
      l.id === id
        ? {
            ...l,
            taxType: value as TaxLineType,
            rate: newRate,
            amount: calcAmount(l.base, newRate),
            luxuryGroupId: null,
          }
        : l
    );
  }

  // 5. CAMBIO DE BASE O TASA — líneas normales
  return prev.map((l) => {
    if (l.id !== id) return l;
    const updated = { ...l, [field]: value };
    if (field === "base" || field === "rate") {
      updated.amount = calcAmount(
        field === "base" ? value : l.base,
        field === "rate" ? value : l.rate
      );
    }
    return updated;
  });
}

// ─── Validación pre-submit ───────────────────────────────────────────────────
// Cuerpo movido VERBATIM de InvoiceForm.validateBeforeSubmit — recibe por
// parámetro lo que antes leía por closure (taxLines, taxCategory).
export function validateTaxLinesBeforeSubmit(
  taxLines: TaxLine[],
  taxCategory: string
): string | null {
  const hasAdicional = taxLines.some((l) => l.taxType === "IVA_ADICIONAL");
  const hasGeneral = taxLines.some((l) => l.taxType === "IVA_GENERAL");

  if (hasAdicional && !hasGeneral) {
    return "Una factura de bien suntuario requiere una línea de IVA General (16%). El par no está completo.";
  }

  if (hasAdicional && hasGeneral) {
    const adicional = taxLines.find((l) => l.taxType === "IVA_ADICIONAL")!;
    const general = taxLines.find(
      (l) => l.taxType === "IVA_GENERAL" && l.luxuryGroupId === adicional.luxuryGroupId
    );
    if (!general || adicional.base !== general.base) {
      return "Las bases de IVA General (16%) e IVA Adicional (15%) deben ser iguales en bienes suntuarios.";
    }
  }

  const linesWithBase = taxLines.filter(
    (l) => l.taxType !== "EXENTO" && l.base && !new Decimal(l.base || "0").isZero()
  );

  if (linesWithBase.length === 0 && taxCategory === "GRAVADA") {
    return "Debes ingresar al menos una base imponible mayor a cero.";
  }

  for (const line of linesWithBase) {
    const expected = calcAmount(line.base, line.rate);
    if (line.amount !== expected) {
      return `Monto IVA inconsistente en línea ${line.taxType.replace(/_/g, " ")}. Recalculando...`;
    }
  }

  const categoryForcesZero = ["EXENTA", "EXONERADA", "NO_SUJETA"].includes(taxCategory);
  if (categoryForcesZero) {
    const hasNonZeroIva = taxLines.some(
      (l) => l.taxType !== "EXENTO" && l.base && !new Decimal(l.base || "0").isZero()
    );
    if (hasNonZeroIva) {
      return `Una factura ${taxCategory.toLowerCase()} no puede tener líneas de IVA con base imponible. Cambia las líneas a 'Exento / Exonerado' o corrige la categoría fiscal.`;
    }
  }

  return null;
}
