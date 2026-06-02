// src/lib/digital-invoice/providers/mock.provider.ts
// Provider simulado para desarrollo local y tests.
// Devuelve respuestas deterministas basadas en el RIF del receptor.

import type {
  DigitalInvoiceProvider,
  DigitalInvoiceSubmission,
  DigitalInvoiceResult,
  DigitalVoidResult,
} from "../provider.types";
import { DigitalInvoiceProviderError } from "../provider.types";

export interface MockProviderOptions {
  /** Si true, simula un timeout en submitInvoice */
  simulateTimeout?: boolean;
  /** Si true, activa modo contingencia en las respuestas */
  simulateContingency?: boolean;
  /** Latencia artificial en ms (default 50) */
  latencyMs?: number;
}

export class MockDigitalInvoiceProvider implements DigitalInvoiceProvider {
  readonly name = "MOCK";
  private sequence = 1000;

  constructor(private readonly options: MockProviderOptions = {}) {}

  async submitInvoice(invoice: DigitalInvoiceSubmission): Promise<DigitalInvoiceResult> {
    await this.delay();

    if (this.options.simulateTimeout) {
      throw new DigitalInvoiceProviderError(
        "Simulated timeout",
        this.name,
        true,
      );
    }

    const seq = String(++this.sequence).padStart(8, "0");
    const controlNumber = `00-${seq}`;
    const referenceId = `MOCK-${Date.now()}-${invoice.customerRif}`;

    return {
      controlNumber,
      qrCodeData:          `https://efactura.seniat.gob.ve/qr/${referenceId}`,
      providerReferenceId: referenceId,
      issuedAt:            new Date(),
      isContingency:       this.options.simulateContingency ?? false,
    };
  }

  async voidInvoice(_controlNumber: string, _reason: string): Promise<DigitalVoidResult> {
    await this.delay();
    return {
      success:  true,
      voidedAt: new Date(),
    };
  }

  async healthCheck(): Promise<boolean> {
    await this.delay();
    return !this.options.simulateTimeout;
  }

  private async delay(): Promise<void> {
    const ms = this.options.latencyMs ?? 50;
    await new Promise((r) => setTimeout(r, ms));
  }
}
