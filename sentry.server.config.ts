// sentry.server.config.ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,

  enabled: process.env.NODE_ENV === "production",

  // Menor sample rate en server — más volumen de requests
  tracesSampleRate: 0.05,

  // No enviar variables de entorno — contienen credenciales DB, API keys
  sendDefaultPii: false,
});
