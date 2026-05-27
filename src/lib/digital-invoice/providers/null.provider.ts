// src/lib/digital-invoice/providers/null.provider.ts
// No-op provider para empresas sin facturación digital (digitalInvoiceProvider = NONE).
// Nunca se llama en producción — el DigitalInvoiceFactory retorna null para NONE
// y createInvoiceAction salta el paso de proveedor.

import type {
  DigitalInvoiceProvider,
  DigitalInvoiceSubmission,
  DigitalInvoiceResult,
  DigitalVoidResult,
} from "../provider.types";

export class NullDigitalInvoiceProvider implements DigitalInvoiceProvider {
  readonly name = "NULL";

  async submitInvoice(_invoice: DigitalInvoiceSubmission): Promise<DigitalInvoiceResult> {
    throw new Error("NullProvider: empresa no configurada para facturación digital");
  }

  async voidInvoice(_controlNumber: string, _reason: string): Promise<DigitalVoidResult> {
    throw new Error("NullProvider: empresa no configurada para facturación digital");
  }

  async healthCheck(): Promise<boolean> {
    return false;
  }
}
