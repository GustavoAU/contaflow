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

  // beforeSend server-side: filtrar y enriquecer para Seer
  beforeSend(event) {
    // Filtrar errores esperados de Prisma que ya manejamos con { success: false }
    // P2002 (unique violation) y P2025 (not found) son flujo normal, no bugs
    const message = event.exception?.values?.[0]?.value ?? "";
    if (message.includes("P2002") || message.includes("P2025")) {
      // Solo reportar si NO fue capturado manualmente — evitar duplicados
      const isManuallyCaptured = event.tags?.["manually_captured"] === true;
      if (!isManuallyCaptured) return null;
    }

    // Scrubbing: nunca enviar variables de entorno en el contexto
    if (event.extra) {
      const sanitized = { ...event.extra };
      for (const key of Object.keys(sanitized)) {
        if (/password|token|secret|key|dsn|url|database/i.test(key)) {
          sanitized[key] = "[Filtered]";
        }
      }
      event.extra = sanitized;
    }

    // Siempre adjuntar el entorno de despliegue para facilitar triage de Seer
    event.tags = {
      ...event.tags,
      runtime: "server",
      service: "contaflow-api",
    };

    return event;
  },
});
