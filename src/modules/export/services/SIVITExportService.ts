// src/modules/export/services/SIVITExportService.ts
//
// Genera los Libros de Compras y Ventas en formato SIVIT (SENIAT).
// Formato: pipe-delimitado, una línea por documento, sin encabezado.
// Referencia: Providencia SNAT/2003/1677 y sucesivas actualizaciones.
import prisma from "@/lib/prisma";
import Decimal from "decimal.js";
import JSZip from "jszip";

export type SIVITParams = {
  companyId: string;
  dateFrom: Date;
  dateTo: Date;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = dt.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function fmtNum(d: Decimal): string {
  return d.toFixed(2);
}

function dec(v: unknown): Decimal {
  if (v === null || v === undefined) return new Decimal(0);
  return new Decimal(String(v));
}

// SIVIT tipo documento: F | NC | ND | PI
function mapDocType(docType: string): string {
  switch (docType) {
    case "NOTA_CREDITO":        return "NC";
    case "NOTA_DEBITO":         return "ND";
    case "PLANILLA_IMPORTACION": return "PI";
    default:                    return "F";
  }
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

type InvRow = Awaited<ReturnType<typeof fetchInvoices>>[number];

async function fetchInvoices(params: SIVITParams, type: "SALE" | "PURCHASE") {
  return prisma.invoice.findMany({
    where: {
      companyId: params.companyId,
      type,
      date: { gte: params.dateFrom, lte: params.dateTo },
      deletedAt: null,
    },
    select: {
      invoiceNumber:          true,
      controlNumber:          true,
      docType:                true,
      date:                   true,
      counterpartName:        true,
      counterpartRif:         true,
      ivaRetentionAmount:     true,
      ivaRetentionVoucher:    true,
      ivaRetentionDate:       true,
      islrRetentionAmount:    true,
      igtfBase:               true,
      igtfAmount:             true,
      relatedDocNumber:       true,
      taxLines: {
        select: { taxType: true, base: true, amount: true },
      },
    },
    orderBy: [{ date: "asc" }, { invoiceNumber: "asc" }],
  });
}

// ─── Row builder ──────────────────────────────────────────────────────────────

function buildSIVITLine(inv: InvRow, type: "SALE" | "PURCHASE"): string {
  const exento    = inv.taxLines.find((t) => t.taxType === "EXENTO");
  const reducido  = inv.taxLines.find((t) => t.taxType === "IVA_REDUCIDO");
  const general   = inv.taxLines.find((t) => t.taxType === "IVA_GENERAL");
  const adicional = inv.taxLines.find((t) => t.taxType === "IVA_ADICIONAL");

  const montoExento        = dec(exento?.base);
  const baseReducida       = dec(reducido?.base);
  const ivaReducida        = dec(reducido?.amount);
  const baseGeneral        = dec(general?.base);
  const ivaGeneral         = dec(general?.amount);
  // IVA_ADICIONAL comparte base con IVA_GENERAL; no se suma la base de nuevo al total
  const baseAdicional      = dec(adicional?.base);
  const ivaAdicional       = dec(adicional?.amount);
  const ivaRetenido        = dec(inv.ivaRetentionAmount);

  // Total = base exenta + base 8% + iva 8% + base 16% + iva 16% + iva adicional (no base adicional, ya está en base 16%)
  const total = montoExento
    .plus(baseReducida).plus(ivaReducida)
    .plus(baseGeneral).plus(ivaGeneral)
    .plus(ivaAdicional);

  const fields = [
    mapDocType(inv.docType),
    fmtDate(inv.date),
    inv.controlNumber ?? "",
    inv.invoiceNumber,
    inv.counterpartRif ?? "S/RIF",
    inv.counterpartName,
    inv.relatedDocNumber ?? "",
    fmtNum(montoExento),
    "0.00",                           // monto no sujeto — no tracked separately
    fmtNum(baseReducida),
    fmtNum(ivaReducida),
    fmtNum(baseGeneral),
    fmtNum(ivaGeneral),
    fmtNum(baseAdicional),
    fmtNum(ivaAdicional),
    fmtNum(total),
    inv.ivaRetentionVoucher ?? "",
    fmtDate(inv.ivaRetentionDate),
    fmtNum(ivaRetenido),
    // Columnas finales diferenciadas por tipo de libro (Prov. SNAT/2003/1677)
    ...(type === "SALE"
      ? [fmtNum(dec(inv.igtfBase)), fmtNum(dec(inv.igtfAmount))]
      : [fmtNum(dec(inv.islrRetentionAmount))]),
  ];

  return fields.join("|");
}

// ─── Public generators ────────────────────────────────────────────────────────

async function generateTxt(params: SIVITParams, type: "SALE" | "PURCHASE"): Promise<string> {
  const rows = await fetchInvoices(params, type);
  return rows.map((r) => buildSIVITLine(r, type)).join("\r\n");
}

export async function generateSIVITZip(params: SIVITParams): Promise<Buffer> {
  const [ventasTxt, comprasTxt] = await Promise.all([
    generateTxt(params, "SALE"),
    generateTxt(params, "PURCHASE"),
  ]);

  const from = fmtDate(params.dateFrom);
  const to   = fmtDate(params.dateTo);

  const zip = new JSZip();
  if (ventasTxt)  zip.file("LV.txt", ventasTxt);
  if (comprasTxt) zip.file("LC.txt", comprasTxt);
  zip.file(
    "LEEME.txt",
    [
      "ContaFlow — Exportación SIVIT",
      `Período: ${from} al ${to}`,
      `Generado: ${new Date().toISOString()}`,
      "",
      "LV.txt — Libro de Ventas (formato SIVIT)",
      "LC.txt — Libro de Compras (formato SIVIT)",
      "",
      "Columnas LV.txt (separadas por |):",
      "TIPO_DOC|FECHA|NRO_CONTROL|NRO_FACTURA|RIF|NOMBRE|DOC_AFECTADO|",
      "MONTO_EXENTO|MONTO_NO_SUJETO|BASE_8|IVA_8|BASE_16|IVA_16|",
      "BASE_ADICIONAL|IVA_ADICIONAL|TOTAL|NRO_COMPROBANTE_RET|FECHA_RET|IVA_RETENIDO|",
      "BASE_IGTF|IGTF",
      "",
      "Columnas LC.txt (separadas por |):",
      "TIPO_DOC|FECHA|NRO_CONTROL|NRO_FACTURA|RIF|NOMBRE|DOC_AFECTADO|",
      "MONTO_EXENTO|MONTO_NO_SUJETO|BASE_8|IVA_8|BASE_16|IVA_16|",
      "BASE_ADICIONAL|IVA_ADICIONAL|TOTAL|NRO_COMPROBANTE_RET|FECHA_RET|IVA_RETENIDO|",
      "ISLR_RETENIDO",
      "",
      "Referencia: Providencia SNAT/2003/1677 y SNAT/2005/0056 (IGTF)",
    ].join("\n")
  );

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return buffer;
}
