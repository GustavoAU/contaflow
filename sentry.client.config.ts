// sentry.client.config.ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,

  // Solo reportar en producción
  enabled: process.env.NODE_ENV === "production",

  // Muestra de trazas de rendimiento: 10% en prod para no saturar cuota
  tracesSampleRate: 0.1,

  // No capturar replay — contiene datos financieros sensibles
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // Tunnel para evitar ad-blockers que bloquean sentry.io directamente
  // (configurable en next.config.ts → tunnelRoute)
  tunnel: "/monitoring",

  // Filtrar errores irrelevantes del cliente (extensiones de browser, etc.)
  ignoreErrors: [
    // Browser / extensiones
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    "Non-Error promise rejection captured",
    // Errores de red transitorios — no accionables
    "NetworkError",
    "Failed to fetch",
    "Load failed",
    // Hydration mismatches menores de Next.js
    "Hydration failed",
    "There was an error while hydrating",
    // Next.js router cancellations — no son errores reales
    "Abort fetching component for route",
    "Route Cancelled",
  ],

  // beforeSend: enriquecer y filtrar antes de enviar a Sentry
  // Permite que Seer tenga contexto limpio y sin PII en URLs
  beforeSend(event) {
    // Scrubbing: eliminar query params con datos sensibles de las URLs
    if (event.request?.url) {
      try {
        const url = new URL(event.request.url);
        // Eliminar query params que puedan contener tokens o IDs de sesión
        url.searchParams.delete("token");
        url.searchParams.delete("code");
        url.searchParams.delete("session");
        event.request.url = url.toString();
      } catch {
        // URL malformada — dejar como está
      }
    }

    // Scrubbing: limpiar breadcrumbs con datos de request financiero
    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs = event.breadcrumbs.map((bc) => {
        if (bc.category === "fetch" || bc.category === "xhr") {
          // Mantener método + URL pero eliminar body (puede tener montos/RIF)
          const { body: _, ...safeData } = bc.data ?? {};
          return { ...bc, data: safeData };
        }
        return bc;
      });
    }

    return event;
  },
});
