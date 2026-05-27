// src/lib/digital-invoice/index.ts
export type {
  DigitalInvoiceProvider,
  DigitalInvoiceSubmission,
  DigitalInvoiceLine,
  DigitalInvoiceResult,
  DigitalVoidResult,
} from "./provider.types";

export {
  DigitalInvoiceProviderError,
  DigitalInvoiceTimeoutError,
} from "./provider.types";

export {
  createDigitalInvoiceProvider,
  createMockProvider,
  createNullProvider,
} from "./DigitalInvoiceFactory";
