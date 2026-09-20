import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { buildInvoiceBookTXT } from "./export-helpers";
import type {
  InvoiceBookResult,
  InvoiceBookRow,
  InvoiceBookSummary,
} from "@/modules/invoices/services/InvoiceService";

type LineSpec = [taxType: string, base: string, rate: string, amount: string];

function row(overrides: Partial<InvoiceBookRow> & { lines: LineSpec[] }): InvoiceBookRow {
  const { lines, ...rest } = overrides;
  return {
    id: `inv-${Math.random().toString(36).slice(2)}`,
    date: new Date("2026-05-10T00:00:00Z"),
    invoiceNumber: "0001",
    controlNumber: "00-0001",
    relatedDocNumber: null,
    importFormNumber: null,
    reportZStart: null,
    reportZEnd: null,
    docType: "FACTURA",
    taxCategory: "GRAVADA",
    counterpartName: "Proveedor Test",
    counterpartRif: "J-12345678-9",
    ivaRetentionAmount: "0.00",
    ivaRetentionVoucher: null,
    ivaRetentionDate: null,
    islrRetentionAmount: "0.00",
    igtfBase: "0.00",
    igtfAmount: "0.00",
    currency: "VES",
    exchangeRateId: null,
    exchangeRate: null,
    total: "0.00",
    seniatStatus: null,
    taxLines: lines.map(([taxType, base, rate, amount], i) => ({
      id: `l${i}`,
      taxType,
      base,
      rate,
      amount,
      description: null,
    })),
    ...rest,
  };
}

// Summary con los valores NETOS (las NC restan) que produce getBook: el pie del TXT no debe usarlos.
const nettedSummary: InvoiceBookSummary = {
  totalBaseGeneral: "900.00",
  totalIvaGeneral: "144.00",
  totalBaseReduced: "0.00",
  totalIvaReduced: "0.00",
  totalBaseAdditional: "0.00",
  totalIvaAdditional: "0.00",
  totalExempt: "0.00",
  totalIvaRetention: "108.00",
  totalIslrRetention: "9.00",
  totalIgtf: "0.00",
  totalBase: "900.00",
  totalIva: "144.00",
  totalAmount: "1044.00",
};

function parse(txt: string) {
  const all = txt.split("\n");
  const footerIdx = all.findIndex((l) => l.startsWith("TOTAL|"));
  const data = all.filter((l, i) => i < footerIdx && l !== "" && !l.startsWith("#"));
  return {
    lines: data.map((l) => l.split("|")),
    footer: all[footerIdx]!.split("|"),
  };
}

function columnSum(lines: string[][], col: number): string {
  return lines.reduce((acc, f) => acc.plus(f[col]!), new Decimal(0)).toFixed(2);
}

describe("buildInvoiceBookTXT — el pie suma las líneas impresas", () => {
  it("compras: una NC en el mes no descuadra el pie (las líneas van sin signo, tipo 03)", () => {
    const result: InvoiceBookResult = {
      rows: [
        row({
          invoiceNumber: "0001",
          lines: [["IVA_GENERAL", "1000.00", "16.00", "160.00"]],
          ivaRetentionAmount: "120.00",
          islrRetentionAmount: "10.00",
        }),
        row({
          invoiceNumber: "0002",
          docType: "NOTA_CREDITO",
          lines: [["IVA_GENERAL", "100.00", "16.00", "16.00"]],
          ivaRetentionAmount: "12.00",
          islrRetentionAmount: "1.00",
        }),
      ],
      summary: nettedSummary,
    };

    const { lines, footer } = parse(buildInvoiceBookTXT(result, "PURCHASE", "Empresa", 2026, 5));

    expect(lines).toHaveLength(2);
    expect(lines[1]![5]).toBe("03");
    // TOTAL|||||| base16|iva16|base8|iva8|exento|ivaRet|islr
    expect(footer.slice(6)).toEqual(["1100.00", "176.00", "0.00", "0.00", "0.00", "132.00", "11.00"]);
  });

  it("el pie coincide columna por columna con la suma de las líneas (mixto + lujo + NC)", () => {
    const result: InvoiceBookResult = {
      rows: [
        row({ invoiceNumber: "1", lines: [["IVA_GENERAL", "270.00", "16.00", "43.20"]] }),
        row({ invoiceNumber: "2", lines: [["IVA_REDUCIDO", "787430.00", "8.00", "62994.40"]] }),
        row({
          invoiceNumber: "3",
          lines: [
            ["IVA_GENERAL", "1000.00", "16.00", "160.00"],
            ["IVA_ADICIONAL", "1000.00", "15.00", "150.00"],
          ],
        }),
        row({ invoiceNumber: "4", lines: [["EXENTO", "500.00", "0.00", "0.00"]] }),
        row({ invoiceNumber: "5", docType: "NOTA_CREDITO", lines: [["IVA_GENERAL", "50.00", "16.00", "8.00"]] }),
      ],
      summary: nettedSummary,
    };

    const { lines, footer } = parse(buildInvoiceBookTXT(result, "PURCHASE", "Empresa", 2026, 5));

    for (const col of [6, 7, 8, 9, 10, 11, 12]) {
      expect(footer[col]).toBe(columnSum(lines, col));
    }
  });

  it("ventas: deja en blanco Base IGTF y suma el IGTF impreso", () => {
    const result: InvoiceBookResult = {
      rows: [
        row({
          invoiceNumber: "1",
          lines: [["IVA_GENERAL", "1000.00", "16.00", "160.00"]],
          igtfBase: "1160.00",
          igtfAmount: "34.80",
        }),
        row({
          invoiceNumber: "2",
          docType: "NOTA_CREDITO",
          lines: [["IVA_GENERAL", "100.00", "16.00", "16.00"]],
          igtfBase: "116.00",
          igtfAmount: "3.48",
        }),
      ],
      summary: { ...nettedSummary, totalIgtf: "31.32" },
    };

    const { lines, footer } = parse(buildInvoiceBookTXT(result, "SALE", "Empresa", 2026, 5));

    expect(footer).toHaveLength(14);
    expect(footer[12]).toBe("");
    expect(footer[13]).toBe("38.28");
    expect(footer[13]).toBe(columnSum(lines, 13));
  });

  it("libro vacío: el pie queda en cero", () => {
    const result: InvoiceBookResult = { rows: [], summary: nettedSummary };

    const { lines, footer } = parse(buildInvoiceBookTXT(result, "PURCHASE", "Empresa", 2026, 5));

    expect(lines).toHaveLength(0);
    expect(footer.slice(6)).toEqual(["0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00"]);
  });
});
