// src/components/invoices/InvoiceForm.tsx
"use client";

import { useState, useTransition, useId, useRef, useEffect, useCallback } from "react";
import { useFormDraft, DRAFT_AUTO_SAVE_MS } from "@/hooks/useFormDraft";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Decimal } from "decimal.js";
import {
  createInvoiceAction,
  createCreditNoteAction,
  createDebitNoteAction,
} from "@/modules/invoices/actions/invoice.actions";
import { getLatestRateAction } from "@/modules/exchange-rates/actions/exchange-rate.actions";
import { IGTFService, IGTF_RATE } from "@/modules/igtf/services/IGTFService";
import { type ExtractedInvoice } from "@/modules/ocr/schemas/invoice.schema";
import { OCR_SESSION_KEY } from "@/components/ocr/InvoiceUploader";
import type { TaxLine, TaxLineType, InvoiceDraft } from "./invoice-form/types";
import { calcAmount, sumTaxLines, updateTaxLineState, validateTaxLinesBeforeSubmit } from "./invoice-form/helpers";
import { InvoiceOcrBanners } from "./invoice-form/InvoiceOcrBanners";
import { InvoiceHeaderFields } from "./invoice-form/InvoiceHeaderFields";
import { InvoiceTaxLinesSection } from "./invoice-form/InvoiceTaxLinesSection";
import { InvoiceRetentionsIgtfSection } from "./invoice-form/InvoiceRetentionsIgtfSection";
import { InvoiceTotalsPanel } from "./invoice-form/InvoiceTotalsPanel";
import { InvoiceFormDialogs } from "./invoice-form/InvoiceFormDialogs";

// Duplicate pre-fill key — set by InvoiceBook "Dup" button, read once on mount
export const DUPLICATE_SESSION_KEY = "cf-invoice-dup";
type DuplicateData = {
  type: "SALE" | "PURCHASE";
  currency: "VES" | "USD" | "EUR";
  docType: string;
  taxCategory: string;
  counterpartName: string;
  counterpartRif: string;
  taxLines: Array<{ taxType: string; base: string; rate: string; amount: string }>;
};

type Props = {
  companyId: string;
  userId: string;
  periodId?: string;
  isSpecialContributor: boolean;
  defaultType?: "SALE" | "PURCHASE";
};

export function InvoiceForm({
  companyId,
  userId,
  periodId,
  isSpecialContributor,
  defaultType = "PURCHASE",
}: Props) {
  const baseId = useId();
  const newLineId = () => `${baseId}-${crypto.randomUUID()}`;

  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<"SALE" | "PURCHASE">(defaultType);
  const [currency, setCurrency] = useState<"VES" | "USD" | "EUR">("VES");
  const [docType, setDocType] = useState("FACTURA");
  const [taxCategory, setTaxCategory] = useState("GRAVADA");
  const prevCategoryRef = useRef<string>("GRAVADA");
  const [showAlert, setShowAlert] = useState(false);
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);
  const [taxLines, setTaxLines] = useState<TaxLine[]>([
    {
      id: newLineId(),
      taxType: "IVA_GENERAL",
      description: "",
      base: "",
      rate: "16",
      amount: "0.00",
      luxuryGroupId: null,
    },
  ]);
  const [paidInForeign, setPaidInForeign] = useState(false);
  const [igtfBase, setIgtfBase] = useState("");
  const [bcvRate, setBcvRate] = useState<{ rate: string; date: string } | null>(null);
  const [bcvLoading, setBcvLoading] = useState(false);
  const [counterpartName, setCounterpartName] = useState("");
  const counterpartNameRef = useRef<HTMLInputElement>(null);
  const [counterpartAddress, setCounterpartAddress] = useState("");
  const [counterpartIsSpecialContributor, setCounterpartIsSpecialContributor] = useState(false);
  const [relatedInvoiceId, setRelatedInvoiceId] = useState("");

  // ─── Autosave borrador (Q1-3) ────────────────────────────────────────────────
  const { draft, saveDraft, clearDraft } = useFormDraft<InvoiceDraft>(`invoice-new-${companyId}`);
  const [showDraftAlert, setShowDraftAlert] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detectar borrador al montar (solo si no hay datos OCR)
  useEffect(() => {
    if (draft) setShowDraftAlert(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // solo en montaje

  // Autosave cada 30s cuando cambian los campos clave
  const triggerAutoSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveDraft({ type, currency, docType, taxCategory, counterpartName, taxLines });
    }, DRAFT_AUTO_SAVE_MS);
  }, [type, currency, docType, taxCategory, counterpartName, taxLines, saveDraft]);

  useEffect(() => {
    triggerAutoSave();
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [triggerAutoSave]);

  function restoreDraft() {
    if (!draft) return;
    setType(draft.state.type);
    setCurrency(draft.state.currency);
    setDocType(draft.state.docType);
    setTaxCategory(draft.state.taxCategory);
    prevCategoryRef.current = draft.state.taxCategory;
    setCounterpartName(draft.state.counterpartName);
    setTaxLines(draft.state.taxLines);
    setShowDraftAlert(false);
  }

  // ─── OCR pre-fill ────────────────────────────────────────────────────────────
  const [ocrLoaded, setOcrLoaded] = useState(false);
  const [ocrHasCriticalRisks, setOcrHasCriticalRisks] = useState(false);
  const [ocrCounterpartRif, setOcrCounterpartRif] = useState("");
  const [ocrRifKey, setOcrRifKey] = useState(0);
  const invoiceNumberRef = useRef<HTMLInputElement>(null);
  const controlNumberRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  // ─── Leer datos OCR de sessionStorage (una sola vez al montar) ───────────────
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(OCR_SESSION_KEY);
      if (!raw) return;
      sessionStorage.removeItem(OCR_SESSION_KEY);
      const ocr = JSON.parse(raw) as ExtractedInvoice;

      // Inputs uncontrolled → usar refs
      if (ocr.numeroFactura && invoiceNumberRef.current)
        invoiceNumberRef.current.value = ocr.numeroFactura;
      if (ocr.numeroControl && controlNumberRef.current)
        controlNumberRef.current.value = ocr.numeroControl;
      if (ocr.fechaEmision && dateRef.current)
        dateRef.current.value = ocr.fechaEmision;

      // State-controlled fields
      if (ocr.razonSocial) setCounterpartName(ocr.razonSocial);
      if (ocr.rif) {
        setOcrCounterpartRif(ocr.rif);
        setOcrRifKey((k) => k + 1);
      }
      if (ocr.currency) setCurrency(ocr.currency);

      // Pre-fill base imponible IVA General si está disponible
      if (ocr.baseImponibleGeneral) {
        const base = ocr.baseImponibleGeneral;
        setTaxLines([
          {
            id: `ocr-${crypto.randomUUID()}`,
            taxType: "IVA_GENERAL",
            description: "",
            base,
            rate: "16",
            amount: calcAmount(base, "16"),
            luxuryGroupId: null,
          },
        ]);
      }

      // ALERTA 13/14/15: señalar si campos fiscales críticos tienen posibles errores
      const hasCritical = (ocr._fieldRisks ?? []).some(r => r.severity === "critical");
      setOcrHasCriticalRisks(hasCritical);
      setOcrLoaded(true);
    } catch {
      // sessionStorage no disponible o JSON inválido — continuar sin pre-fill
    }
  }, []);

  // ─── Duplicate pre-fill (InvoiceBook "Dup" button) ───────────────────────────
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DUPLICATE_SESSION_KEY);
      if (!raw) return;
      sessionStorage.removeItem(DUPLICATE_SESSION_KEY);
      const dup = JSON.parse(raw) as DuplicateData;

      if (dup.type) setType(dup.type);
      if (dup.currency) setCurrency(dup.currency);
      if (dup.docType) setDocType(dup.docType);
      if (dup.taxCategory) {
        setTaxCategory(dup.taxCategory);
        prevCategoryRef.current = dup.taxCategory;
      }
      if (dup.counterpartName) setCounterpartName(dup.counterpartName);
      if (dup.counterpartRif) {
        setOcrCounterpartRif(dup.counterpartRif);
        setOcrRifKey((k) => k + 1);
      }
      if (dup.taxLines?.length > 0) {
        setTaxLines(
          dup.taxLines.map((tl) => ({
            id: `dup-${crypto.randomUUID()}`,
            taxType: tl.taxType as TaxLineType,
            description: "",
            base: tl.base,
            rate: tl.rate,
            amount: tl.amount,
            luxuryGroupId: null,
          })),
        );
      }
    } catch {
      // sessionStorage no disponible o JSON inválido — continuar sin pre-fill
    }
  }, []);

  useEffect(() => {
    if (currency === "VES") return;
    void (async () => {
      setBcvRate(null);
      setBcvLoading(true);
      try {
        const res = await getLatestRateAction(companyId, currency as "USD" | "EUR");
        if (res.success && res.data) {
          setBcvRate({ rate: res.data.rate, date: res.data.date instanceof Date ? res.data.date.toISOString().split("T")[0] : String(res.data.date).split("T")[0] });
        } else {
          setBcvRate(null);
        }
      } finally {
        setBcvLoading(false);
      }
    })();
  }, [currency, companyId]);

  const isReporteZ = docType === "REPORTE_Z";

  // ─── IGTF automático ─────────────────────────────────────────────────────────
  // H-003: aplica en SALE y PURCHASE — contribuyente especial pagando en VES también
  const igtfApplies =
    IGTFService.applies(paidInForeign ? "USD" : "VES", isSpecialContributor);
  const igtfCalculation =
    igtfApplies && igtfBase && !new Decimal(igtfBase || "0").isZero()
      ? IGTFService.calculate(igtfBase, IGTF_RATE)
      : null;

  // ─── Manejo de taxLines ──────────────────────────────────────────────────────
  function addTaxLine() {
    setTaxLines((prev) => [
      ...prev,
      {
        id: newLineId(),
        taxType: "IVA_GENERAL",
        description: "",
        base: "",
        rate: "16",
        amount: "0.00",
        luxuryGroupId: null,
      },
    ]);
  }

  function removeTaxLine(id: string) {
    setTaxLines((prev) => {
      const line = prev.find((l) => l.id === id);
      // Si elimina una línea vinculada, eliminar también su hermana
      if (line?.luxuryGroupId) {
        return prev.filter((l) => l.luxuryGroupId !== line.luxuryGroupId);
      }
      return prev.filter((l) => l.id !== id);
    });
  }

  // ─── updateTaxLine unificado ──────────────────────────────────────────────────
  function updateTaxLine(id: string, field: keyof TaxLine, value: string) {
    setTaxLines((prev) => updateTaxLineState(prev, id, field, value));
  }

  // ─── Verificar si línea IVA_ADICIONAL tiene su hermana IVA_GENERAL ──────────
  function hasAdditionalWithoutGeneral(): boolean {
    const hasAdicional = taxLines.some((l) => l.taxType === "IVA_ADICIONAL");
    const hasGeneral = taxLines.some((l) => l.taxType === "IVA_GENERAL");
    return hasAdicional && !hasGeneral;
  }

  // ─── Submit ──────────────────────────────────────────────────────────────────
  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();

    const validationError = validateTaxLinesBeforeSubmit(taxLines, taxCategory);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const form = e.currentTarget;
    const data = new FormData(form);

    startTransition(async () => {
      const basePayload = {
        companyId,
        createdBy: userId,
        periodId,
        type,
        docType,
        taxCategory,
        invoiceNumber: data.get("invoiceNumber"),
        controlNumber: data.get("controlNumber") || undefined,
        relatedDocNumber: data.get("relatedDocNumber") || undefined,
        importFormNumber: data.get("importFormNumber") || undefined,
        reportZStart: isReporteZ ? data.get("reportZStart") || undefined : undefined,
        reportZEnd: isReporteZ ? data.get("reportZEnd") || undefined : undefined,
        date: data.get("date"),
        counterpartName: data.get("counterpartName"),
        counterpartRif: data.get("counterpartRif"),
        counterpartAddress: (data.get("counterpartAddress") as string) || undefined,
        taxLines: taxLines
          .filter((l) => l.base && !new Decimal(l.base || "0").isZero())
          .map((l) => ({
            taxType: l.taxType,
            description: l.description || undefined,
            base: l.base,
            rate: l.rate,
            amount: l.amount,
          })),
        ivaRetentionAmount: data.get("ivaRetentionAmount") || "0",
        ivaRetentionVoucher: data.get("ivaRetentionVoucher") || undefined,
        ivaRetentionDate: data.get("ivaRetentionDate") || undefined,
        islrRetentionAmount: data.get("islrRetentionAmount") || "0",
        igtfBase: igtfCalculation ? igtfCalculation.amount : "0",
        igtfAmount: igtfCalculation ? igtfCalculation.igtfAmount : "0",
        currency,
      };

      let result: { success: boolean; error?: string; stockWarnings?: Array<{ itemId: string; name: string; available: string; requested: string }>; insufficient?: Array<{ itemId: string; name: string; available: string; requested: string }> };
      if (docType === "NOTA_CREDITO") {
        result = await createCreditNoteAction({ ...basePayload, relatedInvoiceId });
      } else if (docType === "NOTA_DEBITO") {
        result = await createDebitNoteAction({ ...basePayload, relatedInvoiceId });
      } else {
        result = await createInvoiceAction(basePayload);
      }

      if (result.success) {
        clearDraft(); // borrador ya no necesario tras envío exitoso
        if (result.stockWarnings && result.stockWarnings.length > 0) {
          const names = result.stockWarnings.map((w) => w.name).join(", ");
          toast.warning(`Factura registrada. Stock insuficiente para: ${names}. El inventario quedará en negativo.`);
        } else {
          toast.success("Factura registrada correctamente");
        }
        form.reset();
        setTaxLines([
          {
            id: newLineId(),
            taxType: "IVA_GENERAL",
            description: "",
            base: "",
            rate: "16",
            amount: "0.00",
            luxuryGroupId: null,
          },
        ]);
        setTaxCategory("GRAVADA");
        prevCategoryRef.current = "GRAVADA";
        setDocType("FACTURA");
        setPaidInForeign(false);
        setIgtfBase("");
        setCurrency("VES");
        setCounterpartName("");
        setRelatedInvoiceId("");
        setOcrLoaded(false);
        setOcrCounterpartRif("");
      } else {
        toast.error(result.error);
      }
    });
  }

  const totalIva = sumTaxLines(taxLines);

  // ─── Subtotal y total general ────────────────────────────────────────────────
  const subtotal = taxLines
    .reduce((acc, l) => {
      try { return acc.plus(new Decimal(l.base || "0")); } catch { return acc; }
    }, new Decimal(0))
    .toFixed(2);

  // ─── Auto-actualizar Base IGTF cuando cambian las líneas de impuesto ─────────
  useEffect(() => {
    if (!paidInForeign) return;
    try {
      setIgtfBase(new Decimal(subtotal).plus(new Decimal(totalIva)).toFixed(2));
    } catch { /* taxLines vacíos — ignorar */ }
  }, [paidInForeign, subtotal, totalIva]);

  const totalAmount = new Decimal(subtotal)
    .plus(new Decimal(totalIva))
    .plus(new Decimal(igtfCalculation?.igtfAmount ?? "0"))
    .toFixed(2);

  return (
    <>
      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 font-semibold">Registrar Factura</h2>

        <InvoiceOcrBanners
          ocrLoaded={ocrLoaded}
          ocrHasCriticalRisks={ocrHasCriticalRisks}
          setOcrLoaded={setOcrLoaded}
        />

        {/* Selector Compra / Venta */}
        <div className="mb-6 flex rounded-lg border p-1">
          {(["PURCHASE", "SALE"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
                type === t ? "bg-blue-600 text-white" : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {t === "PURCHASE" ? "Compra" : "Venta"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <InvoiceHeaderFields
            companyId={companyId}
            type={type}
            docType={docType}
            setDocType={setDocType}
            taxCategory={taxCategory}
            setTaxCategory={setTaxCategory}
            setPendingCategory={setPendingCategory}
            setShowAlert={setShowAlert}
            prevCategoryRef={prevCategoryRef}
            isReporteZ={isReporteZ}
            currency={currency}
            setCurrency={setCurrency}
            counterpartName={counterpartName}
            setCounterpartName={setCounterpartName}
            counterpartNameRef={counterpartNameRef}
            counterpartAddress={counterpartAddress}
            setCounterpartAddress={setCounterpartAddress}
            counterpartIsSpecialContributor={counterpartIsSpecialContributor}
            setCounterpartIsSpecialContributor={setCounterpartIsSpecialContributor}
            relatedInvoiceId={relatedInvoiceId}
            setRelatedInvoiceId={setRelatedInvoiceId}
            invoiceNumberRef={invoiceNumberRef}
            controlNumberRef={controlNumberRef}
            dateRef={dateRef}
            ocrRifKey={ocrRifKey}
            ocrCounterpartRif={ocrCounterpartRif}
          />

          <InvoiceTaxLinesSection
            taxLines={taxLines}
            taxCategory={taxCategory}
            currency={currency}
            totalIva={totalIva}
            bcvLoading={bcvLoading}
            bcvRate={bcvRate}
            addTaxLine={addTaxLine}
            removeTaxLine={removeTaxLine}
            updateTaxLine={updateTaxLine}
            hasAdditionalWithoutGeneral={hasAdditionalWithoutGeneral}
          />

          <InvoiceRetentionsIgtfSection
            type={type}
            paidInForeign={paidInForeign}
            setPaidInForeign={setPaidInForeign}
            igtfApplies={igtfApplies}
            igtfBase={igtfBase}
            setIgtfBase={setIgtfBase}
            igtfCalculation={igtfCalculation}
          />

          <InvoiceTotalsPanel
            subtotal={subtotal}
            totalIva={totalIva}
            totalAmount={totalAmount}
            currency={currency}
            igtfCalculation={igtfCalculation}
          />

          {/* Q3-6: aria-keyshortcuts documenta Ctrl+S / Ctrl+Enter para usuarios de teclado */}
          <Button
            type="submit"
            disabled={isPending}
            aria-busy={isPending}
            aria-keyshortcuts="Control+s Control+Enter"
            className="w-full"
          >
            {isPending && <Loader2Icon className="animate-spin" />}
            {isPending ? "Guardando..." : "Registrar Factura"}
          </Button>
        </form>
      </div>

      <Toaster richColors position="top-right" />

      <InvoiceFormDialogs
        showDraftAlert={showDraftAlert}
        setShowDraftAlert={setShowDraftAlert}
        draft={draft}
        ocrLoaded={ocrLoaded}
        clearDraft={clearDraft}
        restoreDraft={restoreDraft}
        showAlert={showAlert}
        setShowAlert={setShowAlert}
        pendingCategory={pendingCategory}
        setPendingCategory={setPendingCategory}
        setTaxCategory={setTaxCategory}
        setTaxLines={setTaxLines}
        prevCategoryRef={prevCategoryRef}
        newLineId={newLineId}
      />
    </>
  );
}
