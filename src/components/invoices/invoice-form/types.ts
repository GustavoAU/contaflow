// src/components/invoices/invoice-form/types.ts
// Tipos compartidos entre InvoiceForm (contenedor) y sus subcomponentes.
// Movidos MECÁNICAMENTE desde InvoiceForm.tsx — sin cambios de lógica.

export type TaxLineType = "IVA_GENERAL" | "IVA_REDUCIDO" | "IVA_ADICIONAL" | "EXENTO";

export type TaxLine = {
  id: string;
  taxType: TaxLineType;
  description: string;
  base: string;
  rate: string;
  amount: string;
  luxuryGroupId: string | null;
};

// ─── Autosave borrador (Q1-3) ────────────────────────────────────────────────
export type InvoiceDraft = {
  type: "SALE" | "PURCHASE";
  currency: "VES" | "USD" | "EUR";
  docType: string;
  taxCategory: string;
  counterpartName: string;
  taxLines: TaxLine[];
};
