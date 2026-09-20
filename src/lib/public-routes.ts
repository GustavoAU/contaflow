// src/lib/public-routes.ts
// Rutas que el middleware de Clerk NO protege: se autentican por otro medio (token, firma) o son públicas.
// Vive fuera de middleware.ts para poder testearla: una ruta que falte aquí no falla con error, la reescribe
// Clerk a "no encontrado" y quien la llama (Vercel, un cron) cree que se entregó bien.

export const PUBLIC_ROUTE_PATTERNS = [
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/monitoring(.*)",
  "/api/health",
  "/api/webhook/(.*)",
  "/api/webhooks/(.*)",
  "/employee/(.*)", // Portal del Empleado — acceso por token JWT sin Clerk
  "/client-portal/(.*)", // Portal del Cliente — acceso por token JWT sin Clerk
  "/api/doc/(.*)", // Q3-1: Documentos compartidos — autenticados por DOC_SHARE_SECRET JWT
  "/api/cron/(.*)", // Vercel Cron Jobs — autenticados por CRON_SECRET, no por Clerk
];
