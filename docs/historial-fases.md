# Historial de fases — ContaFlow

> Movido desde `CLAUDE.md` para no cargarlo en cada sesión.
> Es un registro histórico: **no** es el estado actual. El estado actual está en
> `contaflow-context-v3.md` → Estado Activo y en `git log`.

## Fases completadas (hasta 2026-06-16)

- Phase 12A ✅ | 12B ✅ | 13C ✅ | 14 ✅ | 14B ✅ | 15 ✅ | 16 ✅ | 17 ✅ | 17B ✅
- Fase 13D ✅ | 18 ✅ | 14C ✅ | 19A ✅ | 19B ✅ | 19 ✅ | 19C ✅ | 14D ✅ | 12C ✅
- Fase OCR-v2 ✅ | 20 ✅ | 21 ✅ | 22 ✅ | 23B ✅ | 28A/B/C ✅ | 28D ✅ | 28E/F ✅
- Fase 31 ✅ | 28G ✅ | 33 ✅ | 32 ✅ | 23C Residual ✅ | 28H ✅ | 28 ✅
- Fase NOM-A ✅ | NOM-B ✅ | NOM-C ✅ | NOM-D ✅ | NOM-E ✅
- Fase 35A ✅ | 26B ✅ | 26 ✅ | 26B Parte 2 ✅ | Mejora #22 ✅ | 35E ✅
- Security hardening ✅ | Bloque A refactor ✅
- **Fase 35H** ✅ merged (PA-121: AuditLog IP/UA + rol SENIAT + SeniatSubmission + QStash + ADR-019 — 1531 tests)
- **Fase 35I** ✅ merged (Firma Digital Híbrida — CertificateService + DocumentSigningService + ADR-020 — 1562 tests)
- **Fase 35F** ✅ merged (UoM múltiples — ADR-018 — 1628 tests)
- **Fase 35G** ✅ merged (Lot/Serial Tracking — InventoryLot/Serial/LotAllocation + UI modal ACCOUNTING + ADR-021 — 1673 tests)
- **Fase 36C** ✅ merged (Distribución de Pagos A/P — PaymentBatch + ADR-022 — 1727 tests)
- **Fase 37A** ✅ merged (InvoiceLine + IvaLineRate + CompanySettings + StockControlLevel + InvoiceLineService — ADR-024 D-1/D-2)
- **Fase 37B** ✅ merged (Expense + ExpenseCategory + ExpenseService + ExpenseActions + seed onboarding — ADR-024 D-3)
- **Fase 37C** ✅ merged (convertOrderToInvoice propaga OrderItems → InvoiceLines — ADR-024 D-1/D-2 — 1806 tests)
- **Fase permisos-granulares** ✅ merged (RolePermission + APP_MODULES + PermissionsMatrix UI + nav grant-aware + ADR-025 — 1819 tests)
- **Sprint UX Grupo 3** ✅ (código + grupos en Clientes/Proveedores — ADR-028 — código libre, sin auto-gen)
- **Sprint UX Fixes** ✅ (InvoiceBook: MoneyBadge en Ret./IGTF/TOTALES sticky; Transactions: formatAmount Débito)

- **Auditoría SENIAT Inventario** ✅ merged (R-01/02/03/04/05/06/09/10/12 + H-03 — ItemType + contrapartida + períodos + link asiento — 1944 tests)
- **GAP-02/03/06 + RF-01/02/05/06** ✅ merged (órdenes vencidas + GL split retención IVA 2205/2110 + firma CPC demo + ENTRADA inventario compras + enteramiento retenciones + fecha TESA-007 + cuentas corrección monetaria — 1949 tests)
- **OM-05/06/08** ✅ merged (período CLOSED bloquea facturas + alerta RETENCIONES_POR_ENTERAR dashboard + FK inventoryItemId en QuotationItem/OrderItem con validación cross-tenant — 1959 tests)
- **OM-01 + OM-04** ✅ merged (inventario perpetuo auto-COGS: SALIDA Dr COGS/Cr Inventario CPP + ENTRADA reutiliza GL factura; AuditLog PDF firmado A4 landscape + SHA-256 R-2 + degradación graceful sin cert — 1967 tests)
- **PC-03 + PC-05** ✅ merged (INVENTARIO_SIN_CUENTAS_GL: alerta dashboard ítems físicos sin cuenta GL; PC-05 ya cubierto por PERIODO_ABIERTO_VIEJO — 1970 tests)
- **P-1 (ADR-025)** ✅ merged (hasModuleAccess — grants granulares en invoice/transaction/fiscal-close/payroll/retention actions — 1983 tests)
- **P-6** ✅ merged (SubmitButton + aria-busy en 13 formularios alto riesgo — sin tests nuevos)
- **Q2-3** ✅ merged (2FA step-up: cierre ejercicio + eliminar miembro + datos SENIAT + archivar empresa — STEP_UP_CONFIG centralizado en step-up.ts — useReverification sin array destructuring)
- **Q2-4** ✅ merged (ActiveSessionsPanel: user.getSessions() → SessionWithActivitiesResource → revoke() — en settings page)
- **P-7** ✅ merged (GET /api/health — db + redis + qstash, ruta pública, force-dynamic)
- **P-4** ✅ merged (Sentry.startSpan en 5 operaciones críticas: correlativo, GL posting, cierre ejercicio, apropiación, nómina, SENIAT transmit)
- **P-8** ✅ merged (RUNBOOK.md — PITR Neon, PDF recovery, checklist mensual, RTO<4h / RPO<1h)
- **P-3** ✅ merged (ThemeProvider + ThemeToggle — dark mode cicla light/dark/system — localStorage cf-theme + prefers-color-scheme)
- **Q1-3** ✅ merged (useFormDraft hook — sessionStorage autosave 30s + AlertDialog restore en InvoiceForm)
- **Q1-4** ✅ merged (ExportService portabilidad — employees/payrollRuns/inventoryItems/expenses + allHistory flag)

**Sprint Cegid** ✅ (4 features contra Cegid):
- **Modo Gerencial** ✅ (OWNER/ADMIN toggle sidebar simplificado — cookie cf-view-mode — ViewModeToggle — buildGerenteNav)
- **SENIAT badge** ✅ (seniatStatus en InvoiceBookRow — badge PENDING/SENT/FAILED en Libro de Ventas)
- **Portal Empleado** ✅ (ya existía — /employee/[token] — JWT — EmployeePortalTokenButton — employee-portal-jwt.ts)
- **Portal Cliente** ✅ (CxC pendiente + historial pagos — /client-portal/[token] — ClientPortalTokenButton — 8 tests)
- **WCAG AA** ✅ (focus-visible:ring en sidebar/topbar/ViewModeToggle — contraste "Pronto" text-zinc-400→text-zinc-600)

**Auditoría GL pagos (Riesgo-6 + Riesgo-9)** ✅ merged (TransactionType COBRO/PAGO + IVA Ret x Cobrar GL + ivaRetentionReceivableAccountId — 2049 tests)

**Q3-1 Gestión Documental** ✅ merged (vista unificada facturas+retenciones + PDF on-demand + JWT share links 7d + /api/doc/[token] público + AuditLog DOC_SHARED + nav "Documentos" — 2063 tests)

**Q3-2 CRM básico** ✅ merged (ContactCategory LEAD/REGULAR/VIP + notas + ContactNote historial interacciones + CLIENTES_INACTIVOS dashboard — 2086 tests)

**Q3-3 Presupuestos y Proyecciones** ✅ merged (Budget+BudgetLine+BudgetStatus + BudgetService compareWithActual + CashFlowProjectionService 4 buckets + budget.actions + BudgetList/Detail/CashFlowWidget + /budgets page + WalletCardsIcon nav — 2110 tests)

**Q3-4 Mobile-First** ✅ merged (sidebar w-14 sm:w-58 + dashboard responsive 390px grid cols-2 + ManagerApprovalInbox + PendingTasksWidget min-h-[52px] WCAG 2.5.8 tap targets — 2110 tests)

**Q3-5 Arquitectura Multi-País** ✅ merged (tax-config.ts FiscalConfig/TaxRates/CountryCode + fiscal-provider.ts VenezuelaFiscalProvider + FiscalProviderFactory + fiscal-validators re-exports + Company.country migration — 2137 tests)

**Q3-6 Keyboard Navigation** ✅ merged (useGlobalShortcuts hook + isTypingTarget document.activeElement + N→nueva factura + Ctrl+S→submit form + InvoiceForm aria-busy+aria-keyshortcuts + TopbarInner pill button — 2153 tests)

**Q2-1 AI Asistente como feature central** ✅ merged (/ai-assistant/page.tsx enriquecida: header+badges+banner crítico+capability chips+chat full-height; FloatingAIAssistant: pulse animate-ping en crítico + callout primera visita localStorage cf-ai-tip-shown — 2153 tests)

**Q2-5 Daltonismo badges stock** ✅ merged (WCAG 1.4.1: XCircleIcon+CheckCircle2Icon en InventoryReportsView Estado col + KPI Bajo stock; XCircleIcon+CheckCircle2Icon en InventoryValuation KPI Stock agotado — 2153 tests)

**Sprint Activos Fijos — Auditoría N1-N6** ✅ merged (2026-05-28):
- **N1** Art. 66 LIVA — reintegro IVA crédito fiscal en baja anticipada (<36 meses): `DisposeAssetModal` calcula `costo×16%×(36-meses)/36`, GL Dr Gasto IVA / Cr IVA CF, checkbox opt-out
- **N2** Moneda de adquisición + tasa BCV histórica: `acquisitionCurrency` + `bcvRateAtAcquisition` en schema + badge azul en tabla + serialización page.tsx
- **N3** Historial persistente reajustes INPC: `FixedAssetINPCRestatement` @@unique([assetId,year,month]) + `getFixedAssetINPCHistoryAction` + modal por activo
- **N4** Integración Compras → Activos Fijos: `getExpensesForAssetImportAction` (últimos 50 CONFIRMED + vendor.rif) + sección "Importar desde Gasto" en `FixedAssetForm` pre-llena 6 campos
- **N5** Advertencia salto de período: `minGapPeriod` useMemo detecta brecha → alerta ámbar en panel depreciación
- **N6** Factor INPC columna visible: columna "Factor INPC" con badge emerald ×factor en tabla activos
- FA-5 F3: advertencia deductibilidad SENIAT (Art. 76 LISLR) si faltan facturaNumber+providerRif — 2191 tests

**Fase 39** ✅ merged (DigitalInvoiceProvider PA-102 — ADR-031): interfaz neutral `DigitalInvoiceProvider` + `DigitalInvoiceFactory` + HKADigitalInvoiceProvider STUB (mapeo estimado, pendiente docs oficiales HKA) + MockDigitalInvoiceProvider + NullDigitalInvoiceProvider — 2191 tests

**ALERTA 12 + A8/10/11 fixes** ✅ merged: duplicar factura (sessionStorage DUPLICATE_SESSION_KEY) + RIF autocomplete debounced (searchContactsByRifAction, badge PROV/CLI) + importación masiva CSV (InvoiceBatchImportDialog 3 pasos + importInvoiceBatchAction Decimal.js R-5) + A8 GL account validation física + ALERTA10 stockWarnings propagation + ALERTA11 CPP banner + IVA retenciones enteradas-only — 2236 tests

**ALERTA 13/14/15/16** ✅ merged: GeminiOCRService detecta RIF y N° Control con formato inválido post-extracción → `_fieldRisks` severity="critical"; InvoiceUploader muestra badge rojo por campo + checkbox obligatorio de verificación antes de usar datos; banner ámbar en InvoiceForm cuando OCR cargó con riesgos críticos; aviso de privacidad Gemini dismissable (localStorage cf-ocr-privacy-ack, COT Art. 126) — 2263 tests

**ALERTA 17/18/19/20** ✅ merged: findInvoiceByNumberAction retorna isVendorSpecialContributor (ALERTA 17) + hasLinkedRetention (ALERTA 19); RetentionForm alerta CE Prov.0049 + badge "Ya tiene retención" + guía 75%/100% (ALERTA 18); createRetentionAction valida invoiceDate dentro de período OPEN + getActivePeriodAction; RetentionForm muestra período activo + borde ámbar si fecha fuera (ALERTA 20) — 2273 tests

**ALERTA 18/20 fixes** ✅ merged: createRetentionAction valida taxBase vs InvoiceTaxLine.base (error si excede en >1 Bs, tolerancia redondeo, permite si factura no está en BD); RetentionForm INCES auto-activación vía INCES_AUTO_CODES (SERVICIOS/CONSTRUCCION/HONORARIOS/COMISIONES) + badge "Auto" + nota Ley INCES Art. 14 — 2276 tests

**Auditoría Forense H-1→H-15** ✅ merged (2026-06-01): H-9/H-12/H-14/H-8/H-6/H-7/H-13/H-15 — RetentionReconciliation + IGTF GL + N°Control único + comprobante IVA + COGS convert-order — 2329 tests

**Auditoría Nómina Partes IV/V/VI** ✅ merged (2026-06-02): campos Forma 14-02 IVSS (C-06/C-07: ivssNumber/payrollWorkerType/maritalStatus/dependents) + probation countdown F-06 + ApproveDialog U-02 + AuditLog payloads enriquecidos (retroactive, salario integral, Gaceta) + 9 cuentas GL en PayrollWizard Step 3 (expenseAccountId/payableAccountId/IVSS/FAOV/INCES/patronales) — 2329 tests

**Auditoría Nómina Parte VII — Automatizaciones** ✅ merged (2026-06-02): 4 alertas en PendingTasksWidget (NOM_SALARIO_MINIMO_VENCIDO / NOM_PRESTACIONES_POR_ACUMULAR / NOM_INTERESES_BCV_PENDIENTES / NOM_PRUEBA_POR_VENCER) + AccrueQuarterForm badge acumulado/pendiente + BcvRateForm indicador meses faltantes — 2336 tests

**Sprint Softnetcorp F4/F5/F7/F8/F9/F10** ✅ merged (2026-06-05): SEMANAL en PayrollFrequency + VacationRequest model (PENDING/APPROVED/REJECTED/CANCELLED) + balance LOTTT Art.190 acumulado + flujo aprobación manager + EmployeeHistoricalImportDialog (días vacaciones + prestaciones) + payslip email fire-and-forget post-aprobación + ManagerApprovalInbox vacaciones pendientes + /payroll/vacation-requests page — 2359 tests

**Fase P** ✅ merged (2026-06-15): ScopeProfile enum (SOLO/EMPRESA/DESPACHO) + Company.scopeProfile nullable + NewCompanyForm selector de perfil + updateScopeProfileAction + /activate-modules page + nav progressive disclosure (Nómina/Inventario locked en SOLO) + banner onboarding si scopeProfile==null (ADR-033) — 2782 tests

**Tanda A landing** ✅ merged (top-banner urgencia + precio tachado plan anual + CTAs intermedios + ROI anchor)

**Tanda C landing** ✅ merged (BotRecomendador wizard inline — 3 tarjetas SOLO/EMPRESA/DESPACHO + panel animado + cookie cf-pending-profile 30min → /sign-up?profile=X + pre-fill NewCompanyForm — ADR-033 — 2782 tests)

**Fase Despacho (ADR-034)** ✅ merged (2026-06-15): ManagedClient + DespachoTier enum + Subscription.despachoTier + DespachoService (canAddManagedClient/addManagedClient/archiveManagedClient/listManagedClients/upgradeDespachoTier) + guards R-6/ADR-004/VEN_RIF_REGEX + DespachoRifList/AddRifModal/DespachoTierCard/DespachoOnboardingBanner + /despacho/rifs page + nav progressive disclosure scopeProfile=DESPACHO — 2803 tests.

**Fase Despacho — flujo de pago** ✅ merged (2026-06-15): /despacho/upgrade page + DespachoUpgradeFlow + upgradeDespachoTierAction (OWNER only) + upgradeDespachoTier refactor (upsert Subscription "todo incluido" + AuditLog R-6 + successUrl/cancelUrl) + handleIPN aplica despachoTier desde metadata al confirmar pago. Auditoría seguridad ADR-034 §6.3: GO — 2805 tests.

**Precios definitivos lanzamiento** ✅ merged (2026-06-15): plan base + Despacho STARTER $119 (5 RIFs) · PRO $249 (25 RIFs) · UNLIMITED $359 (∞ RIFs) — Despacho incluye empresa propia. Sincronizados en BillingService, DespachoService.DESPACHO_TIER_PRICES_USD_CENTS, landing, sign-up, /upgrade page.

**Precio plan base POR PERFIL** ✅ merged (2026-06-16): el precio del plan base depende del `scopeProfile` (Individual y Empresa al mismo precio no tenía sentido). Individual (SOLO): $69 mensual / $59 anual, sin Early. Empresa (EMPRESA/null): $79 mensual / $65 anual / Early Adopter $59 año 1. `BillingService.getPlanPriceCents(scopeProfile, plan)` + `pricingProfileFor()` (SOLO→Individual; resto→Empresa, nunca cobra de menos) reemplazan `PLAN_PRICES_CENTS`. `createCheckout` lee `company.scopeProfile`; EARLY_ADOPTER lanza si SOLO. /upgrade page perfil-aware — 2807 tests.

**Ciclo de vida de suscripción** ✅ merged (2026-06-16): modelo cripto = sin débito automático, renovación MANUAL. `SubscriptionService`: getSubscriptionState/isWriteAllowed/assertWriteAllowed (fail-open) + runBillingLifecycle (marca EXPIRED vencidas + recordatorios email 7d/3d vía Resend, ventana diaria, copy con nombre de empresa). WhatsApp `lib/whatsapp.ts` Meta Cloud API stub enchufable (no-op sin env `WHATSAPP_*`). Cron `/api/cron/billing-lifecycle` (13:00). Banner rojo solo-lectura en dashboard. Teléfono OBLIGATORIO en registro (Company.telefono, para recordatorios). Empresas sin suscripción (demo) nunca se cortan.

**Gate central de escritura** ✅ merged (2026-06-16): `src/lib/prisma-billing-gate.ts` — extensión `$extends` que bloquea TODA escritura de modelos de negocio si la suscripción venció (cubre las 133 actions de mutación centralmente). EXEMPT_MODELS (Subscription/SubscriptionPayment/PlanChangeRequest/AuditLog/User/Company/CompanyMember/ManagedClient/SeniatSubmission). extractCompanyId conservador (data.companyId / company.connect.id / where.companyId / createMany); si no determina → permite. Caché 30s + fail-open. Lecturas/export NO se bloquean. **Importante:** el cliente se exporta con tipo base (`as unknown as PrismaClient`) — el gate corre en runtime pero NO se propagan los tipos pesados de $extends (evita OOM de tsc + incompatibilidad con los ~133 helpers que usan Prisma.TransactionClient). Lógica pura testeada — 2836 tests.

**Landing launch-ready** ✅ merged (2026-06-15): Despacho activo en BotRecomendador/activate-modules/NewCompanyForm (quitado "Próximamente"/"Pronto") + footer/nav/mobile-nav auth-aware (SignOutLink con Clerk SignOutButton — "Ir al panel"+"Cerrar sesión" si hay sesión).

**2836 tests GREEN** | **0 TS errors** | **CI passing** (2026-06-16)

> Pendiente landing (no bloqueante): rediseño visual del Hero — el usuario lo quiere "más tecnológico/avanzado" (referencia: quickbooks.intuit.com). Actualmente plano. Tanda de diseño dedicada.
