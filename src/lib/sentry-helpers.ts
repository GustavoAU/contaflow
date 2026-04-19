// src/lib/sentry-helpers.ts
// Utilidades para enriquecer eventos de Sentry con contexto de negocio.
// Usado por Server Actions para que Seer tenga suficiente contexto para
// identificar la causa raíz y generar un fix automático.

import * as Sentry from "@sentry/nextjs";

/**
 * Establece el contexto de usuario y empresa en el scope actual de Sentry.
 * Llamar desde Server Actions después de validar `auth()` y el membership.
 *
 * No incluye email ni datos PII — solo IDs opacos para correlacionar
 * errores con usuarios sin exponer información personal.
 */
export function setSentryContext(params: {
  userId: string;
  companyId: string;
  role?: string;
}): void {
  Sentry.setUser({ id: params.userId });
  Sentry.setTag("companyId", params.companyId);
  if (params.role) {
    Sentry.setTag("userRole", params.role);
  }
}

/**
 * Captura una excepción desde un Server Action con contexto enriquecido.
 * Añade breadcrumb con el nombre del módulo y la action fallida para que
 * Seer pueda identificar el origen exacto sin necesidad de leer stack traces.
 *
 * Uso típico en un catch block de action:
 * ```ts
 * catch (e) {
 *   captureActionError(e, { action: "createInvoiceAction", module: "invoices", companyId });
 *   return { success: false as const, error: "Error interno al crear factura" };
 * }
 * ```
 *
 * El `input` es opcional y debe omitir campos sensibles (monto, RIF, cédula).
 */
export function captureActionError(
  error: unknown,
  context: {
    action: string;
    module: string;
    companyId?: string;
    /** Solo incluir campos no sensibles para diagnóstico */
    input?: Record<string, unknown>;
  }
): void {
  Sentry.withScope((scope) => {
    // Tags — permiten filtrar en Sentry Issues por módulo/action
    scope.setTag("action", context.action);
    scope.setTag("module", context.module);
    scope.setTag("manually_captured", true);
    if (context.companyId) {
      scope.setTag("companyId", context.companyId);
    }

    // Breadcrumb — da a Seer la cadena de eventos antes del error
    scope.addBreadcrumb({
      category: "server-action",
      message: `${context.module}.${context.action} threw`,
      level: "error",
      data: context.input,
      timestamp: Date.now() / 1000,
    });

    // Contexto adicional para el panel de Seer
    scope.setContext("action_context", {
      action: context.action,
      module: context.module,
      companyId: context.companyId ?? "unknown",
      hasInput: context.input != null,
    });

    Sentry.captureException(error);
  });
}

/**
 * Registra un breadcrumb de flujo de negocio (no errores).
 * Útil para trazar la secuencia de pasos antes de un fallo:
 * "validó schema → chequeó membership → falló en FiscalYearCloseService"
 */
export function addBusinessBreadcrumb(
  message: string,
  data?: Record<string, unknown>
): void {
  Sentry.addBreadcrumb({
    category: "business-logic",
    message,
    level: "info",
    data,
    timestamp: Date.now() / 1000,
  });
}
