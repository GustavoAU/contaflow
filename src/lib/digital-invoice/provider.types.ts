// src/lib/digital-invoice/provider.types.ts
// Contrato neutral entre ContaFlow y cualquier Imprenta Digital autorizada por el SENIAT.
// ADR-031 — Facturación Digital PA-102

import type Decimal from "decimal.js";

// ─── Tipos de entrada ─────────────────────────────────────────────────────────

export interface DigitalInvoiceLine {
  description: string;
  quantity:    Decimal;
  unitPrice:   Decimal;
  taxRate:     number;   // 0 | 8 | 16 | 31
  total:       Decimal;
}

export interface DigitalInvoiceSubmission {
  // Emisor
  companyRif:     string;
  companyName:    string;
  companyAddress: string;

  // Receptor
  customerRif:     string;
  customerName:    string;
  customerAddress?: string;

  // Documento
  invoiceDate: Date;
  docType:     "FACTURA" | "NOTA_DEBITO" | "NOTA_CREDITO";

  // Líneas
  lines: DigitalInvoiceLine[];

  // Totales
  subtotal:   Decimal;
  ivaAmount:  Decimal;
  total:      Decimal;

  // Moneda
  currency:      string;
  exchangeRate?: Decimal; // solo si currency !== VES

  // Para NC/ND: referencia al documento original
  relatedControlNumber?: string;
}

// ─── Tipos de respuesta ───────────────────────────────────────────────────────

export interface DigitalInvoiceResult {
  controlNumber:       string;  // Número de control fiscal del proveedor
  qrCodeData:          string;  // URL o contenido del QR para el PDF
  providerReferenceId: string;  // ID interno del proveedor (para reconciliación)
  issuedAt:            Date;
  isContingency:       boolean; // true si el proveedor emitió en modo contingencia
}

export interface DigitalVoidResult {
  success: boolean;
  voidedAt: Date;
}

// ─── Interface del proveedor ──────────────────────────────────────────────────

export interface DigitalInvoiceProvider {
  readonly name: string; // "HKA" | "MOCK" | "NULL"

  /**
   * Emite un documento fiscal y obtiene el número de control + QR del proveedor.
   * Se llama ANTES de la transacción DB.
   */
  submitInvoice(invoice: DigitalInvoiceSubmission): Promise<DigitalInvoiceResult>;

  /**
   * Anula un documento previamente emitido.
   */
  voidInvoice(controlNumber: string, reason: string): Promise<DigitalVoidResult>;

  /**
   * Verifica conectividad con el proveedor (para health check).
   */
  healthCheck(): Promise<boolean>;
}

// ─── Errores tipados ──────────────────────────────────────────────────────────

export class DigitalInvoiceProviderError extends Error {
  constructor(
    message: string,
    public readonly providerName: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DigitalInvoiceProviderError";
  }
}

export class DigitalInvoiceTimeoutError extends DigitalInvoiceProviderError {
  constructor(providerName: string) {
    super(`Timeout al contactar ${providerName}`, providerName, true);
    this.name = "DigitalInvoiceTimeoutError";
  }
}
