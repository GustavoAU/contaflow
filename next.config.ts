import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactCompiler: true,
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
});
