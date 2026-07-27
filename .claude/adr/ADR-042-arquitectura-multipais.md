# ADR-042 — Arquitectura Multi-País (VEN primer provider, COL futuro)

**Fecha:** 2026-07-26
**Estado:** Aceptado
**Contexto previo:** Q3-5 (tax-config + fiscal-provider), ADR-031 (DigitalInvoiceProvider), ADR-041 (action guard central)

---

## Contexto

Auditoría 2026-07-26: el esqueleto multi-país Q3-5 existe pero está desconectado —
`getFiscalConfig`/`FiscalProviderFactory` no tienen ni un caller de producción; toda la
app consume los alias `VEN_*` o literales duplicados (`"0.16"`, `IGTF_RATE = 3`,
regex RIF inline). `Company.country` existe en BD (default `"VEN"`) pero nadie lo lee
ni lo escribe. Con un contrato Colombia en el horizonte, cada semana de features nuevas
agranda el acoplamiento.

**Objetivo:** core país-agnóstico con Venezuela como primer provider completo.
Agregar Colombia = agregar archivos (`countries/col/` + módulos + valores de enum),
nunca re-cablear el core. Venezuela se comporta EXACTAMENTE igual post-refactor.

**Alcance:** NO se implementa lógica colombiana (YAGNI — sin contrato firmado). Plan de
ejecución por fases MP-0..MP-13 (ver plan aprobado 2026-07-26; resumen en Consecuencias).

---

## Decisiones

### D-1 — Schema factories Zod (módulos país-neutrales)

Los schemas Zod son consts module-level: la regex se resuelve en import time, antes de
que exista un `country`. Patrón adoptado:

```ts
// invoice.schema.ts
const buildCreateInvoiceSchema = (cfg: FiscalConfig) => z.object({
  counterpartRif: zTaxId(cfg),          // helper en zod-helpers.ts
  ...
});

export const getInvoiceSchemas = memoizePerCountry((cfg) => ({
  create: buildCreateInvoiceSchema(cfg),
}));

// Compat permanente: ancla de tipos + call-sites VEN-only
export const CreateInvoiceSchema = getInvoiceSchemas(VEN_FISCAL_CONFIG).create;
export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>;
```

- **Contrato de invarianza estructural:** las factories solo varían VALORES (regex,
  tasas, mensajes de error), nunca ESTRUCTURA. `z.infer` es país-invariante →
  components y tests que importan los tipos no se tocan.
- El action resuelve el schema DESPUÉS del guard: `getXSchemas(getFiscalConfig(ctx.country))`.
- `memoizePerCountry` = Map por `countryCode`; construcción one-time por proceso.
- **Solo módulos país-neutrales se convierten** (invoices, vendors/customers, orders,
  expenses, payments, cajachica). Los módulos 100 % VEN (retentions, igtf,
  iva-declaration, despacho, inflation, seniat-*) NO se convierten: se apagan enteros
  por capability flag (D-5) y quedan en la whitelist PERMANENT del ratchet (D-11).

### D-2 — El guard devuelve `country`

`requireCompanyAction` añade `company: { select: { country: true } }` al
`companyMember.findFirst` existente (mismo query, cero roundtrips extra) y expone
`ctx.country: CountryCode`.

Fallback `member.company?.country ?? "VEN"` — SOLO para mocks legacy de tests que
devuelven `{ role }` sin `company`. En BD la columna es NOT NULL DEFAULT 'VEN'. Es el
**único fallback silencioso que sobrevive** en toda la arquitectura; tests nuevos deben
mockear `company: { country: "VEN" }`. Añadir datos al contexto no relaja ningún guard
(invariante ADR-041).

### D-3 — Config fiscal en client components: React Context

`FiscalUIProvider` montado en el layout de company + hook `useFiscalConfig()`.

- **Por qué context y no prop drilling:** 10+ consumidores profundos que cruzan módulos
  (RifInput dentro de forms dentro de dialogs). El nav sí usa prop drilling de `country`
  (server-side, mismo camino que `scopeProfile`).
- El valor del provider es `ClientFiscalConfig` — proyección **serializable** de
  `FiscalConfig` (RegExp NO cruza la frontera RSC): patterns como string, el hook las
  reconstruye con `useMemo(() => new RegExp(pattern, "i"))`.
- **Fallback del hook sin provider = VEN** (portales `/employee/[token]`,
  `/client-portal/[token]` y tests jsdom existentes — superficies VEN-only hoy).
- Importar consts VEN directamente en un client component de un módulo VEN-only sigue
  siendo legal (es bundle, no props RSC).

### D-4 — Tabla canónica de alícuotas para UI

`FiscalConfig.taxLineRates: Record<string, { rate; percent; label }>` (claves = valores
del enum Prisma `TaxLineType` que el país usa) + `defaultTaxLineType`. De ahí DERIVAN:
`CANONICAL_TAX_RATES` (invoice.schema), los dos rateMaps de `invoice-form/helpers.ts`,
los literales `rate:"16"` de InvoiceForm y los labels "(16%)". `taxRates.ivaCombined`
("0.31") y la relación `luxuryGroupId` (Z-2) quedan intactos.

### D-5 — Capability flags por país

```ts
capabilities: {
  igtf: boolean; inflationAdjustment: boolean; ivaRetention: boolean;
  islrRetention: boolean; ivaDeclaration: boolean; taxAuthorityReporting: boolean;
  digitalInvoice: boolean; fiscalCalendar: boolean; specialContributor: boolean;
  taxIdOnlineValidation: boolean; payrollEngine: "VEN" | null;
}
```

VEN = todo `true` + `payrollEngine: "VEN"` → **el filtro es identidad para VEN** (test
explícito). Consumo:

1. **Nav:** decorador post-build `applyCountryFilter(config, capabilities)` (mismo
   patrón que `applyProfileLocks`) que **ELIMINA** ítems (no `locked` — "no aplica en
   tu país" no es un upsell). Mapa `CAPABILITY_NAV_PATHS`. Grupo
   `Fiscal / ${cfg.taxAuthorityName}`. `buildSeniatAuditNav` gated por
   `taxAuthorityReporting`.
2. **PendingTasksService:** `country` en el select de company (junto a
   `isSpecialContributor`); gatea `RETENCIONES_*`, `IGTF_*`, `NOM_*`, declaración IVA,
   calendario.
3. **Widgets dashboard:** gating server-side en la page.
4. **Actions VEN-only:** `requireCapability(country, cap)` como guard suave DESPUÉS de
   `requireCompanyAction` (defensa en profundidad).

Ortogonal a `MODULE_KEYS`/grants (ADR-025 — dimensión funcional/permisos): no se mezclan.

### D-6 — IGTF: fuente única

Queda `taxRates.igtf = "0.03"` (string decimal, R-5). `IGTF_RATE` (IGTFService.ts) pasa
a derivado `new Decimal(cfg.taxRates.igtf).mul(100).toNumber()` — mismo valor 3, el
export se mantiene. El literal `"VES"` de `IGTFService.applies` → `cfg.currency`.
**Golden test de equivalencia old/new obligatorio ANTES de tocar** (Z-2).

### D-7 — Retenciones: tabla única en `countries/ven/retentions.ts`

Las tablas grandes NO van dentro de `FiscalConfig` (bloat; no deben viajar al client
via context). `VEN_ISLR_TABLE` fusiona `ISLR_RATES` (retention.schema) y el `MAP` de
`islr-suggestions.ts` — ambos pasan a ser vistas derivadas, con test de consistencia
que congela los valores actuales entrada por entrada. `VEN_IVA_RETENTION_RATES =
["75","100"]` deriva el enum del schema, los defaults y las options del form.
`RetentionService` borra sus 6 métodos duplicados y delega en `RetentionCalculator`.

### D-8 — Estructura de archivos

```
src/lib/countries/
  index.ts   // registry + getFiscalConfig/getTaxRates ESTRICTOS + toClientFiscalConfig + memoizePerCountry + requireCapability
  types.ts   // CountryCode, FiscalConfig, TaxRates, Capabilities, ClientFiscalConfig
  ven/
    config.ts / provider.ts / retentions.ts / fiscal-calendar.ts / payroll-defaults.ts
```

`src/lib/tax-config.ts` y `src/lib/fiscal-provider.ts` quedan como **re-exports finos**
(los 32 importadores actuales no se rompen; el ratchet decide quién puede seguir).
**Cambio de comportamiento intencional:** `getFiscalConfig` y
`FiscalProviderFactory.forCountry` LANZAN en país desconocido (hoy hacen fallback
silencioso a VEN; no tienen callers de producción, es seguro). COL será carpeta hermana
`countries/col/`.

### D-9 — Nómina: seam mínimo, NO interfaz PayrollEngine

El motor son ~10 services con reglas LOTTT; una interfaz hoy sería gigante (especulativa)
o anémica (inútil). La cadena `LegalThreshold (BD) → PayrollConfig → constantes
fallback` ya es per-company. Seam adoptado:

1. Capability `payrollEngine: "VEN" | null` gatea nav/pages/actions de nómina completos.
2. Constantes fallback de `PayrollCalculatorService:19-41` (tasas parafiscales, CAP
   5×/10×, HE 1.5×/1.75×, DAYS_MONTH/HOURS_DAY) → `countries/ven/payroll-defaults.ts`
   (mismo valor, import swap).
3. `LegalThresholdType` (nombres IVSS_*/FAOV_*) y `SYSTEM_CONCEPTS` (tasa embebida en
   el nombre) NO se tocan — perfil VEN documentado. La facade `PayrollEngineFactory`
   se evalúa cuando exista motor COL.

### D-10 — Formateo: `formatMoney` + wrappers

Core nuevo `src/lib/money-format.ts`:
`formatMoney(value, { locale, decimals, negativeParens, symbol, currency, emptyFallback })`.
`FiscalConfig` gana `locale` ("es-VE"), `currencySymbol` ("Bs."), `negativeParens`
(convención VEN-NIF). `fmt-ven.ts` y `format.ts` se reescriben como wrappers finos —
los 15+26 call-sites NO se migran; quirks preservados (`fmtVen(null)→"—"`,
`formatAmount(NaN)→"0,00"`). **Golden tests (~30 casos) capturados ANTES de convertir.**

### D-11 — Ratchet de arquitectura (temprano)

`src/__tests__/architecture/country-coupling.test.ts` (molde: audit-log-integrity):

- Regla 1: referencia a `VEN_RIF_REGEX|VEN_TAX_RATES|VEN_CONTROL_NUMBER_REGEX|VEN_FISCAL_CONFIG|validateVenezuelanRif` fuera de whitelist.
- Regla 2: literales `"0.16"|"0.08"|"0.31"|"0.15"|"0.03"` fuera de whitelist.
- Whitelist en dos secciones: **PERMANENT** (countries/ven/**, re-exports compat,
  módulos VEN-only) y **TEMPORAL** (cada entrada comentada `// MP-X la elimina`).
- **Anti-stale:** el test también FALLA si una entrada whitelisted ya no tiene
  violaciones → cada fase está obligada a encoger la lista al mergear.

### D-12 — No-hacer (explícito)

- NO renombrar modelos/enums Prisma existentes (`SeniatSubmission`,
  `LegalThresholdType`, `UserRole.SENIAT`, …). Colombia agrega los suyos
  (`DianSubmission`, valores nuevos de `TaxLineType`/`Currency`) — conviven.
- NO tocar el comportamiento de Z-1..Z-5: solo sustitución mecánica constante→lookup
  con el MISMO valor.
- NO i18n general (ambos países hablan español) — solo terminología fiscal via config
  (`taxIdLabel`, `taxAuthorityName`, labels de alícuotas).
- `MAX_INVOICE_AMOUNT` es país-neutral — se queda en `fiscal-validators.ts`.
- Enum Prisma `Currency`: `COP` se agrega en la etapa COL con
  `ALTER TYPE "Currency" ADD VALUE 'COP'` (SQL listo-para-aplicar; Neon en 402 hasta
  ~agosto — el plan actual no requiere NINGUNA migración de BD).

---

## Consecuencias

- **Positivo:** agregar Colombia = `countries/col/` + módulos nuevos + valores de enum.
  Criterio de aceptación del seam: si algo de la etapa COL requiere tocar el core, el
  seam falló.
- **Positivo:** el ratchet impide regresión de acoplamiento mientras se desarrollan
  features en paralelo.
- **Positivo (colateral):** el plan corrige 3 bugs reales encontrados en la auditoría
  (regex RIF laxa con dígito verificador opcional en el alta de empresa, float para
  dinero en DisposeAssetModal, regex Nº control duplicada en OCR) — fase MP-1, único
  cambio de comportamiento sancionado.
- **Neutral:** los consts VEN de compatibilidad son permanentes-ligeros (ancla de tipos
  + módulos VEN-only). No son deuda: son el perfil Venezuela.
- **Acotado:** nómina queda gated por capability, no portada — el motor COL es un
  proyecto propio cuando haya contrato.
- **Riesgo controlado:** MP-6 toca Z-2 (modo paranoico + golden tests); el resto es
  mecánico con la suite (~2836 tests) como red.

## Fases de ejecución (resumen)

MP-0 ADR (este doc) → MP-1 bugs colaterales → MP-2 countries core → MP-3 ratchet →
MP-4 country e2e (guard + FiscalUIProvider + selector país) → MP-5a/5b schema
factories → MP-6 services sweep + IGTF (Z-2) → MP-7 client UI (TaxIdInput + labels) →
MP-8 capabilities (nav/dashboard/guards) → MP-9 retenciones tabla única → MP-10
formatMoney → MP-11 payroll defaults → MP-12 seed seam (opcional) → MP-13 ratchet a
cero + docs. Detalle completo en el plan aprobado 2026-07-26.
