// src/components/ui/page-skeleton.tsx
// Esqueletos de carga para loading.tsx de cada ruta.
// Todos soportan dark mode con colores zinc.

function Sk({ className }: { className?: string }) {
  return (
    <div
      className={`rounded bg-zinc-200 dark:bg-zinc-700 animate-pulse ${className ?? ""}`}
    />
  );
}

// ── Tabla / lista ─────────────────────────────────────────────────────────────
export function TablePageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-4 p-6">
      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Sk className="h-7 w-48" />
          <Sk className="h-4 w-72" />
        </div>
        <Sk className="h-9 w-32 rounded-md" />
      </div>

      {/* Filtros */}
      <div className="flex gap-3">
        <Sk className="h-9 w-36 rounded-md" />
        <Sk className="h-9 w-36 rounded-md" />
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        {/* Cabecera */}
        <div className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 px-4 py-3">
          <div className="flex gap-8">
            <Sk className="h-4 w-20" />
            <Sk className="h-4 w-32" />
            <Sk className="h-4 w-16" />
            <Sk className="h-4 w-24" />
            <Sk className="h-4 w-16" />
          </div>
        </div>
        {/* Filas */}
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-8 px-4 py-3">
              <Sk className="h-4 w-20" />
              <Sk className="h-4 flex-1" />
              <Sk className="h-5 w-16 rounded-full" />
              <Sk className="h-4 w-24" />
              <Sk className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Tarjetas / dashboard ───────────────────────────────────────────────────────
export function CardPageSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="space-y-6 p-6">
      {/* Encabezado */}
      <div className="space-y-2">
        <Sk className="h-7 w-56" />
        <Sk className="h-4 w-80" />
      </div>

      {/* Tarjetas de estadística */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: cards }).map((_, i) => (
          <div
            key={i}
            className="space-y-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
          >
            <Sk className="h-4 w-24" />
            <Sk className="h-8 w-32" />
            <Sk className="h-3 w-20" />
          </div>
        ))}
      </div>

      {/* Área principal */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
        <Sk className="h-5 w-40" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Sk className="h-4 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Formulario / acción ────────────────────────────────────────────────────────
export function FormPageSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="space-y-6 p-6">
      {/* Encabezado */}
      <div className="space-y-2">
        <Sk className="h-7 w-56" />
        <Sk className="h-4 w-80" />
      </div>

      {/* Tarjeta de formulario */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-5">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Sk className="h-4 w-28" />
            <Sk className="h-9 w-full rounded-md" />
          </div>
        ))}
        {/* Botones */}
        <div className="flex gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
          <Sk className="h-9 w-28 rounded-md" />
          <Sk className="h-9 w-20 rounded-md" />
        </div>
      </div>
    </div>
  );
}
