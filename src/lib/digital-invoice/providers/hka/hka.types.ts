// src/lib/digital-invoice/providers/hka/hka.types.ts
// Tipos de la API de The Factory HKA.
// STUB — se actualizará cuando recibamos la documentación oficial de HKA.
// Los nombres de campos son estimados basados en estándares LATAM de facturación electrónica.

// ─── Request ─────────────────────────────────────────────────────────────────

export interface HKAInvoiceRequest {
  // Estos campos son estimados — confirmar con documentación oficial de HKA
  rif_emisor:      string;
  nombre_emisor:   string;
  rif_receptor:    string;
  nombre_receptor: string;
  fecha:           string; // YYYY-MM-DD
  tipo_documento:  "01" | "02" | "03"; // 01=Factura, 02=ND, 03=NC
  lineas: Array<{
    descripcion:  string;
    cantidad:     string;
    precio_unit:  string;
    tasa_iva:     string;
    monto_total:  string;
  }>;
  subtotal:        string;
  monto_iva:       string;
  total:           string;
  moneda:          string;
  tasa_cambio?:    string;
  numero_control_relacionado?: string; // para NC/ND
}

// ─── Response ────────────────────────────────────────────────────────────────

export interface HKAInvoiceResponse {
  // Estos campos son estimados — confirmar con documentación oficial de HKA
  codigo_respuesta:  string; // "00" = éxito
  mensaje:           string;
  numero_control:    string;
  qr_url:            string;
  id_transaccion:    string;
  fecha_emision:     string;
  contingencia:      boolean;
}

export interface HKAVoidResponse {
  codigo_respuesta: string;
  mensaje:          string;
  fecha_anulacion:  string;
}

export interface HKAHealthResponse {
  status: "OK" | "DEGRADED" | "DOWN";
}

// ─── Errores ─────────────────────────────────────────────────────────────────

export const HKA_ERROR_CODES = {
  "00": "success",
  "01": "invalid_rif",
  "02": "duplicate_invoice",
  "99": "internal_error",
} as const;
