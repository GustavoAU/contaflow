// src/app/(dashboard)/company/[companyId]/documents/loading.tsx
// Q3-1: Skeleton de carga para la página de Gestión Documental.

export default function DocumentsLoading() {
  return (
    <div className="animate-pulse space-y-6">
      {/* Encabezado */}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 size-6 shrink-0 rounded bg-zinc-200 dark:bg-zinc-700" />
        <div className="space-y-2">
          <div className="h-7 w-40 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-4 w-72 rounded bg-zinc-100 dark:bg-zinc-800" />
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="h-9 min-w-48 flex-1 rounded-md bg-zinc-100 dark:bg-zinc-800" />
        <div className="h-9 w-52 rounded-md bg-zinc-100 dark:bg-zinc-800" />
        <div className="h-9 w-36 rounded-md bg-zinc-100 dark:bg-zinc-800" />
        <div className="h-9 w-36 rounded-md bg-zinc-100 dark:bg-zinc-800" />
      </div>

      {/* Contador */}
      <div className="h-4 w-28 rounded bg-zinc-100 dark:bg-zinc-800" />

      {/* Tabla */}
      <div className="overflow-hidden rounded-md border">
        {/* Cabecera */}
        <div className="h-10 border-b bg-zinc-50 dark:bg-zinc-900" />
        {/* Filas */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-0">
            <div className="h-5 w-28 rounded-full bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-4 w-24 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-4 flex-1 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-4 w-20 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="ml-auto h-4 w-24 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-7 w-20 rounded bg-zinc-100 dark:bg-zinc-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
