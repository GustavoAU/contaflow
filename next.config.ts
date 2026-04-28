import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactCompiler: true,
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
  // No inyectar release en dev para evitar warnings
  disableLogger: true,
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
