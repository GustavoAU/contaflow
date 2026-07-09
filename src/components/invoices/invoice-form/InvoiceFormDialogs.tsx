// src/components/invoices/invoice-form/InvoiceFormDialogs.tsx
// Presentacional — JSX movido MECÁNICAMENTE desde InvoiceForm.tsx (sin cambios).
// Estado y handlers viven en el contenedor; aquí solo llegan por props.
"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { DraftEntry } from "@/hooks/useFormDraft";
import { TAX_CATEGORIES } from "./helpers";
import type { InvoiceDraft, TaxLine } from "./types";

type Props = {
  showDraftAlert: boolean;
  setShowDraftAlert: (value: boolean) => void;
  draft: DraftEntry<InvoiceDraft> | null;
  ocrLoaded: boolean;
  clearDraft: () => void;
  restoreDraft: () => void;
  showAlert: boolean;
  setShowAlert: (value: boolean) => void;
  pendingCategory: string | null;
  setPendingCategory: (value: string | null) => void;
  setTaxCategory: (value: string) => void;
  setTaxLines: React.Dispatch<React.SetStateAction<TaxLine[]>>;
  prevCategoryRef: React.RefObject<string>;
  newLineId: () => string;
};

export function InvoiceFormDialogs({
  showDraftAlert,
  setShowDraftAlert,
  draft,
  ocrLoaded,
  clearDraft,
  restoreDraft,
  showAlert,
  setShowAlert,
  pendingCategory,
  setPendingCategory,
  setTaxCategory,
  setTaxLines,
  prevCategoryRef,
  newLineId,
}: Props) {
  return (
    <>
      {/* AlertDialog — restaurar borrador guardado automáticamente */}
      <AlertDialog open={showDraftAlert && !!draft && !ocrLoaded} onOpenChange={setShowDraftAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Restaurar borrador?</AlertDialogTitle>
            <AlertDialogDescription>
              Hay un borrador guardado{" "}
              {draft
                ? `el ${new Date(draft.savedAt).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" })}`
                : ""}
              {" "}con líneas de impuesto y datos de la contraparte. ¿Deseas continuar donde lo dejaste?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setShowDraftAlert(false); clearDraft(); }}>
              Descartar
            </AlertDialogCancel>
            <AlertDialogAction onClick={restoreDraft}>
              Restaurar borrador
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog — confirmación cascada al cambiar a categoría sin IVA */}
      <AlertDialog open={showAlert} onOpenChange={setShowAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cambiar categoría fiscal?</AlertDialogTitle>
            <AlertDialogDescription>
              Al cambiar a{" "}
              <strong>
                {TAX_CATEGORIES.find((c) => c.value === pendingCategory)?.label ?? pendingCategory}
              </strong>
              , todas las líneas de impuesto se reiniciarán a una sola línea{" "}
              <strong>Exento / Exonerado</strong>. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setShowAlert(false);
                setPendingCategory(null);
                // El select revierte solo porque taxCategory no se actualizó
              }}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingCategory) {
                  setTaxCategory(pendingCategory);
                  setTaxLines([
                    {
                      id: newLineId(),
                      taxType: "EXENTO",
                      description: "",
                      base: "",
                      rate: "0",
                      amount: "0.00",
                      luxuryGroupId: null,
                    },
                  ]);
                  prevCategoryRef.current = pendingCategory;
                }
                setShowAlert(false);
                setPendingCategory(null);
              }}
            >
              Confirmar cambio
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
