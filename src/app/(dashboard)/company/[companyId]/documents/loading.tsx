// src/app/(dashboard)/company/[companyId]/documents/loading.tsx
// Q3-1: Skeleton de carga para la página de Gestión Documental.

export default function DocumentsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Encabezado */}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 size-6 rounded bg-zinc-200 dark:bg-zinc-700 shrink-0" />
        <div className="space-y-2">
          <div className="h-7 w-40 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-4 w-72 rounded bg-zinc-100 dark:bg-zinc-800" />
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="h-9 flex-1 min-w-48 rounded-md bg-zinc-100 dark:bg-zinc-800" />
        <div className="h-9 w-52 rounded-md bg-zinc-100 dark:bg-zinc-800" />
        <div className="h-9 w-36 rounded-md bg-zinc-100 dark:bg-zinc-800" />
        <div className="h-9 w-36 rounded-md bg-zinc-100 dark:bg-zinc-800" />
      </div>

      {/* Contador */}
      <div className="h-4 w-28 rounded bg-zinc-100 dark:bg-zinc-800" />

      {/* Tabla */}
      <div className="rounded-md border overflow-hidden">
        {/* Cabecera */}
        <div className="h-10 bg-zinc-50 dark:bg-zinc-900 border-b" />
        {/* Filas */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-4 py-3 border-b last:border-0"
          >
            <div className="h-5 w-28 rounded-full bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-4 w-24 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-4 flex-1 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-4 w-20 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-4 w-24 rounded bg-zinc-100 dark:bg-zinc-800 ml-auto" />
            <div className="h-7 w-20 rounded bg-zinc-100 dark:bg-zinc-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
