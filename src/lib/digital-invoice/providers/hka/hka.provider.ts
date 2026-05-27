// src/lib/digital-invoice/providers/hka/hka.provider.ts
// Adaptador para The Factory HKA — Imprenta Digital Autorizada por el SENIAT.
//
// STUB — implementación pendiente de documentación oficial de HKA.
// La estructura del adaptador está completa; los métodos privados de mapeo
// se completarán al recibir la documentación de la API.
//
// Referencia: ADR-031

import type {
  DigitalInvoiceProvider,
  DigitalInvoiceSubmission,
  DigitalInvoiceResult,
  DigitalVoidResult,
} from "../../provider.types";
import {
  DigitalInvoiceProviderError,
  DigitalInvoiceTimeoutError,
} from "../../provider.types";
import type { HKAInvoiceRequest, HKAInvoiceResponse, HKAVoidResponse } from "./hka.types";

const HKA_TIMEOUT_MS = 10_000;

export interface HKAProviderConfig {
  apiKey:   string; // descifrado en memoria — nunca loguear
  baseUrl:  string; // ej: https://api.thefactoryhka.com/v1
}

export class HKADigitalInvoiceProvider implements DigitalInvoiceProvider {
  readonly name = "HKA";

  constructor(private readonly config: HKAProviderConfig) {}

  async submitInvoice(invoice: DigitalInvoiceSubmission): Promise<DigitalInvoiceResult> {
    const body = this.mapToHKARequest(invoice);

    let response: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HKA_TIMEOUT_MS);
      try {
        response = await fetch(`${this.config.baseUrl}/facturas`, {
          method:  "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${this.config.apiKey}`,
            "X-Source":      "ContaFlow",
          },
          body:   JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new DigitalInvoiceTimeoutError(this.name);
      }
      throw new DigitalInvoiceProviderError(
        `Error de red al contactar HKA: ${err instanceof Error ? err.message : String(err)}`,
        this.name,
        true,
        err,
      );
    }

    if (!response.ok) {
      const retryable = response.status >= 500;
      throw new DigitalInvoiceProviderError(
        `HKA respondió ${response.status}`,
        this.name,
        retryable,
      );
    }

    const data = (await response.json()) as HKAInvoiceResponse;

    if (data.codigo_respuesta !== "00") {
      throw new DigitalInvoiceProviderError(
        `HKA rechazó la factura: ${data.mensaje}`,
        this.name,
        false,
      );
    }

    return this.mapToResult(data);
  }

  async voidInvoice(controlNumber: string, reason: string): Promise<DigitalVoidResult> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/facturas/${controlNumber}/anular`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ motivo: reason }),
      });
    } catch (err) {
      throw new DigitalInvoiceProviderError(
        `Error de red al anular en HKA: ${err instanceof Error ? err.message : String(err)}`,
        this.name,
        true,
        err,
      );
    }

    if (!response.ok) {
      throw new DigitalInvoiceProviderError(
        `HKA respondió ${response.status} al anular`,
        this.name,
        response.status >= 500,
      );
    }

    const data = (await response.json()) as HKAVoidResponse;
    return {
      success:  data.codigo_respuesta === "00",
      voidedAt: new Date(data.fecha_anulacion),
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/health`, {
        headers: { "Authorization": `Bearer ${this.config.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ─── Mapeo de datos (STUB — completar con documentación oficial HKA) ────────

  private mapToHKARequest(invoice: DigitalInvoiceSubmission): HKAInvoiceRequest {
    // TODO: confirmar nombres exactos de campos con documentación HKA
    return {
      rif_emisor:      invoice.companyRif,
      nombre_emisor:   invoice.companyName,
      rif_receptor:    invoice.customerRif,
      nombre_receptor: invoice.customerName,
      fecha:           invoice.invoiceDate.toISOString().split("T")[0],
      tipo_documento:  this.mapDocType(invoice.docType),
      lineas: invoice.lines.map((l) => ({
        descripcion: l.description,
        cantidad:    l.quantity.toFixed(4),
        precio_unit: l.unitPrice.toFixed(4),
        tasa_iva:    String(l.taxRate),
        monto_total: l.total.toFixed(2),
      })),
      subtotal:  invoice.subtotal.toFixed(2),
      monto_iva: invoice.ivaAmount.toFixed(2),
      total:     invoice.total.toFixed(2),
      moneda:    invoice.currency,
      ...(invoice.exchangeRate && { tasa_cambio: invoice.exchangeRate.toFixed(4) }),
      ...(invoice.relatedControlNumber && {
        numero_control_relacionado: invoice.relatedControlNumber,
      }),
    };
  }

  private mapDocType(docType: DigitalInvoiceSubmission["docType"]): "01" | "02" | "03" {
    if (docType === "FACTURA")       return "01";
    if (docType === "NOTA_DEBITO")   return "02";
    return "03";
  }

  private mapToResult(data: HKAInvoiceResponse): DigitalInvoiceResult {
    return {
      controlNumber:       data.numero_control,
      qrCodeData:          data.qr_url,
      providerReferenceId: data.id_transaccion,
      issuedAt:            new Date(data.fecha_emision),
      isContingency:       data.contingencia,
    };
  }
}
