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

  // Filtrar errores irrelevantes del cliente (extensiones de browser, etc.)
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "Non-Error promise rejection captured",
  ],
});
