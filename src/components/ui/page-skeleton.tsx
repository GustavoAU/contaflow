// src/components/ui/page-skeleton.tsx

function SkeletonLine({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className ?? ""}`} />;
}

export function TablePageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <SkeletonLine className="h-7 w-48" />
          <SkeletonLine className="h-4 w-72" />
        </div>
        <SkeletonLine className="h-9 w-32 rounded-md" />
      </div>
      {/* Filters */}
      <div className="flex gap-3">
        <SkeletonLine className="h-9 w-36 rounded-md" />
        <SkeletonLine className="h-9 w-36 rounded-md" />
      </div>
      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <div className="border-b bg-gray-50 px-4 py-3">
          <div className="flex gap-6">
            {[48, 64, 40, 56, 40].map((w, i) => (
              <SkeletonLine key={i} className={`h-4 w-${w}`} />
            ))}
          </div>
        </div>
        <div className="divide-y divide-gray-100 bg-white">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-6 px-4 py-3">
              <SkeletonLine className="h-4 w-20" />
              <SkeletonLine className="h-4 w-48 flex-1" />
              <SkeletonLine className="h-5 w-16 rounded-full" />
              <SkeletonLine className="h-4 w-24" />
              <SkeletonLine className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
