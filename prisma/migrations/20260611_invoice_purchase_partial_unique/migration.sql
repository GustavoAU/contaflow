-- Migration: 20260611_invoice_purchase_partial_unique
-- Fix A3: reemplaza @@unique([companyId, invoiceNumber, type]) por índices parciales.
--
-- Problema: @@unique([companyId, invoiceNumber, type]) rechaza facturas de
-- proveedores DISTINTOS con el mismo número (e.g. Proveedor A y B ambos
-- emiten la factura "0001" al mismo cliente → P2002 en la segunda).
-- El número de factura solo es único por proveedor, no globalmente por empresa.
--
-- Solución: dos índices únicos parciales —
--   SALE:     unicidad por (companyId, invoiceNumber) → los documentos emitidos
--             por la empresa tienen un único correlativo interno.
--   PURCHASE: unicidad por (companyId, counterpartRif, invoiceNumber) → un
--             proveedor no puede emitir el mismo número dos veces a la misma
--             empresa, pero proveedores distintos sí pueden coincidir en número.

-- ─── Paso 1: Eliminar el índice único compuesto anterior ─────────────────────

DROP INDEX IF EXISTS "Invoice_companyId_invoiceNumber_type_key";

-- ─── Paso 2: Índice único parcial para documentos SALE ───────────────────────
-- Aplica a FACTURA, NOTA_CREDITO, NOTA_DEBITO de venta.
-- Los correlativos internos son únicos por empresa.

DROP INDEX IF EXISTS "Invoice_sale_invoiceNumber_unique";
CREATE UNIQUE INDEX "Invoice_sale_invoiceNumber_unique"
  ON "Invoice"("companyId", "invoiceNumber")
  WHERE type = 'SALE';

-- ─── Paso 3: Índice único parcial para documentos PURCHASE ───────────────────
-- La combinación (empresa, RIF proveedor, número) es la que determina unicidad.
-- Proveedores distintos pueden emitir el mismo número sin conflicto.

DROP INDEX IF EXISTS "Invoice_purchase_rif_invoiceNumber_unique";
CREATE UNIQUE INDEX "Invoice_purchase_rif_invoiceNumber_unique"
  ON "Invoice"("companyId", "counterpartRif", "invoiceNumber")
  WHERE type = 'PURCHASE';
