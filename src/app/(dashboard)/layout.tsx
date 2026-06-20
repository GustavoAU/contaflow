// src/app/(dashboard)/layout.tsx
import prisma, { withDbRetry } from "@/lib/prisma";

// DECISIONS.md Fix 2: fire-and-forget warm-up to wake the Neon compute before
// the user reaches a form. withDbRetry reintenta si Neon manda "Server has closed
// the connection" durante el cold start — sin retry, el warmup fallaba silenciosamente
// y Neon llegaba frío a la siguiente mutación.
void withDbRetry(() => prisma.$queryRaw`SELECT 1`).catch(() => undefined);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // NOTA: este layout NO impone ancho máximo. El shell de empresa
  // (company/[companyId]/layout.tsx) es un contenedor de pantalla completa
  // (sidebar fijo + main flex-1) y un max-w aquí lo encajonaba —junto con el
  // sidebar— en una columna centrada, desperdiciando medio monitor en pantallas
  // grandes. Cada página hija aplica su propio ancho (dashboard: max-w-5xl,
  // accounting: container). Tampoco envolvemos en <main> para no anidarlo dentro
  // del <main> propio de cada página.
  return <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900">{children}</div>;
}
