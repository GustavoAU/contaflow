// src/lib/countries/types.ts
// ADR-042 — Arquitectura multi-país: contratos de tipos.
//
// Este archivo NO contiene datos de ningún país. Cada país vive en su propia
// carpeta (`countries/ven/`, futuro `countries/col/`) y se registra en
// `countries/index.ts`. Agregar un país = agregar archivos, nunca tocar el core.
//
// R-5: todas las alícuotas son strings de precisión decimal — nunca float.

/**
 * Códigos de país soportados (ISO 3166-1 alpha-3).
 * Extender aquí + registrar en `countries/index.ts` al agregar un país.
 */
export type CountryCode = "VEN";

// ── Alícuotas ─────────────────────────────────────────────────────────────────

/**
 * Alícuotas impositivas del país, como fracciones decimales en string
 * ("0.16" = 16%). R-5: jamás number.
 *
 * Los campos con nombre venezolano (`igtf`) son opcionales precisamente porque
 * no todos los países tienen la figura — usar junto a `capabilities`.
 */
export type TaxRates = {
  /** IVA general (VEN: "0.16") */
  ivaGeneral: string;
  /** IVA reducido para rubros especiales (VEN: "0.08") */
  ivaReduced: string;
  /** IVA adicional de bienes suntuarios (VEN: "0.15") */
  ivaLuxury: string;
  /** Total combinado general + suntuario (VEN: "0.31") */
  ivaCombined: string;
  /** IGTF — Impuesto a Grandes Transacciones Financieras (VEN: "0.03") */
  igtf: string;
};

/**
 * Una alícuota tal como se presenta en la UI y se persiste en `InvoiceTaxLine`.
 *
 * - `rate`    fracción decimal para cálculo ("0.16")
 * - `percent` el mismo valor en puntos porcentuales, como se guarda en
 *             `InvoiceTaxLine.rate` y se muestra en formularios ("16")
 * - `label`   etiqueta de UI ya formada ("IVA General (16%)")
 */
export type TaxLineRateInfo = {
  rate: string;
  percent: string;
  label: string;
};

// ── Capacidades ───────────────────────────────────────────────────────────────

/**
 * Qué figuras fiscales existen en el país. Gobiernan la visibilidad de módulos
 * completos (nav, alertas del dashboard, guards suaves en actions) — ADR-042 D-5.
 *
 * Dimensión ORTOGONAL a los permisos por rol/grant de ADR-025: aquí se responde
 * "¿existe esta figura en el país?", allá "¿este usuario puede usarla?".
 */
export type FiscalCapabilities = {
  /** Impuesto a pagos en divisas (VEN: IGTF) */
  igtf: boolean;
  /** Ajuste por inflación fiscal (VEN: INPC / VEN-NIF 3) */
  inflationAdjustment: boolean;
  /** Retenciones de IVA por agente de retención (VEN: 75%/100%) */
  ivaRetention: boolean;
  /** Retenciones de impuesto sobre la renta (VEN: ISLR Decreto 1808) */
  islrRetention: boolean;
  /** Declaración periódica de IVA (VEN: Forma 30) */
  ivaDeclaration: boolean;
  /** Transmisión de documentos a la autoridad fiscal (VEN: SENIAT PA-121) */
  taxAuthorityReporting: boolean;
  /** Facturación electrónica vía proveedor autorizado (ADR-031) */
  digitalInvoice: boolean;
  /** Calendario de obligaciones con vencimiento por contribuyente */
  fiscalCalendar: boolean;
  /** Régimen de "contribuyente especial" con obligaciones diferenciadas */
  specialContributor: boolean;
  /** Validación en línea del ID tributario contra el padrón oficial */
  taxIdOnlineValidation: boolean;
  /**
   * Motor de nómina disponible para el país. `null` = el país no tiene motor
   * implementado y el módulo de nómina permanece oculto (ADR-042 D-9).
   */
  payrollEngine: "VEN" | null;
};

// ── Configuración fiscal ──────────────────────────────────────────────────────

/**
 * Configuración fiscal completa de un país.
 *
 * OJO: contiene `RegExp`, que NO cruza la frontera RSC → cliente. Para pasar
 * config a componentes cliente usar `toClientFiscalConfig()` (ADR-042 D-3).
 */
export type FiscalConfig = {
  countryCode: CountryCode;
  countryName: string;

  // ── Moneda y presentación ──
  /** Moneda funcional (ISO 4217) */
  currency: string;
  /** Símbolo/prefijo de moneda para display ("Bs.") */
  currencySymbol: string;
  /** Locale para Intl.NumberFormat / toLocaleDateString ("es-VE") */
  locale: string;
  /**
   * Zona horaria IANA del país ("America/Caracas").
   *
   * El servidor corre en UTC: sin esto, derivar "hoy" con `toISOString()` da el
   * día SIGUIENTE durante las últimas horas del día del usuario. Ver
   * `src/lib/today.ts`.
   */
  timezone: string;
  /** Convención contable: negativos entre paréntesis (VEN-NIF) en vez de guión */
  negativeParens: boolean;

  // ── Identificación tributaria ──
  /** Etiqueta del ID tributario en la UI ("RIF", "NIT") */
  taxIdLabel: string;
  /** Regex de validación del ID tributario */
  taxIdRegex: RegExp;
  /** Ejemplo para placeholders y mensajes de error */
  taxIdPlaceholder: string;

  // ── Documentos fiscales ──
  /** Nombre de la autoridad fiscal ("SENIAT", "DIAN") */
  taxAuthorityName: string;
  /** Regex del número de control de documentos fiscales, si el país lo exige */
  controlNumberRegex?: RegExp;
  /** Ejemplo del Nº de control para placeholders y mensajes ("00-00000001") */
  controlNumberPlaceholder?: string;

  // ── Impuestos ──
  taxRates: TaxRates;
  /**
   * Alícuotas de línea de factura. Las claves son valores del enum Prisma
   * `TaxLineType`; cada país declara solo las que usa.
   */
  taxLineRates: Record<string, TaxLineRateInfo>;
  /** Clave por defecto en `taxLineRates` al crear una línea nueva */
  defaultTaxLineType: string;
  /**
   * Alícuotas (en %) seleccionables como tasa de UN ítem en cotizaciones y
   * órdenes.
   *
   * NO se deriva de `taxLineRates` porque no todas las alícuotas existen por sí
   * solas: el IVA Adicional venezolano (15%) es un RECARGO que siempre acompaña
   * al General — nunca es la tasa de un ítem suelto. De ahí que en VEN esta
   * lista sea ["0", "8", "16"] y no incluya el 15.
   */
  itemTaxRatePercents: string[];

  capabilities: FiscalCapabilities;
};

/**
 * Proyección **serializable** de `FiscalConfig` para componentes cliente.
 *
 * Las `RegExp` viajan como string (`taxIdPattern`); el hook `useFiscalConfig`
 * las reconstruye. Todo lo demás son primitivos y objetos planos, así que el
 * objeto cruza la frontera RSC sin problemas.
 */
export type ClientFiscalConfig = {
  countryCode: CountryCode;
  countryName: string;
  currency: string;
  currencySymbol: string;
  locale: string;
  timezone: string;
  negativeParens: boolean;
  taxIdLabel: string;
  /** Fuente de `taxIdRegex` — reconstruir con `new RegExp(pattern, "i")` */
  taxIdPattern: string;
  taxIdPlaceholder: string;
  taxAuthorityName: string;
  /** Fuente de `controlNumberRegex`, si el país lo exige */
  controlNumberPattern?: string;
  taxRates: TaxRates;
  taxLineRates: Record<string, TaxLineRateInfo>;
  defaultTaxLineType: string;
  capabilities: FiscalCapabilities;
};

// ── Provider ──────────────────────────────────────────────────────────────────

/**
 * Encapsula el comportamiento fiscal de un país (validaciones y normalizaciones
 * que no son simple lectura de config).
 */
export interface FiscalProvider {
  readonly countryCode: CountryCode;
  readonly countryName: string;
  readonly currency: string;
  readonly taxIdLabel: string;

  /** Valida un identificador tributario (RIF, NIT, …) */
  validateTaxId(taxId: string): boolean;

  /** Normaliza un ID tributario a su forma canónica para display */
  formatTaxId(taxId: string): string;

  /** Valida el número de control de un documento fiscal */
  validateControlNumber?(controlNumber: string): boolean;

  getTaxRates(): TaxRates;
  getFiscalConfig(): FiscalConfig;
}
