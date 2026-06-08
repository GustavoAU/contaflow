// src/app/(dashboard)/layout.tsx
import prisma, { withDbRetry } from "@/lib/prisma";

// DECISIONS.md Fix 2: fire-and-forget warm-up to wake the Neon compute before
// the user reaches a form. withDbRetry reintenta si Neon manda "Server has closed
// the connection" durante el cold start — sin retry, el warmup fallaba silenciosamente
// y Neon llegaba frío a la siguiente mutación.
void withDbRetry(() => prisma.$queryRaw`SELECT 1`).catch(() => undefined);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900">
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}
