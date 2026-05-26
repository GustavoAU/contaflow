// src/app/(dashboard)/company/[companyId]/budgets/loading.tsx
// Q3-3: Skeleton para página de Presupuestos.

export default function BudgetsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div className="space-y-2">
        <div className="h-7 w-64 rounded bg-zinc-200" />
        <div className="h-4 w-96 rounded bg-zinc-100" />
      </div>
      {/* Tab bar */}
      <div className="flex gap-4 border-b border-zinc-200 pb-0">
        <div className="h-9 w-32 rounded bg-zinc-100" />
        <div className="h-9 w-32 rounded bg-zinc-100" />
      </div>
      {/* Content */}
      <div className="flex gap-6">
        {/* Left panel */}
        <div className="w-72 space-y-2">
          <div className="h-9 rounded-md bg-zinc-200" />
          {[1,2,3].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-zinc-100" />
          ))}
        </div>
        {/* Right panel */}
        <div className="flex-1 space-y-3">
          <div className="h-12 rounded-lg bg-zinc-100" />
          {[1,2,3,4,5].map((i) => (
            <div key={i} className="h-10 rounded bg-zinc-50" />
          ))}
        </div>
      </div>
    </div>
  );
}
