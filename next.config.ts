import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const securityHeaders = [
  // Previene clickjacking — equivalente a CSP frame-ancestors 'none'
  { key: "X-Frame-Options", value: "DENY" },
  // Previene MIME-type sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Fuerza HTTPS por 1 año, incluye subdominios
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Limita información en el header Referer al enviar a otros orígenes
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Deshabilita features del navegador no utilizadas
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // CSP: permite self + Clerk (auth) + Sentry (tunnel /monitoring) + Upstash + Gemini
  // Nota: unsafe-inline requerido por Next.js App Router sin nonces — mejorar con nonces post-lanzamiento
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // unsafe-eval removido — no requerido por Clerk v7 ni Next.js App Router en producción
      // unsafe-inline requerido por Next.js RSC sin nonces — eliminar post-lanzamiento con nonce strategy
      `script-src 'self' 'unsafe-inline' https://*.clerk.com https://*.clerk.dev https://*.clerk.accounts.dev${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self'",
      "connect-src 'self' https://*.clerk.com https://*.clerk.dev https://*.clerk.accounts.dev https://*.sentry.io https://*.ingest.sentry.io https://*.upstash.io https://generativelanguage.googleapis.com",
      "frame-src 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Standalone output para Docker: copia solo las dependencias necesarias al contenedor
  output: process.env.DOCKER_BUILD === "1" ? "standalone" : undefined,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        child_process: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },
};

export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Upload source maps solo en CI/CD (requiere SENTRY_AUTH_TOKEN)
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // No mostrar logs de Sentry en builds locales
  silent: process.env.NODE_ENV !== "production",
  // Tree-shake el logger de Sentry del bundle (reemplaza disableLogger deprecado)
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
  },
  // Incluir source maps de chunks más anchos para mejor stack trace resolution en Seer
  widenClientFileUpload: true,
  // Tunnel: proxea eventos de Sentry a través de /monitoring para evitar ad-blockers.
  // Definido aquí Y en sentry.client.config.ts → tunnel.
  tunnelRoute: "/monitoring",
  // Eliminar source maps del bundle de producción después de subirlos a Sentry
  // (evita que sean accesibles públicamente)
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
});
