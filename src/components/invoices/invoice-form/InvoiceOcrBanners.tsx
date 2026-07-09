// src/components/invoices/invoice-form/InvoiceOcrBanners.tsx
// Presentacional — JSX movido MECÁNICAMENTE desde InvoiceForm.tsx (sin cambios).
"use client";

import { AlertTriangleIcon } from "lucide-react";

type Props = {
  ocrLoaded: boolean;
  ocrHasCriticalRisks: boolean;
  setOcrLoaded: React.Dispatch<React.SetStateAction<boolean>>;
};

export function InvoiceOcrBanners({ ocrLoaded, ocrHasCriticalRisks, setOcrLoaded }: Props) {
  return (
    <>
      {/* Banner OCR pre-fill — diferencia entre extracción limpia y con riesgos */}
      {ocrLoaded && !ocrHasCriticalRisks && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <span className="mt-0.5 text-blue-500">★</span>
          <div className="flex-1 text-sm">
            <p className="font-semibold text-blue-800">Datos prellenados desde OCR</p>
            <p className="text-blue-600">
              Revisa y corrige los campos antes de guardar — precisión ~95%
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOcrLoaded(false)}
            className="text-blue-400 hover:text-blue-600"
            aria-label="Cerrar aviso OCR"
          >
            ×
          </button>
        </div>
      )}
      {/* ALERTA 13/14/15: banner de alto riesgo cuando OCR detectó problemas en campos fiscales */}
      {ocrLoaded && ocrHasCriticalRisks && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          <AlertTriangleIcon className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" aria-hidden />
          <div className="flex-1">
            <p className="font-semibold text-amber-800">
              Datos OCR con campos fiscales en revisión
            </p>
            <p className="mt-0.5 text-amber-700">
              El RIF o N° de Control extraídos podrían contener errores de lectura.
              Verifica <strong>ambos campos</strong> contra la factura física antes de guardar.
              Un RIF incorrecto invalida el crédito fiscal (PA-00071 Art. 15).
            </p>
          </div>
        </div>
      )}
    </>
  );
}
